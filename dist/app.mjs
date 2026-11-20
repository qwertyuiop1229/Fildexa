import {readZip,limits} from './zip.mjs';
import {scan,expand} from './project.mjs';
import {normalizeEntries,listDrop,projectKey,SavedProjects,safeStorage,compile,prettySize,fitViewport,clamp,describePage,appSignature} from './workspace.mjs';
import {createPicker} from './picker.mjs';
import {toolDock} from './tool-dock.mjs';
import {cancelMotion,rectOf,playFlip,enterContent,flashIcon,cornerToggle} from './motion.mjs';
import {previewPolicy,previewSandbox} from './policy.mjs';
import {createLab} from './lab.mjs';
import {acceptsAsset,supported} from './lab-core.mjs';
import {createLayout} from './layout.mjs';
import {nativeControl,probeNative,createNative,stopNative,inspectCompatibility,parseHosted} from './native.mjs';

const $=id=>document.getElementById(id);
const state={job:0,gen:0,archive:null,projects:[],project:null,items:null,original:null,frame:null,session:null,online:false,cdn:false,game:false,mode:'isolated',report:[],view:'desktop',focus:'',open:false,storage:{},packages:{},transformed:[],sourceRoot:'',history:[],index:-1,custom:[900,640],persist:false};
let saved;
try{saved=new SavedProjects(localStorage);}catch{}
const bridge=(action,value)=>{
  const {frame,session}=state;
  if(state.mode!=='isolated'||!frame||!session?.done)return false;
  frame.contentWindow.postMessage({zipstage:session.token,type:'dev',value:{action,value}},'*');return true;
};
const sourceFiles=()=>state.original??[];
let lab,labSettings=null,testStorage={},watchResume=null;
let pathCache={archive:null,project:null,rows:[]};
const stagePaths=()=>{
  const {archive,project}=state;if(!archive)return [];
  if(pathCache.archive===archive&&pathCache.project===project)return pathCache.rows;
  const rows=[];
  for(const f of archive.files.keys()){
    if(!project||f.startsWith(project.root))rows.push(f.slice(project?.root.length??0));
    else if(/(?:^|\/)(?:README\.(?:md|markdown)|package\.json|tsconfig\.json|openapi\.(?:json|ya?ml))$/i.test(f))rows.push('/'+f);
  }
  pathCache={archive,project,rows:rows.filter(Boolean).sort((a,b)=>a.localeCompare(b,'ja'))};
  return pathCache.rows;
};
let layout;
const dock=toolDock($,bridge,{files:sourceFiles,storage:()=>labSettings?testStorage:state.storage,openStorage,reflow:resizeStage,panel:value=>layout?.panel(value),mountSplit:host=>layout?.mount(host),openAsset:path=>lab.openAsset(path),metadata:()=>({online:state.online,native:state.mode!=='isolated',phase:state.frame?'プレビュー中':'未起動',compiler:state.transformed.length,duration:state.startMs})});
const pickers={
  root:createPicker($('root-picker'),'root-label',i=>selectProject(Number(i))),
  page:createPicker($('page-picker'),'page-label',page=>navigate({page})),
  device:createPicker($('device-preset'),'device-label',v=>setView(v))
};
let runnerPromise;
const readScript=async path=>{const r=await fetch(path);if(!r.ok)throw Error('プレビュー用のファイルを読み込めません。');return r.text();};
function runnerCode(){
  if(!runnerPromise)runnerPromise=Promise.all(['./vendor/lexer.js','./dev-bridge.js','./lab-runtime.js','./runner.js'].map(readScript)).then(s=>s.map(x=>x.replace(/<\/script/gi,'<\\/script')).join('\n')).catch(e=>{runnerPromise=null;throw e;});
  return runnerPromise;
}
function message(text='',kind=''){
  const e=$('load-msg');e.hidden=!text;e.textContent=text;e.classList.toggle('error',kind==='error');
}
function phase(text='',kind=''){
  state.phase=kind;lab?.refresh();
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
  lab?.closeAsset();
  const summary=String(e?.message??e??'読み込みに失敗しました。');
  dispose();loading(false);phase(context,'error');message(summary,'error');dock.log({level:'error',message:summary});
  empty(context,summary);$('focus-preview').disabled=true;$('close-project').disabled=false;
}
function switchSidebar(open){
  $('sidebar').classList.toggle('open',open);$('open-sidebar').setAttribute('aria-expanded',String(open));
  if(!open){pickers.root.close();pickers.page.close();}
}
function resetSettings(){
  state.online=false;state.cdn=false;$('online').checked=false;$('npm').checked=false;$('npm-option').hidden=true;networkNote();
}
function stopLocal(){
  const id=state.native?.id;
  // If reset wins the race with startup, wait for its response and release the session it created.
  state.native=null;state.hosted=null;state.nativePending=null;state.mode='isolated';
  $('mode-status').textContent='隔離';
  if(id)void stopNative(id);
}
let compatAvailable=false,compatProbing=nativeControl(location);
function syncCompat(loaded){
  const local=state.mode==='native',hosted=state.mode==='hosted',normal=local||hosted,ready=!!state.items;
  const sourceBuild=state.build&&state.project?.root===state.sourceRoot;
  $('settings').hidden=!loaded||!!state.assetOnly||normal;$('tools').hidden=!loaded||!!state.assetOnly||normal;$('compat-inline').hidden=!loaded||!!state.assetOnly;$('mode-status').hidden=!loaded&&!normal;
  $('mode-status').textContent=local?'ローカル':hosted?'テストURL':'隔離';
  $('compat-summary').textContent=state.report.length?state.report.map(item=>item.label).slice(0,3).join(' · ')+(state.report.length>3?' ほか':''):'実行環境を切り替えられます。';
  $('native-run').disabled=!ready||!compatAvailable||!!state.nativePending||normal||sourceBuild;
  $('isolated-mode').disabled=!normal;
  $('spa-option').hidden=!compatAvailable||local;
  $('native-tab').hidden=!normal;
  if(state.native&&(!$('native-tab').getAttribute('href')||new URL($('native-tab').href).origin!==new URL(state.native.url).origin))$('native-tab').href=state.native.url;
  if(hosted)$('native-tab').href=state.hosted.url;
  if(!normal)$('native-tab').removeAttribute('href');
  $('online').disabled=normal;$('persist').disabled=normal||!!labSettings||!state.key||!saved;
  $('pointer-lock').disabled=normal||!ready;$('npm').disabled=normal;
  $('native-note').textContent=compatProbing?'PC版の起動を確認中…':!compatAvailable?'公開版では起動できません。配布ZIPを展開し、自分のPCで node server.mjs を実行してください。':state.nativePending?'ファイルをローカルで準備中…':sourceBuild?'ローカル互換モードはビルド済みの公開フォルダが必要です。ビルドしてから dist または公開フォルダを開いてください。':local?(state.native?.authLocal?'認証テスト用 localhost:4176。プレビュー内で止まる場合は別タブを使ってください。':'起動中。ログインや権限の確認は別タブも利用できます。'):'ファイルは自分のPC内だけで配信します。開発ツールのJS実行・通信記録は隔離モード用です。';
  const list=$('compat-findings');list.replaceChildren();
  for(const row of state.report.length?state.report:[{label:'調査範囲内で特別な技術は検出されませんでした。',path:''}]){
    const item=document.createElement('li');item.textContent=row.label+(row.path?' · '+row.path:'');list.append(item);
  }
}
function openCompat(){
  syncCompat(!!state.project);
  if(!$('compat-dialog').open)$('compat-dialog').showModal();
}
$('open-compat').onclick=$('mode-status').onclick=openCompat;
$('open-hosted').onclick=()=>{openCompat();$('hosted-url').focus({preventScroll:true});};
$('hosted-form').onsubmit=e=>{
  e.preventDefault();openHosted($('hosted-url').value);
};
function openHosted(value){
  $('hosted-note').textContent='';
  try{
    const parsed=parseHosted(value,location.origin);
    lab.closeAsset();lab.stopWatch();$('test-indicator').hidden=true;labSettings=null;
    stopLocal();state.job++;state.gen++;dispose();state.mode='hosted';state.hosted={url:parsed.href};
    $('close-project').disabled=false;message();resetSettings();dock.close();dock.reset();
    showLocalFrame();syncCompat(true);if($('compat-dialog').open)$('compat-dialog').close();
    $('project-announcement').textContent='テストURLを開きました。表示できないときは、テストURLボタンから別タブで開けます。';
  }catch(err){$('hosted-note').textContent=String(err.message??err);}
};
$('native-run').onclick=async()=>{
  if(!compatAvailable||!state.items||state.nativePending||state.mode!=='isolated'||state.build&&state.project?.root===state.sourceRoot)return;
  const job=state.job,project=state.project,rows=state.items,gen=state.gen;
  const pending=Symbol();state.nativePending=pending;syncCompat(true);
  try{
    const r=await createNative(rows,{entry:state.history[state.index]?.page??project.home,rewrites:project.rewrites,spa:$('spa-fallback').checked||state.report.some(x=>x.id==='spa')});
    if(state.job!==job||state.project!==project||state.nativePending!==pending||state.gen!==gen){await stopNative(r.id);return;}
    lab.closeAsset();$('test-indicator').hidden=true;state.native=r;state.mode='native';dock.close();dock.reset();showLocalFrame();
  }catch(e){
    if(state.nativePending===pending){state.nativePending=null;syncCompat(true);$('native-note').textContent=String(e.message??e);}
  }finally{
    if(state.nativePending===pending){state.nativePending=null;syncCompat(!!state.project);}
  }
};
$('isolated-mode').onclick=()=>{
  if(state.mode==='isolated')return;
  if(!state.items){resetProject();$('compat-dialog').close();return;}
  stopLocal();syncCompat(true);$('test-indicator').hidden=!labSettings;$('compat-dialog').close();void start();
};
function showLocalFrame(page){
  const native=state.native??state.hosted;if(!native)return;
  const remote=state.mode==='hosted';
  dispose();
  const frame=document.createElement('iframe');frame.title=remote?'公開・テストURLのプレビュー':'ローカル互換プレビュー';frame.referrerPolicy='no-referrer';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock');
  frame.setAttribute('allowfullscreen','');frame.setAttribute('allow','fullscreen');
  const url=new URL(native.url);if(page&&!remote)url.pathname='/'+page.split('/').map(encodeURIComponent).join('/');
  frame.src=url.href;$('native-tab').href=url.href;
  state.frame=frame;$('frame-wrap').replaceChildren(frame);$('frame-shell').hidden=false;
  // Separate, ephemeral localhost origins provide native storage without exposing studio storage.
  loading(false);$('empty').hidden=true;phase(remote?'テストURL':'ローカル','ready');$('path-label').textContent=remote?url.host:url.pathname;
  $('focus-preview').disabled=false;$('reload').disabled=false;$('back').disabled=true;$('forward').disabled=true;measure();
}
window.addEventListener('pagehide',e=>{if(!e.persisted&&state.native)void stopNative(state.native.id);});
function networkNote(){
  $('online-description').textContent=state.online?'オン · 外部APIに接続を試みます。CORS・ログインの制限は残ります。':'オフ · 外部リソースとAPI通信を制限します。';
}
function resetGame(){
  state.game=false;$('pointer-lock').checked=false;$('pointer-lock').disabled=true;
}
function resetProject(){
  lab.save();lab.stopWatch();lab.leave();pathCache={archive:null,project:null,rows:[]};labSettings=null;testStorage={};watchResume=null;$('test-indicator').hidden=true;$('project-assets').hidden=true;
  stopLocal();state.report=[];
  state.job++;state.gen++;dispose();
  Object.assign(state,{archive:null,projects:[],project:null,items:null,original:null,packages:{},history:[],index:-1,name:'',size:0,transformed:[],compileErrors:[],build:false,sourceRoot:'',key:null,startMs:null,assetOnly:false});
  resetSettings();resetGame();savedView();syncCompat(false);$('hosted-url').value='';$('hosted-note').textContent='';dock.close();dock.reset();
  setFocus('');setView('desktop');custom(900,640);switchSidebar(false);
  $('file').value='';$('folder').value='';
  $('project-info').hidden=true;$('selection').hidden=true;
  $('project-name').textContent='';$('project-name').removeAttribute('title');$('project-detail').textContent='';
  pickers.root.set([],'');pickers.page.set([],'');
  for(const id of ['reload','back','forward','close-project','focus-preview'])$(id).disabled=true;
  $('path-label').textContent='ファイルを開いて開始';$('path-label').removeAttribute('title');
  $('view-label').removeAttribute('title');message();phase();loading(false);
  empty('ZIPで開く、Webアプリ。','Webアプリは構成を保ったまま。資料や素材はその場で確認。');
  $('project-announcement').textContent='プレビューを閉じました。保存済みデータは保持されています。';
}
function urlState(item){return {...item,hash:item.hash||'',query:item.query||'',request:item.request??item.page};}
function updateRoute(){
  const current=state.history[state.index];if(!current)return;
  $('path-label').textContent=describePage(current);$('path-label').title=$('path-label').textContent;
  $('back').disabled=state.index<1;$('forward').disabled=state.index>=state.history.length-1;
  $('reload').disabled=!state.items;
  pickers.page.value(current.page);$('page-picker').parentElement.hidden=(state.project?.pages.length??0)<2;
  if(state.mode!=='isolated')$('back').disabled=$('forward').disabled=true;
}
function navigate(info,{keep=false}={}){
  const current=urlState(info),prev=state.history[state.index];
  if(prev&&describePage(prev)===describePage(current)&&prev.page===current.page)return;
  state.history.splice(state.index+1);state.history.push(current);state.index=state.history.length-1;
  updateRoute();void start({keep});
}
function go(step){
  if(state.mode!=='isolated')return;
  if(state.index+step<0||state.index+step>=state.history.length)return;
  state.index+=step;updateRoute();void start({keep:true});
}
function savedView(){
  const id=state.key,snapshot=id?saved?.load(id):null;
  state.persist=!!snapshot?.enabled;
  state.storage=state.persist?{localStorage:safeStorage(Object.entries(snapshot.local??{}))}:{};
  $('persist').checked=state.persist;$('persist').disabled=state.mode!=='isolated'||!!labSettings||!id||!saved;
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
  lab.closeAsset();if(state.project&&!watchResume){lab.save();labSettings=null;$('test-indicator').hidden=true;}stopLocal();state.report=[];syncCompat(true);
  state.key=null;
  state.project=project;state.items=null;state.original=null;state.transformed=[];state.compileErrors=[];
  const remembered=watchResume?.route;
  state.history=[urlState(remembered&&project.pages.includes(remembered.page)?remembered:{page:project.home})];state.index=0;
  savedView();
  pickers.page.set(project.pages.map(x=>({value:x,label:'/'+x})),project.home);
  $('project-detail').textContent=prettySize(state.size)+' · '+project.pages.length+' ページ';
  updateRoute();void prepare();
}
async function inspect(input,title,flavor,{watching=false,resume=null}={}){
  lab.save();lab.leave();if(!watching)lab.stopWatch();watchResume=resume;
  labSettings=resume?.lab??null;testStorage=resume?.testStorage??{};$('test-indicator').hidden=!labSettings;$('project-assets').hidden=true;state.assetOnly=false;
  stopLocal();state.report=[];state.items=null;syncCompat(false);$('hosted-note').textContent='';
  const job=++state.job;state.gen++;dispose();dock.reset();resetSettings();resetGame();
  if(resume){state.online=resume.online;state.cdn=resume.cdn;$('online').checked=state.online;$('npm').checked=state.cdn;networkNote();state.game=resume.game;$('pointer-lock').checked=state.game;}
  switchSidebar(false);
  $('close-project').disabled=false;$('project-announcement').textContent='';
  message();phase('解析中');empty('プロジェクトを確認中','HTMLと公開用フォルダを探しています。');loading(true,'ファイル構成を解析中');
  state.name=title;state.items=null;state.original=null;state.archive=null;state.key=null;state.startMs=null;state.project=null;state.packages={};state.compileErrors=[];savedView();
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
    }else if(flavor==='asset'){
      archive=normalizeEntries([{file:input,path:input.name}]);
      detected={candidates:[],sourceRoot:''};
    }else{
      archive=normalizeEntries(input);detected=await scan(archive);
    }
    if(job!==state.job)return;
    state.size=archive.size;state.archive=archive;
    if(!detected.candidates.length){
      const files=stagePaths(),first=files.find(p=>/^(?:.*\/)?readme\.(?:md|markdown)$/i.test(p))??files.find(acceptsAsset);
      if(!first)throw Error('プレビューできるファイルがありません。ビルド済みフォルダか対応する素材を選んでください。');
      state.assetOnly=true;state.projects=[];state.build=!!detected.build;$('project-info').hidden=false;$('project-assets').hidden=false;
      $('project-name').textContent=title;$('project-detail').textContent=prettySize(state.size)+' · '+files.length+' ファイル';
      loading(false);phase('ファイル閲覧','ready');$('path-label').textContent='ファイル閲覧';
      empty('起動するページはありません','ファイルを確認するか、ビルド済みフォルダを開いてください。');
      void lab.openAsset(first);syncCompat(false);$('project-announcement').textContent='ファイル閲覧を開きました。';
      return;
    }
    $('project-assets').hidden=false;state.projects=detected.candidates;state.build=!!detected.build;state.sourceRoot=detected.sourceRoot||'';
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
    const retained=resume?state.projects.findIndex(x=>x.root===resume.root):-1, chosen=Math.max(0,retained);
    pickers.root.set(state.projects.map((x,i)=>({value:String(i),label:(x.root.replace(/\/$/,'')||'/')+' · '+x.kind})),String(chosen));
    $('root-picker').parentElement.hidden=state.projects.length<2;
    selectProject(chosen);
  }catch(e){if(job===state.job)failure(e);}
}
function openSingle(file){
  if(!file)return;
  const flavor=/\.zip$/i.test(file.name)?'zip':/\.html?$/i.test(file.name)?'html':acceptsAsset(file.name)?'asset':'';
  if(flavor)void inspect(file,file.name,flavor);
  else failure(Error('ZIP、フォルダ、HTML、画像やCSVなどの対応ファイルを選んでください。'));
}
async function prepare(){
  const project=state.project,gen=++state.gen;
  dispose();dock.reset();phase('展開中');message();
  empty('ファイルを準備中','フォルダ構成を保ったまま読み込んでいます。');loading(true,'プロジェクトを読み込み中',0);
  try{
    const items=await expand(state.archive,project,(i,n)=>{if(gen===state.gen)loading(true,'読み込み '+i+' / '+n,Math.round(i/n*100));},()=>gen!==state.gen);
    if(gen!==state.gen||!items)return;
    state.original=items;
    void inspectCompatibility(items,()=>state.original!==items).then(rows=>{
      if(state.original!==items)return;
      state.report=rows;syncCompat(true);lab.refresh();
    }).catch(()=>{});
    const signature=await appSignature(items,project.home);
    if(gen!==state.gen)return;
    state.key=projectKey(state.name,project.root,state.sourceRoot,project.kind,signature);
    savedView();
    const prev=lab.project(state.key);if(prev&&!watchResume){
      if(Array.isArray(prev.custom))custom(prev.custom[0],prev.custom[1]);
      if(['desktop','mobile','custom','tablet','landscape'].includes(prev.mode))setView(prev.mode);
      if(project.pages.includes(prev.page)&&typeof prev.query==='string'&&typeof prev.hash==='string'&&typeof prev.request==='string'){state.history=[urlState(prev)];state.index=0;updateRoute();}
    }
    if(watchResume?.storage)state.storage=watchResume.storage;
    const result=await compile(items,(i,n)=>{if(gen===state.gen){phase('変換中');loading(true,'TypeScript・JSX を変換中  '+i+' / '+n,Math.round(i/n*100));}},()=>gen!==state.gen);
    if(!result||gen!==state.gen)return;
    state.items=result.items;state.compileErrors=result.errors;$('pointer-lock').disabled=false;syncCompat(true);
    const originals=new Map(items);
    state.transformed=result.items.filter(([p,file])=>file!==originals.get(p)).map(([p])=>p);
    if(result.errors.length)message(result.errors.length+'件のソースを変換できませんでした。コンソールで確認できます。');
    else if(state.build&&project.root===state.sourceRoot&&!state.online)message('ビルド前の構成です。npm依存が必要な場合は先にビルドするか、外部通信をオンにしてCDNを許可してください。');
    updateRoute();void start();
  }catch(e){if(gen===state.gen)failure(e,'準備できませんでした');}
}
async function start({keep=false}={}){
  if(state.mode!=='isolated'){
    showLocalFrame(state.history[state.index]?.page);
    return;
  }
  if(!state.items)return;
  lab.closeAsset();lab.begin();
  const gen=++state.gen,token=crypto.randomUUID(),online=state.online&&!labSettings?.offline;
  dispose();if(!keep&&!dock.keepAfterReload())dock.reset();else dock.invalidate();
  for(const e of state.compileErrors)dock.log({level:'error',message:e.path+' · '+e.message});
  state.launchAt=performance.now();state.startMs=null;
  phase('起動中');empty('プレビューを起動中','アプリのファイルをブラウザで配置しています。');loading(true,'プレビューの準備');
  try{
    const raw=await runnerCode();if(gen!==state.gen)return;
    const frame=document.createElement('iframe');frame.title='Webアプリのプレビュー';frame.setAttribute('sandbox',previewSandbox(state.game));frame.referrerPolicy='no-referrer';
    const csp=previewPolicy(online);
    frame.srcdoc='<!doctype html><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+raw+'\nzipstageBootstrap('+JSON.stringify(token)+','+online+','+JSON.stringify(csp)+');<\/script>';
    state.frame=frame;state.session={token,gen,ready:false,done:false,scroll:watchResume?.scroll,watch:setTimeout(()=>{
      if(state.session?.token!==token||state.session.done)return;
      loading(false);$('empty').hidden=true;phase('応答待ち','error');
      dock.log({level:'warn',message:'プレビューの応答に時間がかかっています。読み込みログをご確認ください。'});dock.open('console');
    },23000)};
    watchResume=null;$('frame-wrap').replaceChildren(frame);$('frame-shell').hidden=false;measure();
  }catch(e){if(gen===state.gen)failure(e,'起動できませんでした');}
}
window.addEventListener('message',e=>{
  const session=state.session;
  if(!session||e.source!==state.frame?.contentWindow||e.origin!=='null'||e.data?.zipstage!==session.token||session.gen!==state.gen)return;
  const {type,value}=e.data;
  if(type==='ready'&&!session.ready){
    session.ready=true;
    const route=state.history[state.index];
    state.frame.contentWindow.postMessage({zipstage:session.token,type:'start',value:{items:state.items,...route,rewrites:state.project.rewrites,storage:labSettings?testStorage:state.storage,packages:state.packages,cdn:state.online&&state.cdn,transformed:state.transformed,lab:labSettings,scroll:session.scroll}},'*');
  }else if(type==='rendered'&&!session.done){
    session.done=true;clearTimeout(session.watch);
    state.startMs=Math.round(performance.now()-state.launchAt);loading(false);$('empty').hidden=true;
    phase('実行中','ready');lab.save();$('focus-preview').disabled=false;dock.ready();measure();enterContent($('frame-shell'),{duration:170,y:2});
  }else if(type==='fatal'&&!session.done){
    failure(value,'表示できませんでした');dock.open('console');
  }else if(type==='navigate'&&state.project?.pages.includes(value?.page)&&typeof value.hash==='string'){
    navigate({page:value.page,hash:value.hash.slice(0,700),query:typeof value.query==='string'?value.query.slice(0,700):'',request:typeof value.request==='string'?value.request.slice(0,1200):value.page},{keep:true});
  }else if(type==='storage'&&['localStorage','sessionStorage'].includes(value?.type)){
    (labSettings?testStorage:state.storage)[value.type]=safeStorage(value.entries);
    if(!labSettings&&value.type==='localStorage'&&state.persist)saveWorkspace();
    dock.storage();
  }else if(type==='lab-scroll'){
    state.watchScroll?.(Number.isFinite(value)?value:0);
  }else if(typeof type==='string'&&type.startsWith('lab-')){
    lab.receive(type,value);
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
    if(entries.length===1&&entries[0].path===file.name&&(/\.zip$/i.test(file.name)||acceptsAsset(file.name)))openSingle(file);
    else void inspect(entries,entries[0].path.includes('/')?entries[0].path.split('/')[0]:'選択したファイル','folder');
  }catch(e){if(job===state.job)failure(e);}
});
$('demo').onclick=async()=>{
  const job=state.job;$('demo').disabled=true;$('close-project').disabled=false;$('help-dialog').close();
  try{
    const r=await fetch('./sample.zip');if(!r.ok)throw Error('サンプルを開けませんでした。');
    const b=await r.blob();if(job===state.job)void inspect(b,'ZipStage-sample.zip','zip');
  }catch(e){if(job===state.job)failure(e);}
  finally{$('demo').disabled=false;}
};
$('back').onclick=()=>go(-1);$('forward').onclick=()=>go(1);$('reload').onclick=()=>void start();
$('close-project').onclick=resetProject;
$('pointer-lock').onchange=()=>{state.game=$('pointer-lock').checked;if(state.items)void start();};
$('open-sidebar').onclick=$('empty-open').onclick=()=>switchSidebar(true);
$('close-sidebar').onclick=()=>switchSidebar(false);
document.addEventListener('pointerdown',e=>{
  if($('sidebar').classList.contains('open')&&!e.target.closest('.sidebar,.compact-menu,.picker-menu,dialog'))switchSidebar(false);
});
function resizeStage(change){
  const shell=$('frame-shell'), before=rectOf(shell);
  cancelMotion(shell);change();measure();playFlip(shell,before,205);
}
const focusButton=$('exit-focus'), viewPanel=$('preview'), frameShell=$('frame-shell');
const corner=cornerToggle(
  ()=>{focusButton.classList.add('is-visible');focusButton.setAttribute('aria-label','プレビューのみ表示を終了');},
  ()=>{focusButton.classList.remove('is-visible');focusButton.setAttribute('aria-label','右上の縮小ボタンを表示');},
  ()=>{setFocus('workspace');$('focus-preview').focus({preventScroll:true});}
);
function setFocus(value){
  const prev=state.focus;
  if(prev===value)return;
  const sameOuter=!!prev===!!value;
  const target=sameOuter?frameShell:viewPanel;
  const before=rectOf(target);
  cancelMotion(frameShell);cancelMotion(viewPanel);
  pickers.root.close();pickers.page.close();switchSidebar(false);
  if(prev==='only')corner.leave();
  state.focus=value;document.body.dataset.focus=value;
  focusButton.hidden=value!=='only';$('focus-preview').hidden=value!=='workspace';
  if(value==='only')corner.enter();
  const expanded=value==='workspace';
  const button=$('fullscreen'), label=expanded?'作業領域を縮小':'作業領域を拡大';
  button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(expanded));button.title=label;
  $('workspace-icon').setAttribute('href',expanded?'#i-min':'#i-max');flashIcon(button.querySelector('svg'));
  measure();playFlip(target,before,sameOuter?235:265);
}
$('fullscreen').onclick=()=>setFocus(state.focus==='workspace'?'':'workspace');
$('focus-preview').onclick=()=>{if(state.session?.done||state.mode==='native'&&state.native||state.mode==='hosted'&&state.hosted){setFocus('only');focusButton.focus({preventScroll:true});}};
focusButton.onclick=()=>corner.press();
window.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.key!=='Escape'||document.querySelector('dialog[open]'))return;
  if(state.focus){setFocus(state.focus==='only'?'workspace':'');e.preventDefault();}
  else if($('sidebar').classList.contains('open'))switchSidebar(false);
});
function measure(){
  const shell=$('frame-shell'),screen=$('screen');
  if(state.view==='desktop'){shell.classList.remove('fixed');$('view-label').textContent='PC';return;}
  const [w,h]=presets[state.view]??state.custom;
  const fit=fitViewport(w,h,screen.clientWidth,screen.clientHeight);
  state.ratio=fit.ratio;
  shell.classList.add('fixed');
  for(const [key,value] of Object.entries({'scaled-w':fit.w+'px','scaled-h':fit.h+'px','real-w':w+'px','real-h':h+'px',fit:fit.ratio}))shell.style.setProperty('--'+key,value);
  $('view-label').textContent=w+' × '+h;$('view-label').title=w+' × '+h+' px';
}
const presets={mobile:[390,844],tablet:[820,1180],landscape:[1180,820]};
function setView(value){
  const before=rectOf(frameShell);cancelMotion(frameShell);
  state.view=value;$('sizebar').hidden=value!=='custom';$('resize-handle').hidden=value!=='custom';
  for(const v of ['desktop','mobile','custom']){$(v).classList.toggle('on',v===value||v==='mobile'&&!!presets[value]);$(v).setAttribute('aria-pressed',String(v===value||v==='mobile'&&!!presets[value]));}
  $('viewport-more').hidden=value==='desktop';pickers.device.value(state.view);
  measure();playFlip(frameShell,before,240);lab?.save();
}
for(const v of ['desktop','mobile','custom'])$(v).onclick=()=>setView(v);
if(window.ResizeObserver)new ResizeObserver(()=>measure()).observe($('screen'));
window.addEventListener('resize',measure);
function custom(w,h,animate=false){
  const before=animate?rectOf(frameShell):null;
  if(animate)cancelMotion(frameShell);
  if(Number.isFinite(w))state.custom[0]=clamp(w,240,3840);
  if(Number.isFinite(h))state.custom[1]=clamp(h,200,2160);
  $('width').value=state.custom[0];$('height').value=state.custom[1];measure();
  if(animate)playFlip(frameShell,before,195);lab?.save();
}
for(const name of ['width','height']){
  $(name).addEventListener('change',()=>custom($('width').valueAsNumber,$('height').valueAsNumber,true));
  $(name).addEventListener('keydown',e=>{if(e.key==='Enter'){custom($('width').valueAsNumber,$('height').valueAsNumber,true);e.target.blur();}});
}
let drag, dragFrame=0, dragPoint;
const handle=$('resize-handle');
handle.onpointerdown=e=>{
  if(e.button!==0||!e.isPrimary)return;e.preventDefault();
  cancelMotion(frameShell);
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,dims:[...state.custom],ratio:state.ratio||1};
  handle.setPointerCapture(e.pointerId);
};
function dragResize(){
  dragFrame=0;
  if(!drag||!dragPoint)return;
  const [x,y]=dragPoint;dragPoint=null;
  custom(drag.dims[0]+(x-drag.x)/drag.ratio,drag.dims[1]+(y-drag.y)/drag.ratio);
}
handle.onpointermove=e=>{
  if(e.pointerId!==drag?.id)return;
  dragPoint=[e.clientX,e.clientY];
  if(!dragFrame)dragFrame=requestAnimationFrame(dragResize);
};
handle.onlostpointercapture=handle.onpointerup=handle.onpointercancel=e=>{if(e.pointerId!==drag?.id)return;if(dragFrame)cancelAnimationFrame(dragFrame);dragResize();drag=null;dragPoint=null;};
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
lab=createLab($,{
  read:path=>state.archive.blob(path.startsWith('/')?path.slice(1):(state.project?.root??'')+path),
  paths:stagePaths,
  token:()=>state.archive,
  asset:active=>{
    $('asset-stage').hidden=!active;
    $('screen').classList.toggle('show-asset',active);
    if(active)$('empty').hidden=true;
    else if(!state.frame)$('empty').hidden=false;
    $('focus-preview').disabled=active||(!state.frame&&state.mode==='isolated');
  },
  state:()=>({phase:state.phase,report:state.report,compileErrors:state.compileErrors??[],hosted:state.hosted?.url,duration:state.startMs,route:state.history[state.index]?describePage(state.history[state.index]):state.hosted?.url??''}),
  view:()=>({mode:state.view,custom:[...state.custom],...state.history[state.index]}),
  viewport:()=>state.view==='desktop'?[$('frame-wrap').clientWidth||$('screen').clientWidth,$('frame-wrap').clientHeight||$('screen').clientHeight]:presets[state.view]??state.custom,
  snapshot:()=>state.items&&state.mode==='isolated'&&state.history[state.index]?{name:state.name,items:state.items,transformed:state.transformed,home:state.project.home,pages:state.project.pages,rewrites:state.project.rewrites,route:state.history[state.index],files:state.original}:null,
  bridge,runner:runnerCode,ready:()=>!!state.session?.done,
  dock:dock.open,compat:openCompat,file:()=>$('choose-file').click(),folder:()=>$('choose-folder').click(),
  network:dock.reportNetwork,hosted:openHosted,notice:message,
  applied:()=>labSettings,
  apply:opt=>{if(state.mode!=='isolated'||!state.items)return false;if(!labSettings||!opt)testStorage={};labSettings=opt;syncCompat(true);$('test-indicator').hidden=!opt;void start();return true;},
  watch:async(rows,name,first)=>{
    const job=state.job;
    const scroll=first?0:await new Promise(resolve=>{
      const end=value=>{clearTimeout(timer);if(state.watchScroll===end)state.watchScroll=null;resolve(value);};
      const timer=setTimeout(()=>end(0),320);state.watchScroll=end;if(!bridge('lab-scroll'))end(0);
    });
    if(state.job!==job)return;
    const resume=!first&&state.project?{root:state.project.root,route:state.history[state.index],storage:state.storage,testStorage,scroll,lab:labSettings,online:state.online,cdn:state.cdn,game:state.game}:null;
    await inspect(rows,name,'folder',{watching:true,resume});
  }
});
$('file').accept=supported;
$('open-lab').onclick=()=>lab.selection();
$('project-assets').onclick=()=>lab.selection('files');
$('test-indicator').onclick=()=>lab.selection('test');
pickers.device.set([['mobile','スマホ・縦'],['tablet','タブレット・縦'],['landscape','タブレット・横'],['custom','カスタム']].map(([value,label])=>({value,label})),'mobile');
syncCompat(false);networkNote();setView('desktop');$('focus-preview').disabled=true;
layout=createLayout($,dock,resizeStage,measure,()=>{cancelMotion(frameShell);cancelMotion(viewPanel);});
if(compatProbing)void probeNative(AbortSignal.timeout?.(5000)).then(found=>{compatAvailable=!!found;compatProbing=false;syncCompat(!!state.project);});

for(const control of document.querySelectorAll('[data-boot-control]'))control.disabled=false;
