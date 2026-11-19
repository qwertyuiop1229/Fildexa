import {readZip,limits} from './zip.mjs';
import {scan,expand} from './project.mjs';
import {normalizeEntries,listDrop,projectKey,SavedProjects,safeStorage,compile,prettySize,fitViewport,clamp,describePage,appSignature} from './workspace.mjs';
import {createPicker} from './picker.mjs';
import {toolDock} from './tool-dock.mjs';

const $=id=>document.getElementById(id);
const state={job:0,gen:0,archive:null,projects:[],project:null,items:null,original:null,frame:null,session:null,online:false,cdn:false,view:'desktop',focus:'',open:false,storage:{},packages:{},transformed:[],sourceRoot:'',history:[],index:-1,custom:[900,640],persist:false};
let saved;
try{saved=new SavedProjects(localStorage);}catch{}
const bridge=(action,value)=>{
  const {frame,session}=state;
  if(!frame||!session?.done)return false;
  frame.contentWindow.postMessage({zipstage:session.token,type:'dev',value:{action,value}},'*');return true;
};
const sourceFiles=()=>state.original??[];
const dock=toolDock($,bridge,{files:sourceFiles,storage:()=>state.storage,openStorage,metadata:()=>({online:state.online,phase:state.frame?'プレビュー中':'未起動',compiler:state.transformed.length,duration:state.startMs})});
const pickers={
  root:createPicker($('root-picker'),'root-label',i=>selectProject(Number(i))),
  page:createPicker($('page-picker'),'page-label',page=>navigate({page}))
};
let runnerPromise;
const readScript=async path=>{const r=await fetch(path);if(!r.ok)throw Error('プレビュー用のファイルを読み込めません。');return r.text();};
function runnerCode(){
  if(!runnerPromise)runnerPromise=Promise.all(['./vendor/lexer.js','./dev-bridge.js','./runner.js'].map(readScript)).then(s=>s.map(x=>x.replace(/<\/script/gi,'<\\/script')).join('\n')).catch(e=>{runnerPromise=null;throw e;});
  return runnerPromise;
}
function message(text='',kind=''){
  const e=$('load-msg');e.hidden=!text;e.textContent=text;e.classList.toggle('error',kind==='error');
}
function phase(text='',kind=''){
  $('phase').textContent=text;$('signal').className='signal'+(kind?' '+kind:'');
}
function loading(active,text='',percentage){
  $('loading').hidden=!active;$('screen').setAttribute('aria-busy',String(active));
  $('screen').classList.toggle('waiting',active);
  if(percentage==null)$('progress').removeAttribute('value');else $('progress').value=percentage;
  $('loading-step').textContent=text;
  $('formats').hidden=active;
}
function dispose(){
  if(state.session)clearTimeout(state.session.watch);
  state.session=null;state.frame?.remove();state.frame=null;$('frame-shell').hidden=true;
}
function empty(title,body){
  $('empty').hidden=false;$('empty-title').textContent=title;$('empty-copy').textContent=body;
}
function failure(e,context='ファイルを開けませんでした'){
  const summary=String(e?.message??e??'読み込みに失敗しました。');
  dispose();loading(false);phase(context,'error');message(summary,'error');dock.log({level:'error',message:summary});
  empty(context,summary);$('focus-preview').disabled=true;
}
function switchSidebar(open){
  $('sidebar').classList.toggle('open',open);$('open-sidebar').setAttribute('aria-expanded',String(open));
  if(!open){pickers.root.close();pickers.page.close();}
}
function resetSettings(){
  state.online=false;state.cdn=false;$('online').checked=false;$('npm').checked=false;$('npm-option').hidden=true;networkNote();
}
function networkNote(){
  $('online-description').textContent=state.online?'オン · 外部APIに接続できます。':'オフ · 外部リソースとAPI通信を制限します。';
}
function urlState(item){return {...item,hash:item.hash||'',query:item.query||'',request:item.request??item.page};}
function updateRoute(){
  const current=state.history[state.index];if(!current)return;
  $('path-label').textContent=describePage(current);$('path-label').title=$('path-label').textContent;
  $('back').disabled=state.index<1;$('forward').disabled=state.index>=state.history.length-1;
  $('reload').disabled=!state.items;
  pickers.page.value(current.page);
}
function navigate(info,{keep=false}={}){
  const current=urlState(info),prev=state.history[state.index];
  if(prev&&describePage(prev)===describePage(current)&&prev.page===current.page)return;
  state.history.splice(state.index+1);state.history.push(current);state.index=state.history.length-1;
  updateRoute();void start({keep});
}
function go(step){
  if(state.index+step<0||state.index+step>=state.history.length)return;
  state.index+=step;updateRoute();void start({keep:true});
}
function savedView(){
  const id=state.key,snapshot=id?saved?.load(id):null;
  state.persist=!!snapshot?.enabled;
  state.storage=state.persist?{localStorage:safeStorage(Object.entries(snapshot.local??{}))}:{};
  $('persist').checked=state.persist;$('persist').disabled=!id||!saved;
}
function saveWorkspace(){
  if(!saved||!state.key)return;
  try{
    const prev=saved.load(state.key);
    saved.write(state.key,{name:state.name,root:state.project.root,enabled:state.persist,local:state.persist?(state.storage.localStorage??{}):(prev?.local??{})});
  }catch{
    message('ブラウザの保存容量が不足しているか、保存できない設定です。','error');
    dock.log({level:'error',message:'localStorage の保存に失敗しました。'});
  }
}
function selectProject(index){
  const project=state.projects[index];if(!project)return;
  state.key=null;
  state.project=project;state.items=null;state.original=null;state.transformed=[];state.compileErrors=[];
  state.history=[urlState({page:project.home})];state.index=0;
  savedView();
  pickers.page.set(project.pages.map(x=>({value:x,label:'/'+x})),project.home);
  $('project-detail').textContent=prettySize(state.size)+' · '+project.pages.length+' ページ';
  updateRoute();void prepare();
}
async function inspect(input,title,flavor){
  const job=++state.job;state.gen++;dispose();dock.reset();resetSettings();switchSidebar(false);
  message();phase('解析中');empty('プロジェクトを確認中','HTMLと公開用フォルダを探しています。');loading(true,'ファイル構成を解析中');
  state.name=title;state.items=null;state.original=null;state.key=null;state.startMs=null;state.project=null;state.packages={};savedView();
  $('project-info').hidden=true;$('selection').hidden=true;$('back').disabled=true;$('forward').disabled=true;$('reload').disabled=true;$('focus-preview').disabled=true;
  $('path-label').textContent='プロジェクトを確認中';
  try{
    let archive,detected;
    if(flavor==='zip'){
      if(input.size>limits.zip)throw Error('ZIPは120 MBまでです。');
      const raw=await input.arrayBuffer();if(job!==state.job)return;
      archive=readZip(new Uint8Array(raw));archive.size=input.size;detected=await scan(archive);
    }else if(flavor==='html'){
      archive=normalizeEntries([{file:input,path:'index.html'}]);
      detected={candidates:[{root:'',kind:'単体HTML',home:'index.html',pages:['index.html'],rewrites:[]}],sourceRoot:''};
    }else{
      archive=normalizeEntries(input);detected=await scan(archive);
    }
    if(job!==state.job)return;
    if(!detected.candidates.length)throw Error('HTMLが見つかりません。index.html がある公開フォルダか、ビルド済みの dist を選んでください。');
    state.size=archive.size;state.archive=archive;state.projects=detected.candidates;state.build=!!detected.build;state.sourceRoot=detected.sourceRoot||'';
    for(const name of new Set([state.sourceRoot+'package.json','package.json'])){
      if(!archive.files.has(name)||archive.files.get(name).length>128000)continue;
      try{
        const p=JSON.parse(await (await archive.blob(name)).text());
        if(job!==state.job)return;
        state.packages={...p.dependencies,...p.peerDependencies,...p.devDependencies};
        break;
      }catch{}
    }
    if(job!==state.job)return;
    $('project-name').textContent=title;$('project-name').title=title;$('project-info').hidden=false;$('selection').hidden=false;
    $('npm-option').hidden=!state.online||!Object.keys(state.packages).length;
    pickers.root.set(state.projects.map((x,i)=>({value:String(i),label:(x.root.replace(/\/$/,'')||'/')+' · '+x.kind})),'0');
    selectProject(0);
  }catch(e){if(job===state.job)failure(e);}
}
function openSingle(file){
  if(!file)return;
  const flavor=/\.zip$/i.test(file.name)?'zip':/\.html?$/i.test(file.name)?'html':'';
  if(flavor)void inspect(file,file.name,flavor);
  else failure(Error('ZIP、HTML、またはフォルダを選んでください。'));
}
async function prepare(){
  const project=state.project,gen=++state.gen;
  dispose();dock.reset();phase('展開中');message();
  empty('ファイルを準備中','フォルダ構成を保ったまま読み込んでいます。');loading(true,'プロジェクトを読み込み中',0);
  try{
    const items=await expand(state.archive,project,(i,n)=>{if(gen===state.gen)loading(true,'読み込み '+i+' / '+n,Math.round(i/n*100));},()=>gen!==state.gen);
    if(gen!==state.gen||!items)return;
    state.original=items;
    const signature=await appSignature(items,project.home);
    if(gen!==state.gen)return;
    state.key=projectKey(state.name,project.root,state.sourceRoot,project.kind,signature);
    savedView();
    const result=await compile(items,(i,n)=>{if(gen===state.gen){phase('変換中');loading(true,'TypeScript・JSX を変換中  '+i+' / '+n,Math.round(i/n*100));}},()=>gen!==state.gen);
    if(!result||gen!==state.gen)return;
    state.items=result.items;state.compileErrors=result.errors;
    const originals=new Map(items);
    state.transformed=result.items.filter(([p,file])=>file!==originals.get(p)).map(([p])=>p);
    if(result.errors.length)message(result.errors.length+'件のソースを変換できませんでした。コンソールで確認できます。');
    else if(state.build&&project.root===state.sourceRoot&&!state.online)message('ビルド前の構成です。npm依存が必要な場合は先にビルドするか、外部通信をオンにしてCDNを許可してください。');
    updateRoute();void start();
  }catch(e){if(gen===state.gen)failure(e,'準備できませんでした');}
}
async function start({keep=false}={}){
  if(!state.items)return;
  const gen=++state.gen,token=crypto.randomUUID(),location=state.history[state.index],online=state.online;
  dispose();if(!keep&&!dock.keepAfterReload())dock.reset();else dock.invalidate();
  for(const e of state.compileErrors)dock.log({level:'error',message:e.path+' · '+e.message});
  state.launchAt=performance.now();state.startMs=null;
  phase('起動中');empty('プレビューを起動中','アプリのファイルをブラウザで配置しています。');loading(true,'プレビューの準備');
  try{
    const raw=await runnerCode();if(gen!==state.gen)return;
    const frame=document.createElement('iframe');frame.title='Webアプリのプレビュー';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    const remote=online?' https:':'';
    const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:"+remote+"; style-src 'unsafe-inline' blob: data:"+remote+"; img-src blob: data:"+remote+"; font-src blob: data:"+remote+"; media-src blob: data:"+remote+"; connect-src blob: data:"+(online?' https: wss:':'')+"; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src blob: data:;";
    frame.srcdoc='<!doctype html><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+raw+'\nzipstageBootstrap('+JSON.stringify(token)+','+online+');<\/script>';
    state.frame=frame;state.session={token,gen,ready:false,done:false,watch:setTimeout(()=>{
      if(state.session?.token!==token||state.session.done)return;
      loading(false);$('empty').hidden=true;phase('応答待ち','error');
      dock.log({level:'warn',message:'プレビューの応答に時間がかかっています。読み込みログをご確認ください。'});dock.open('console');
    },23000)};
    $('frame-wrap').replaceChildren(frame);$('frame-shell').hidden=false;measure();
  }catch(e){if(gen===state.gen)failure(e,'起動できませんでした');}
}
window.addEventListener('message',e=>{
  const session=state.session;
  if(!session||e.source!==state.frame?.contentWindow||e.origin!=='null'||e.data?.zipstage!==session.token||session.gen!==state.gen)return;
  const {type,value}=e.data;
  if(type==='ready'&&!session.ready){
    session.ready=true;
    const route=state.history[state.index];
    state.frame.contentWindow.postMessage({zipstage:session.token,type:'start',value:{items:state.items,...route,rewrites:state.project.rewrites,storage:state.storage,packages:state.packages,cdn:state.online&&state.cdn,transformed:state.transformed}},'*');
  }else if(type==='rendered'&&!session.done){
    session.done=true;clearTimeout(session.watch);
    state.startMs=Math.round(performance.now()-state.launchAt);loading(false);$('empty').hidden=true;
    phase('実行中','ready');$('focus-preview').disabled=false;dock.ready();measure();
  }else if(type==='fatal'&&!session.done){
    failure(value,'表示できませんでした');dock.open('console');
  }else if(type==='navigate'&&state.project?.pages.includes(value?.page)&&typeof value.hash==='string'){
    navigate({page:value.page,hash:value.hash.slice(0,700),query:typeof value.query==='string'?value.query.slice(0,700):'',request:typeof value.request==='string'?value.request.slice(0,1200):value.page},{keep:true});
  }else if(type==='storage'&&['localStorage','sessionStorage'].includes(value?.type)){
    state.storage[value.type]=safeStorage(value.entries);
    if(value.type==='localStorage'&&state.persist)saveWorkspace();
    dock.storage();
  }else{
    dock.receive(type,value,session.token);
  }
});

