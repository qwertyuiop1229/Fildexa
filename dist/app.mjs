import {readZip,limits} from './zip.mjs';
import {scan,expand} from './project.mjs';

const $=id=>document.getElementById(id);
const ui=Object.fromEntries('file drop demo busy progress project-info project-name project-detail load-msg selection root page online online-description online-dialog open-help help-dialog preview screen signal phase desktop mobile reload fullscreen path-label view-label empty empty-title empty-copy frame-wrap log-details log-count log-list'.split(' ').map(k=>[k,$(k)]));
const state={job:0,renderJob:0,archive:null,projects:[],project:null,items:null,frame:null,session:null,online:false,mobile:false,logs:[],storage:{},build:false};
const caps={logs:140,storage:200000};
let runnerPromise;
const readScript = async url => {
  const res=await fetch(url);if(!res.ok)throw new Error('プレビューの起動ファイルを読み込めません。再読み込みしてください。');return res.text();
};
function runnerCode(){
  if(!runnerPromise)runnerPromise=Promise.all([readScript('./vendor/lexer.js'),readScript('./runner.js')]).then(s=>s.map(x=>x.replace(/<\/script/gi,'<\\/script')).join('\n')).catch(err=>{runnerPromise=null;throw err;});
  return runnerPromise;
}
const bytes = n => n>=2**20?(n/2**20).toFixed(n>=10*2**20?0:1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
function busy(value,percent){
  ui.busy.hidden=!value;
  ui.screen.setAttribute('aria-busy',String(value));
  if(value){
    if(percent==null)ui.progress.removeAttribute('value');
    else ui.progress.value=percent;
  }
  ui.progress.setAttribute('aria-label','ZIPの読み込み状況');
}
function report(text='',error=false) {
  ui['load-msg'].hidden=!text;
  ui['load-msg'].classList.toggle('error',error);
  ui['load-msg'].textContent=text;
}
function phase(text='',kind=''){
  ui.phase.hidden=!text;ui.phase.textContent=text;
  ui.signal.className='signal'+(kind?' '+kind:'');
}
function resetLogs(){
  state.logs=[];ui['log-count'].textContent='0';
  ui['log-list'].innerHTML='<p class="quiet">ここに読み込みエラーなどが表示されます。</p>';
}
function addLog(level,message) {
  if(typeof message!=='string'||!message || state.logs.length>=caps.logs)return;
  level=['info','warn','error'].includes(level)?level:'info';
  message=message.slice(0,500);
  const key=level+' '+message;
  if(state.logs.includes(key))return;
  if(!state.logs.length)ui['log-list'].replaceChildren();
  state.logs.push(key);ui['log-count'].textContent=state.logs.length;
  const item=document.createElement('p');item.className=level;
  item.textContent={error:'エラー',warn:'警告',info:'情報'}[level]+' · '+message;
  ui['log-list'].append(item);
}
function dispose(){
  if(state.session)clearTimeout(state.session.watch);
  state.session=null;state.frame?.remove();state.frame=null;ui['frame-wrap'].hidden=true;
}
function empty(title='ZIPを開くと、ここで動きます',copy='CSS、JavaScript、画像も、フォルダ構成を保ったまま。'){
  dispose();ui.empty.hidden=false;ui['empty-title'].textContent=title;ui['empty-copy'].textContent=copy;
}
function options(select,values){
  select.replaceChildren(...values.map(([key,title])=>new Option(title,key)));
}
function selectProject(index,{start=true}={}){
  const project=state.projects[index];
  if(!project)return;
  state.project=project;state.items=null;state.page=project.home;state.hash='';state.storage={};state.renderJob++;
  options(ui.page,project.pages.map(x=>[x,x]));
  ui.page.value=project.home;ui.reload.disabled=true;
  ui['project-detail'].textContent=bytes(state.size)+' · '+project.pages.length+' ページ';
  if(start)void prepare();
}
async function openFile(file) {
  const name=file.name||'sample.zip';
  const job=++state.job;state.renderJob++;state.online=false;ui.online.checked=false;networkNote();
  state.archive=null;state.projects=[];state.items=null;state.project=null;
  resetLogs();report();busy(true);phase('読み込み中');
  ui.selection.hidden=true;ui.reload.disabled=true;ui['project-info'].hidden=true;
  ui['path-label'].textContent='ZIPを確認中';
  empty('読み込み中…','ファイル構成と公開用フォルダを確認しています。');
  try{
    state.size=file.size;state.build=false;state.sourceRoot='';
    if(/\.html?$/i.test(name)){
      if(file.size>limits.entry)throw new Error('HTMLは96 MB以下にしてください。');
      const htmlName='index.html';
      state.archive={files:new Map([[htmlName,{length:file.size}]]),blob:async()=>new Blob([file],{type:'text/html'})};
      state.projects=[{root:'',kind:'単体HTML',home:htmlName,pages:[htmlName],rewrites:[]}];
    }else{
      if(!/\.zip$/i.test(name))throw new Error('ZIPかHTMLファイルを選んでください。');
      if(file.size>limits.zip)throw new Error('ZIPは120 MB以下にしてください。');
      const raw=await file.arrayBuffer();if(job!==state.job)return;
      const archive=readZip(new Uint8Array(raw));
      const detected=await scan(archive);if(job!==state.job)return;
      if(!detected.candidates.length)throw new Error('ZIPにHTMLがありません。index.htmlが入った公開用フォルダをZIPにしてください。');
      state.archive=archive;state.projects=detected.candidates;state.build=detected.build;state.sourceRoot=detected.sourceRoot;
    }
    if(job!==state.job)return;
    ui['project-name'].textContent=name;
    ui['project-name'].title=name;ui['project-info'].hidden=false;
    options(ui.root,state.projects.map((x,i)=>[i,(x.root.replace(/\/$/,'')||'/')+' · '+x.kind]));
    ui.selection.hidden=false;
    selectProject(0,{start:false});
    await prepare();
  }catch(err){
    if(job!==state.job)return;
    busy(false);phase('読み込み失敗','error');report(err.message,true);ui['path-label'].textContent='ファイルを開けませんでした';
    empty('ファイルを開けませんでした','ZIPの中に公開用のHTMLがあるか確認してください。');
  }
}
async function prepare(){
  const project=state.project,id=++state.renderJob,archive=state.archive;
  resetLogs();report();busy(true,0);phase('ZIPを展開中');
  ui['path-label'].textContent='/'+project.home;
  empty('ファイルを展開中…','少し待つとプレビューが始まります。');
  try{
    const items=await expand(archive,project,(i,n)=>{if(id===state.renderJob)busy(true,i/n*100);},()=>id!==state.renderJob);
    if(id!==state.renderJob||!items)return;
    state.items=items;
    const home=items.find(([p])=>p===project.home)?.[1];
    if(state.build&&project.root===state.sourceRoot&&home&&home.size<=2*2**20){
      const html=await home.text();
      if(id!==state.renderJob)return;
      if(/(?:src\s*=\s*["']\/?src\/|\.tsx?["'])/i.test(html)||!state.projects.some(x=>x.priority>=80)){
        report('ビルド前のソースかもしれません。npm run build の後、生成された dist などをZIPにすると動きやすくなります。');
      }
    }
    ui.reload.disabled=false;
    await start();
  }catch(err){
    if(id!==state.renderJob)return;
    busy(false);phase('展開失敗','error');report(err.message,true);
    empty('ZIPを展開できませんでした','暗号化されていないZIPで、もう一度お試しください。');
  }
}
async function start({keepLogs=false}={}){
  if(!state.items)return;
  const id=++state.renderJob,token=crypto.randomUUID(),page=state.page,hash=state.hash||'';
  dispose();if(!keepLogs)resetLogs();
  phase('読み込み中');
  busy(true);ui['path-label'].textContent='/'+page+hash;
  ui['empty-title'].textContent='プレビューを準備中…';ui['empty-copy'].textContent='ZIPの中のHTML・CSS・JavaScriptを読み込んでいます。';ui.empty.hidden=false;
  try{
    const raw=await runnerCode();
    if(id!==state.renderJob)return;
    const frame=document.createElement('iframe');
    frame.title='Webアプリのプレビュー';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    const remote=state.online?' https:':'';
    const online=state.online;
    const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:"+remote+"; style-src 'unsafe-inline' blob: data:"+remote+"; img-src blob: data:"+remote+"; font-src blob: data:"+remote+"; media-src blob: data:"+remote+"; connect-src blob: data:"+(online?' https: wss:':'')+"; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src blob: data:;";
    const boot='<!doctype html><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+raw+'\nzipstageBootstrap('+JSON.stringify(token)+','+online+');<\/script>';
    state.frame=frame;
    state.session={token,id,ready:false,done:false,watch:setTimeout(()=>{if(state.session?.token!==token)return;busy(false);phase('応答待ち','error');addLog('warn','プレビューの準備に時間がかかっています。再読み込みをお試しください。');ui['log-details'].open=true;},18000)};
    frame.srcdoc=boot;
    ui['frame-wrap'].replaceChildren(frame);ui.empty.hidden=true;ui['frame-wrap'].hidden=false;
  }catch(err){if(id===state.renderJob){busy(false);phase('起動失敗','error');report(err.message,true);empty('プレビューを起動できませんでした','ページを再読み込みして、もう一度お試しください。');}}
}
window.addEventListener('message',e=>{
  const session=state.session;
  if(!session||e.source!==state.frame?.contentWindow||e.origin!=='null'||e.data?.zipstage!==session.token||session.id!==state.renderJob)return;
  const {type,value}=e.data;
  if(type==='ready'&&!session.ready){
    session.ready=true;
    state.frame.contentWindow.postMessage({zipstage:session.token,type:'start',value:{items:state.items,page:state.page,hash:state.hash,rewrites:state.project.rewrites,storage:state.storage}},'*');
  }else if(type==='rendered'&&!session.done){
    session.done=true;clearTimeout(session.watch);busy(false);phase('実行中','ready');
  }else if(type==='fatal'&&!session.done){
    busy(false);phase('実行失敗','error');addLog('error',value);empty('表示できませんでした','下の読み込みログを確認してください。');ui['log-details'].open=true;
  }else if(type==='log'&&value){
    addLog(value.level,value.message);
  }else if(type==='navigate'&&state.project?.pages.includes(value?.page) && typeof value.hash==='string'){
    state.page=value.page;state.hash=value.hash.slice(0,1000);ui.page.value=value.page;void start({keepLogs:true});
  }else if(type==='storage'&&['localStorage','sessionStorage'].includes(value?.type)&&Array.isArray(value.entries)){
    let size=0;
    const entries=value.entries.slice(0,100).filter(pair=>{
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||typeof pair[1]!=='string'||pair[0].length>1024||pair[1].length>65536)return false;
      size+=pair[0].length+pair[1].length;return size<=caps.storage;
    });
    state.storage[value.type]=Object.fromEntries(entries);
  }
});
ui.drop.addEventListener('click',()=>ui.file.click());
ui.file.addEventListener('change',()=>{const file=ui.file.files?.[0];ui.file.value='';if(file)void openFile(file);});
function hasFile(e){return Array.from(e.dataTransfer?.types??[]).includes('Files');}
window.addEventListener('dragover',e=>{if(hasFile(e))e.preventDefault();});
window.addEventListener('drop',e=>{if(!hasFile(e))return;e.preventDefault();ui.drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)void openFile(f);});
ui.drop.addEventListener('dragover',e=>{if(hasFile(e)){e.dataTransfer.dropEffect='copy';ui.drop.classList.add('drag');}});
ui.drop.addEventListener('dragleave',()=>ui.drop.classList.remove('drag'));
ui.demo.addEventListener('click',async()=>{
  const observed=state.job;
  ui.demo.disabled=true;
  try{const response=await fetch('./sample.zip');if(!response.ok)throw new Error('サンプルを読み込めませんでした。');const blob=await response.blob();
    if(observed===state.job)void openFile(new File([blob],'ZipStage-sample.zip',{type:'application/zip'}));
  }catch(e){report(e.message,true);}
  finally{ui.demo.disabled=false;}
});
ui.root.addEventListener('change',()=>selectProject(Number(ui.root.value)));
ui.page.addEventListener('change',()=>{state.page=ui.page.value;state.hash='';void start();});
ui.reload.addEventListener('click',()=>void start());
function mobile(value){
  state.mobile=value;ui['frame-wrap'].classList.toggle('mobile',value);ui['view-label'].textContent=value?'スマホ':'PC';
  for(const [el,on] of [[ui.desktop,!value],[ui.mobile,value]]){el.classList.toggle('on',on);el.setAttribute('aria-pressed',String(on));}
}
ui.desktop.addEventListener('click',()=>mobile(false));ui.mobile.addEventListener('click',()=>mobile(true));
ui.fullscreen.addEventListener('click',async()=>{
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if(ui.preview.classList.contains('maximized')){ui.preview.classList.remove('maximized');return;}
  try{if(!ui.preview.requestFullscreen)throw new Error();await ui.preview.requestFullscreen();}
  catch{ui.preview.classList.add('maximized');}
});
window.addEventListener('keydown',e=>{if(e.key==='Escape')ui.preview.classList.remove('maximized');});
ui['open-help'].addEventListener('click',()=>ui['help-dialog'].showModal());
function networkNote(){ui['online-description'].textContent=state.online?'オン · ZIPのコードが外部APIに通信できます。':'オフ · 外部の画像、スクリプト、API通信は読み込みません。';}
let onlineJob=0;
ui.online.addEventListener('change',()=>{
  if(!ui.online.checked){state.online=false;networkNote();if(state.items)void start();return;}
  ui.online.checked=false;
  onlineJob=state.job;ui['online-dialog'].returnValue='cancel';ui['online-dialog'].showModal();
});
ui['online-dialog'].addEventListener('close',()=>{
  if(ui['online-dialog'].returnValue!=='enable'||onlineJob!==state.job)return;
  state.online=true;ui.online.checked=true;networkNote();if(state.items)void start();
});