$('drop').onclick=$('choose-file').onclick=()=>$('file').click();
$('choose-folder').onclick=()=>{
  if('webkitdirectory' in $('folder'))$('folder').click();
  else message('このブラウザはフォルダ選択に対応していません。ZIPにするか、フォルダをドラッグしてください。');
};
$('file').onchange=()=>{const f=$('file').files[0];$('file').value='';openSingle(f);};
$('folder').onchange=()=>{
  const items=[...$('folder').files].map(file=>({file,path:file.webkitRelativePath||file.name}));$('folder').value='';
  if(items.length)void inspect(items,items[0].path.split('/')[0],'folder');
};
const fileDrag=e=>Array.from(e.dataTransfer?.types??[]).includes('Files');
window.addEventListener('dragover',e=>{if(fileDrag(e))e.preventDefault();});
$('drop').addEventListener('dragover',e=>{if(fileDrag(e)){$('drop').classList.add('drag');e.dataTransfer.dropEffect='copy';}});
$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('drag'));
window.addEventListener('drop',async e=>{
  if(!fileDrag(e))return;
  e.preventDefault();$('drop').classList.remove('drag');
  const job=state.job;
  try{
    const data=e.dataTransfer;
    const entries=await listDrop(data);if(job!==state.job||!entries.length)return;
    const file=entries[0].file;
    if(entries.length===1&&entries[0].path===file.name&&/\.(zip|html?)$/i.test(file.name))openSingle(file);
    else void inspect(entries,entries[0].path.includes('/')?entries[0].path.split('/')[0]:'選択したファイル','folder');
  }catch(e){if(job===state.job)failure(e);}
});
$('demo').onclick=async()=>{
  const job=state.job;$('demo').disabled=true;
  try{
    const r=await fetch('./sample.zip');if(!r.ok)throw Error('サンプルを開けませんでした。');
    const b=await r.blob();if(job===state.job)void inspect(b,'ZipStage-sample.zip','zip');
  }catch(e){if(job===state.job)failure(e);}
  finally{$('demo').disabled=false;}
};
$('back').onclick=()=>go(-1);$('forward').onclick=()=>go(1);$('reload').onclick=()=>void start();
$('open-sidebar').onclick=$('empty-open').onclick=()=>switchSidebar(true);
$('close-sidebar').onclick=()=>switchSidebar(false);
document.addEventListener('pointerdown',e=>{
  if($('sidebar').classList.contains('open')&&!e.target.closest('.sidebar,.compact-menu,.picker-menu,dialog'))switchSidebar(false);
});
function setFocus(value){
  state.focus=value;document.body.dataset.focus=value;
  $('focus-exit').hidden=value!=='only';$('focus-preview').hidden=value!=='workspace';
  $('fullscreen').setAttribute('aria-label',value==='workspace'?'作業領域の拡大を終了':'作業領域を拡大');
  $('fullscreen').title=$('fullscreen').getAttribute('aria-label');
  requestAnimationFrame(measure);
}
$('fullscreen').onclick=()=>setFocus(state.focus==='workspace'?'':'workspace');
$('focus-preview').onclick=()=>{if(state.session?.done){setFocus('only');$('exit-focus').focus({preventScroll:true});}};
$('exit-focus').onclick=()=>{setFocus('workspace');$('focus-preview').focus({preventScroll:true});};
window.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.key!=='Escape'||document.querySelector('dialog[open]'))return;
  if(state.focus){setFocus(state.focus==='only'?'workspace':'');e.preventDefault();}
  else if($('sidebar').classList.contains('open'))switchSidebar(false);
});
function measure(){
  const shell=$('frame-shell'),screen=$('screen');
  if(state.view==='desktop'){shell.classList.remove('fixed');$('view-label').textContent='PC';return;}
  const [w,h]=state.view==='mobile'?[390,844]:state.custom;
  const fit=fitViewport(w,h,screen.clientWidth,screen.clientHeight);
  state.ratio=fit.ratio;
  shell.classList.add('fixed');
  for(const [key,value] of Object.entries({'scaled-w':fit.w+'px','scaled-h':fit.h+'px','real-w':w+'px','real-h':h+'px',fit:fit.ratio}))shell.style.setProperty('--'+key,value);
  $('view-label').textContent=w+' × '+h;$('view-label').title=w+' × '+h+' px';
}
function setView(value){
  state.view=value;$('sizebar').hidden=value!=='custom';$('resize-handle').hidden=value!=='custom';
  for(const v of ['desktop','mobile','custom']){$(v).classList.toggle('on',v===value);$(v).setAttribute('aria-pressed',String(v===value));}
  requestAnimationFrame(measure);
}
for(const v of ['desktop','mobile','custom'])$(v).onclick=()=>setView(v);
if(window.ResizeObserver)new ResizeObserver(()=>measure()).observe($('screen'));
window.addEventListener('resize',measure);
function custom(w,h){
  if(Number.isFinite(w))state.custom[0]=clamp(w,240,3840);
  if(Number.isFinite(h))state.custom[1]=clamp(h,200,2160);
  $('width').value=state.custom[0];$('height').value=state.custom[1];measure();
}
for(const name of ['width','height']){
  $(name).addEventListener('change',()=>custom($('width').valueAsNumber,$('height').valueAsNumber));
  $(name).addEventListener('keydown',e=>{if(e.key==='Enter'){custom($('width').valueAsNumber,$('height').valueAsNumber);e.target.blur();}});
}
let drag;
const handle=$('resize-handle');
handle.onpointerdown=e=>{
  if(e.button!==0)return;e.preventDefault();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,dims:[...state.custom],ratio:state.ratio||1};
  handle.setPointerCapture(e.pointerId);
};
handle.onpointermove=e=>{
  if(e.pointerId!==drag?.id)return;
  custom(drag.dims[0]+(e.clientX-drag.x)/drag.ratio,drag.dims[1]+(e.clientY-drag.y)/drag.ratio);
};
handle.onlostpointercapture=handle.onpointerup=handle.onpointercancel=()=>{drag=null;};
handle.onkeydown=e=>{
  const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];
  if(delta){e.preventDefault();custom(state.custom[0]+delta[0],state.custom[1]+delta[1]);}
};
function theme(choice){
  document.documentElement.dataset.theme=choice;
  $('theme-icon').setAttribute('href',choice==='dark'?'#i-sun':'#i-moon');
  $('theme').setAttribute('aria-label',choice==='dark'?'ライトモードに切り替え':'ダークモードに切り替え');
}
const prefers=matchMedia('(prefers-color-scheme: dark)');
let choice;try{choice=localStorage.getItem('zipstage:theme');}catch{}
theme(choice||(prefers.matches?'dark':'light'));
prefers.addEventListener?.('change',e=>{if(!choice)theme(e.matches?'dark':'light');});
$('theme').onclick=()=>{choice=document.documentElement.dataset.theme==='dark'?'light':'dark';theme(choice);try{localStorage.setItem('zipstage:theme',choice);}catch{}};
$('open-help').onclick=()=>$('help-dialog').showModal();
let networkJob;
$('online').onchange=()=>{
  if(!$('online').checked){
    resetSettings();if(state.items)void start();return;
  }
  $('online').checked=false;networkJob=state.job;$('online-dialog').returnValue='cancel';$('online-dialog').showModal();
};
$('online-dialog').onclose=()=>{
  if($('online-dialog').returnValue!=='enable'||networkJob!==state.job)return;
  state.online=true;$('online').checked=true;networkNote();$('npm-option').hidden=!Object.keys(state.packages).length;
  if(state.items)void start();
};
$('npm').onchange=()=>{state.cdn=$('npm').checked;if(state.items)void start();};
$('persist').onchange=()=>{state.persist=$('persist').checked;saveWorkspace();dock.storage();};
let erase;
function openStorage(){
  refreshSaved();if(!$('storage-dialog').open)$('storage-dialog').showModal();
}
function refreshSaved(){
  const host=$('saved-list');host.replaceChildren();
  let records=[];try{records=saved?.list()??[];}catch{}
  if(!records.length){const p=document.createElement('p');p.textContent='保存されたアプリはまだありません。';host.append(p);return;}
  for(const record of records){
    const row=document.createElement('div');row.className='saved-item';const name=document.createElement('span');
    name.textContent=record.name+' · '+Object.keys(record.local??{}).length+' 件'+(record.enabled?' · 保存オン':' · 保存オフ');
    const b=document.createElement('button');b.type='button';b.className='btn danger';b.textContent='削除';b.setAttribute('aria-label',record.name+' のデータを削除');
    b.onclick=()=>{erase=record.id;$('erase-text').textContent=record.name+' の保存データを削除します。';$('erase-dialog').returnValue='cancel';$('erase-dialog').showModal();};
    row.append(name,b);host.append(row);
  }
}
$('open-storage').onclick=openStorage;
$('erase-dialog').onclose=()=>{
  if($('erase-dialog').returnValue!=='erase'||!erase)return;
  try{saved?.erase(erase);}catch{message('保存データを削除できませんでした。','error');return;}
  if(erase===state.key){
    state.persist=false;$('persist').checked=false;state.storage.localStorage={};if(state.items)void start();
  }
  erase=null;refreshSaved();dock.storage();
};
networkNote();setView('desktop');$('focus-preview').disabled=true;
