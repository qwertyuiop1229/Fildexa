import {acceptsAsset,assetGroup,classify,githubLinks,publicReport,testShareURL,ext,comparisonRoute,compareFiles,mockRuleProblem} from './lab-core.mjs';
import {createPicker} from './picker.mjs';
import {viewAssets} from './asset-view.mjs';
import {enterContent,cancelMotion} from './motion.mjs';
import {prettySize,safeStorage} from './workspace.mjs';
import {previewSandbox,previewPolicy} from './policy.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,primary=false)=>{const n=el('button',text,'btn'+(primary?' primary':''));n.type='button';n.onclick=fn;return n;};
const note=text=>el('p',text,'quiet');
const strong=text=>el('strong',text);
const icon=name=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg'),u=document.createElementNS(s.namespaceURI,'use');s.setAttribute('aria-hidden','true');u.setAttribute('href','#i-'+name);s.append(u);return s;};
const badge=(text,tone='')=>el('span',text,'lab-badge'+(tone?' '+tone:''));
const empty=(text,symbol='info')=>{const n=el('div',undefined,'lab-empty');n.append(icon(symbol),note(text));return n;};
const grouped=(cls,...nodes)=>{const n=el('div',undefined,cls);n.append(...nodes);return n;};
const live=(cls='quiet')=>{const n=el('p','',cls);n.setAttribute('role','status');return n;};
const input=(type,label)=>{const n=el('input');n.type=type;n.setAttribute('aria-label',label);return n;};
const link=(text,href)=>{const a=el('a',text,'btn');a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
const block=(title,copy)=>{
  const s=el('section',undefined,'lab-block');s.append(el('h3',title));if(copy)s.append(note(copy));return s;
};
const actions=(...nodes)=>{const d=el('div',undefined,'lab-actions');d.append(...nodes);return d;};
const multiline=(label,value='')=>{const n=el('textarea');n.setAttribute('aria-label',label);n.placeholder=label;n.value=value;n.rows=3;return n;};
const field=(title,control)=>{const custom=control.classList.contains('lab-picker'),l=el(custom?'div':'label',undefined,'lab-field'),caption=el('span',title);if(custom)caption.setAttribute('aria-hidden','true');l.append(caption,control);return l;};
let nextPicker=0;
const select=(label,values,selected,owner)=>{
  const host=el('div',undefined,'lab-picker');host.id='lab-picker-'+(++nextPicker);
  const title=el('span',label,'sr-only');title.id=host.id+'-label';host.append(title);
  let value=selected??values[0][0];
  const picker=createPicker(host,title.id,next=>{value=next;host.onchange?.();});
  picker.set(values.map(([value,label])=>({value,label})),value);
  Object.defineProperty(host,'value',{get:()=>value,set:next=>{value=next;picker.value(next);}});
  owner?.push(picker);return host;
};
const activeIds=['missing','csp','request','js'];
const labels={overflow:'横にはみ出しています',small:'24px未満の操作領域',notab:'Tab移動できないカスタムボタン',alt:'代替テキストのない画像',brokenImages:'読み込めなかった画像',hash:'リンク先がないページ内リンク',localLinks:'リンク先が見つからないローカルページ',missingLabel:'名前が見つからない操作部品',lowContrast:'文字と背景色のコントラストが低い可能性',missingLang:'ページの言語指定がありません',missingTitle:'ページタイトルがありません'};
const emptySettings=()=>({offline:false,delay:0,rules:[],epoch:null,timeZone:'',locale:'',date:''});
const tabs=[['diagnosis','診断','info'],['files','ファイル','folder'],['compare','比較','compare'],['test','テスト','lab'],['connect','接続','network']];
export function createLab($,ctx){
  const dialog=$('lab-dialog'),body=$('lab-body'),bar=$('lab-tabs'),host=$('asset-stage'),foot=$('lab-footer');
  let tab='diagnosis', selectedKey='', scope=0, tick=0, counter=0, pendingCheck=null, savedRecipe=[], recipe=[], options=emptySettings(), issues=[], audit=null, frames=null, baseline=null, compareFrames=[], dirty=null, watch=null, panelPickers=[], rulePickers=[], fileQuery='', fileKind='all', fileLimit=75, auditPending=false, framesPending=false, diagnosisKey='', compareRequest=0;
  const connectDraft={git:'',url:'',local:''};
  function resetPickers(list){for(const p of list.splice(0))p.destroy();}
  function readKey(key){try{return JSON.parse(localStorage.getItem('zipstage:session:v1:'+key)??'null');}catch{return null;}}
  function writeKey(key,value){if(key)try{localStorage.setItem('zipstage:session:v1:'+key,JSON.stringify(value));return true;}catch{}return false;}
  function project(key){
    if(!key||key===selectedKey)return null;
    selectedKey=key;const prev=readKey(key);savedRecipe=Array.isArray(prev?.recipe)?prev.recipe.slice(0,40):[];recipe=savedRecipe.map(text=>({text,done:false}));
    options=ctx.applied()?structuredClone(ctx.applied()):emptySettings();return prev?.view??null;
  }
  function save(){
    if(selectedKey&&!writeKey(selectedKey,{recipe:savedRecipe,view:ctx.view()}))return false;
    return !!selectedKey;
  }
  function selection(key=tab){
    const next=tabs.findIndex(t=>t[0]===key);
    if(next<0)return;
    const opened=dialog.open;
    if(opened&&key===tab)return;
    const from=tabs.findIndex(t=>t[0]===tab);
    cleanupCompare();tab=key;render();
    if(!opened)dialog.showModal();
    else enterContent(body,{duration:150,x:next>=from?5:-5,y:0});
  }
  function refresh(){
    if(!dialog.open||!['diagnosis','compare'].includes(tab)||tick||tab==='compare')return;
    tick=requestAnimationFrame(()=>{tick=0;if(dialog.open&&tab==='diagnosis')renderDiagnosis();});
  }
  function issue(id){if(activeIds.includes(id)&&issues.length<400)issues.push({id});refresh();}
  const getFindings=()=>classify({files:ctx.paths(),report:ctx.state().report,issues,status:ctx.state().phase,compileErrors:ctx.state().compileErrors});
  function begin(){issues=[];audit=null;frames=null;auditPending=framesPending=false;pendingCheck=null;diagnosisKey='';refresh();}
  const view=viewAssets(host,{paths:ctx.paths,read:ctx.read,token:ctx.token,mock(row){addRule(row);},back:()=>closeAsset(true),browse:()=>selection('files')});
  async function openAsset(path){
    if(!acceptsAsset(path))return;
    if(dialog.open)dialog.close();ctx.asset(true);await view.open(path);
  }
  function closeAsset(user=false){const active=!!view.current();view.close();ctx.asset(false);if(user&&active){const target=$('open-lab');target?.focus({preventScroll:true});}}
  function leave(){
    closeAsset();begin();selectedKey='';options=emptySettings();recipe=[];savedRecipe=[];pendingCheck=null;fileQuery='';fileKind='all';fileLimit=75;
  }
  function render(focus){
    scope++;resetPickers(panelPickers);resetPickers(rulePickers);cancelMotion(body);body.scrollTop=0;body.replaceChildren();foot.replaceChildren();foot.hidden=true;diagnosisKey='';
    for(const b of bar.children){const active=b.dataset.key===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
    body.setAttribute('aria-labelledby','lab-'+tab);
    if(tab==='diagnosis')renderDiagnosis();
    if(tab==='files')renderFiles();
    if(tab==='compare')renderCompare(focus);
    if(tab==='test')renderTest();
    if(tab==='connect')renderConnect();
  }
  let findingList,auditList,frameList,auditButton,frameButton;
  function renderDiagnosis(){
    if(!findingList?.isConnected){
      const overview=block('プレビューの状態','起動できない原因と、次に確認する場所を案内します。');
      findingList=el('div',undefined,'lab-list');
      const next=actions(button('コンソールを開く',()=>{dialog.close();ctx.dock('console');}),button('動作モードを見る',()=>{dialog.close();ctx.compat();}));
      next.id='diagnosis-next';overview.append(findingList,next);
      const review=block('ページのチェック','今表示しているページのレイアウト・リンク・操作領域を確認。');
      auditButton=button('このページをチェック',()=>{
        if(!auditPending&&ctx.bridge('lab-audit')){auditPending=true;updateAudit();}
      },true);
      auditList=el('div',undefined,'lab-result');auditList.setAttribute('role','status');review.append(actions(auditButton),auditList);
      const perf=block('描画とフレーム','操作時の描画を約1秒だけ計測します。');
      frameButton=button('FPS・フレームを測る',()=>{
        if(!framesPending&&ctx.bridge('lab-frames')){framesPending=true;updateAudit();}
      });
      frameList=el('div',undefined,'lab-result');frameList.setAttribute('role','status');perf.append(actions(frameButton),frameList);
      const share=block('不具合レポート','ログ本文や入力内容を除いた、確認用のJSONです。');
      const saveReport=button('JSONを保存',()=>{
        const state=ctx.state(),value=publicReport({viewport:ctx.viewport(),findings:getFindings(),steps:recipe,metrics:state.duration,network:ctx.network(),route:state.route});
        const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=el('a');
        a.href=url;a.download='ZipStage-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
      });
      saveReport.prepend(icon('download'));share.append(actions(saveReport));
      body.replaceChildren(overview,grouped('lab-card-grid',review,perf),share);
    }
    const findings=getFindings(),key=JSON.stringify(findings);
    if(key!==diagnosisKey){
      diagnosisKey=key;const next=body.querySelector('#diagnosis-next');
      next.hidden=findings.length===0||findings.every(x=>x.id==='empty');
      findingList.replaceChildren(...(findings.length?findings.map(row=>{
        if(row.id==='empty'){
          const card=empty('ZIP・フォルダ・ファイルを開くと、ここに診断が出ます。','file');
          card.append(button('ファイルを開く',()=>{dialog.close();ctx.file();},true));return card;
        }
        const item=el('div',undefined,'lab-finding');
        item.append(badge(row.id==='auth'||row.id==='storage'||row.id==='wasm'?'情報':'確認',row.id==='boot'?'warn':''),grouped('lab-finding-copy',strong(row.title+(row.count>1?' · '+row.count+' 件':'')),note(row.detail)));return item;
      }):[empty('診断対象の問題は見つかっていません。','check')]));
    }
    updateAudit();
  }
  function updateAudit(){
    if(!auditList?.isConnected)return;
    const ready=ctx.ready();
    auditButton.disabled=!ready||auditPending;frameButton.disabled=!ready||framesPending;
    const display=[];
    if(auditPending)display.push(note('ページを確認中…'));
    else if(audit){
      for(const [id,label] of Object.entries(labels))if(audit[id])display.push(el('div',label+(typeof audit[id]==='number'?' · '+audit[id]+' 件':''),'lab-checkline'));
      if(!display.length)display.push(empty('この簡易チェックで問題は見つかりませんでした。','check'));
    }else display.push(note(ready?'表示中のページを対象にします。':'隔離プレビューを開くと確認できます。'));
    auditList.replaceChildren(...display);
    frameList.replaceChildren(...(framesPending?[note('フレームを計測中…')]:frames?[
      grouped('lab-stats',grouped('lab-stat',strong(frames.fps+' FPS'),note('更新回数')),grouped('lab-stat',strong(frames.max+' ms'),note('最長フレーム')),grouped('lab-stat',strong(String(frames.slow)),note('34 ms以上')))
    ]:[note(ready?'ゲーム操作中の引っかかりの目安に。':'隔離プレビューを開くと計測できます。')]));
  }
  function renderFiles(){
    const all=ctx.paths().filter(acceptsAsset).map(p=>({p,group:assetGroup(p),format:ext(p).toUpperCase()}));
    const section=block('ファイルブラウザ','資料・画像・ソースを実行せずに確認します。');
    if(!all.length){section.append(empty('表示できるファイルはまだありません。','folder'),actions(button('ファイルを開く',()=>{dialog.close();ctx.file();},true)));body.append(section);return;}
    const f=input('search','ファイル名を検索');f.placeholder='ファイル名やフォルダを検索';f.value=fileQuery;
    const rows=el('div',undefined,'lab-file-list'),count=live(),chips=el('div',undefined,'lab-filters'),groups={all:'すべて',docs:'資料',media:'素材',data:'データ',code:'コード'};
    const more=button('さらに表示',()=>{const index=fileLimit;fileLimit+=75;list();rows.children[index]?.focus({preventScroll:true});});
    function list(){
      const q=fileQuery.trim().toLowerCase(),found=all.filter(x=>(fileKind==='all'||fileKind===x.group)&&x.p.toLowerCase().includes(q));
      count.textContent=found.length+' 件'+(found.length>fileLimit?' · '+fileLimit+' 件を表示':'');
      rows.replaceChildren(...found.slice(0,fileLimit).map(({p,group,format})=>{
        const slash=p.lastIndexOf('/'),name=p.slice(slash+1),folder=p.slice(0,slash);
        const row=button('',()=>openAsset(p));row.className='lab-file-row';
        row.setAttribute('aria-label',p);row.title=p;
        const meta=grouped('lab-file-title',strong(name));if(folder)meta.append(note(folder));
        row.append(grouped('lab-file-icon',icon(group==='code'?'code':group==='media'?'layer':'file')),meta,badge(format));return row;
      }));
      if(!found.length)rows.append(empty('条件に一致するファイルがありません。','search'));
      more.hidden=found.length<=fileLimit;
      for(const chip of chips.children)chip.setAttribute('aria-pressed',String(chip.dataset.kind===fileKind));
    }
    for(const [key,label] of Object.entries(groups)){
      if(key!=='all'&&!all.some(x=>x.group===key))continue;
      const c=button(label,()=>{fileKind=key;fileLimit=75;list();});c.dataset.kind=key;chips.append(c);
    }
    f.oninput=()=>{fileQuery=f.value;fileLimit=75;list();};
    section.append(f,chips,count,rows,actions(more));body.append(section);list();
  }
  function cleanupCompare(){
    compareRequest++;
    for(const x of compareFrames){clearTimeout(x.timer);cancelAnimationFrame(x.paint);x.ro?.disconnect();x.frame.remove();}
    compareFrames=[];
  }
  function renderCompare(focus=''){
    const current=ctx.snapshot();
    const top=block('変更前と変更後','同じ画面サイズで、2つの版を別々に操作できます。');
    const slots=grouped('lab-card-grid',
      grouped('lab-compare-slot',badge('変更前'),strong(baseline?.name??'まだ固定されていません'),note(baseline?baseline.route.page:'今開いている版を固定します。')),
      grouped('lab-compare-slot',badge('変更後','accent'),strong(current?.name??'まだ開いていません'),note(current?current.route.page:'ZIPやフォルダから確認する版を開きます。')));
    const pin=button(baseline?'今の版で固定を更新':'今の版を変更前に固定',()=>{baseline=ctx.snapshot();cleanupCompare();render('primary');},!baseline);pin.disabled=!current;
    const clear=button('固定を解除',()=>{baseline=null;cleanupCompare();render('primary');});clear.hidden=!baseline;
    const open=button('変更後のファイルを開く',()=>{dialog.close();ctx.file();});open.hidden=!baseline;
    const results=el('section',undefined,'lab-compare-output');
    const run=button('2画面を表示',()=>void sideBySide(baseline,ctx.snapshot(),results,run),true);run.disabled=!baseline||!current;run.hidden=!baseline;
    top.append(slots,actions(...(baseline?[run,open,pin,clear]:[pin])));
    if(!current)top.append(note('Webアプリを隔離プレビューで開くと比較できます。'));
    body.append(top,results);
    if(focus==='primary')(baseline&&!run.disabled?run:baseline?open:pin).focus({preventScroll:true});
    if(baseline&&current){
      const version=scope,left=baseline;
      const assets=block('ファイルの差分','ファイル名・サイズと、比較できる範囲で内容を確認します。');
      const list=el('div',undefined,'lab-list'),status=live();status.textContent='変更を確認中…';
      assets.append(status,list);body.append(assets);
      void compareFiles(left.files,current.files,{cancel:()=>version!==scope||left!==baseline||!assets.isConnected}).then(result=>{
        if(!result||version!==scope||left!==baseline||!assets.isConnected)return;
        const {changes,skipped}=result;
        status.textContent=changes.length?changes.length+' 件の変更'+(changes.length>35?' · 最初の35件':''):'確認した範囲では変更なし';
        if(skipped)status.textContent+=' · '+skipped+' 件は容量または読み込み制限でサイズのみ';
        for(const item of changes.slice(0,35)){
          const kind=item.content?'内容変更':item.before==null?'追加':item.after==null?'削除':'サイズ変更';
          list.append(grouped('lab-diff-row',badge(kind,item.after==null?'warn':'accent'),grouped('lab-file-title',strong(item.path),note(item.content?prettySize(item.after):(item.before==null?'—':prettySize(item.before))+' → '+(item.after==null?'—':prettySize(item.after))))));
        }
      }).catch(()=>{if(assets.isConnected)status.textContent='ファイルの差分を読み込めませんでした。';});
    }
  }
  function loadCompare(row){
    clearTimeout(row.timer);cancelAnimationFrame(row.paint);row.paint=0;
    row.token=crypto.randomUUID();row.startAt=performance.now();row.ready=row.done=false;row.logs=row.errors=0;row.networks.clear();
    row.activity.textContent='起動中…';row.path.textContent='/'+(row.route.request??row.route.page)+(row.route.query??'')+(row.route.hash??'');
    const csp=previewPolicy(false);
    row.frame.srcdoc='<!doctype html><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+row.raw+'\nzipstageBootstrap('+JSON.stringify(row.token)+',false,'+JSON.stringify(csp)+');<\/script>';
    row.timer=setTimeout(()=>{if(!row.done)row.activity.textContent='応答がありません。';},18000);
  }
  async function sideBySide(before,after,results,run){
    if(!before||!after)return;
    cleanupCompare();
    const version=compareRequest;run.disabled=true;run.textContent='準備中…';
    results.replaceChildren(empty('2つのプレビューを準備中…','clock'));
    try{
      const raw=await ctx.runner();
      if(version!==compareRequest||tab!=='compare'||!dialog.open)return;
      const grid=el('div',undefined,'lab-compare-grid');
      const [w,h]=ctx.viewport().map((v,i)=>Math.max(i?200:240,Math.min(Math.round(v),i?2160:3840)));
      results.replaceChildren(grouped('lab-result-head',strong('プレビュー比較'),badge(w+' × '+h+' px'),note('外部通信はオフ。保存領域は左右で独立。')),grid);
      for(const [label,snap] of [['変更前',before],['変更後',after]]){
        const card=el('section',undefined,'lab-compare-card'),pane=el('div',undefined,'lab-compare-frame'),activity=note(''),path=el('span','','lab-preview-path'),frame=el('iframe');
        const route=comparisonRoute(after.route,null,snap.home,snap.pages);
        frame.title=label+'のプレビュー';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox',previewSandbox(false));
        frame.width=w;frame.height=h;frame.style.width=w+'px';frame.style.height=h+'px';pane.append(frame);
        card.append(grouped('lab-preview-head',strong(label),path),pane,activity);grid.append(card);
        const fit=()=>{const scale=Math.min(1,(pane.clientWidth||300)/w,360/h);frame.style.transform='scale('+scale+')';pane.style.height=Math.round(h*scale)+'px';};
        fit();const ro=window.ResizeObserver?new ResizeObserver(fit):null;ro?.observe(pane);
        const row={frame,raw,snap,activity,path,route,ro,networks:new Set(),storage:{},paint:0};compareFrames.push(row);loadCompare(row);
      }
      enterContent(results,{duration:150,y:3});
    }catch(error){if(version===compareRequest)results.replaceChildren(empty(error.message));}
    finally{if(version===compareRequest){run.disabled=false;run.textContent='2画面を再表示';}}
  }
  function compareMessage(e){
    const row=compareFrames.find(x=>e.origin==='null'&&e.source===x.frame.contentWindow&&e.data?.zipstage===x.token);
    if(!row)return;
    const {type,value}=e.data;
    if(type==='ready'&&!row.ready){
      row.ready=true;row.frame.contentWindow.postMessage({zipstage:row.token,type:'start',value:{items:row.snap.items,...row.route,rewrites:row.snap.rewrites,transformed:row.snap.transformed,storage:row.storage}},'*');
    }else if(type==='fatal'&&!row.done){clearTimeout(row.timer);row.activity.textContent='起動できませんでした。';}
    else if(type==='rendered'&&!row.done){row.done=true;clearTimeout(row.timer);row.elapsed=Math.round(performance.now()-row.startAt);}
    else if(type==='network'&&Number.isSafeInteger(value?.id)&&row.networks.size<2000)row.networks.add(value.id);
    else if(type==='log'){row.logs++;if(value?.level==='error')row.errors++;}
    else if(type==='storage'&&['localStorage','sessionStorage'].includes(value?.type))row.storage[value.type]=safeStorage(value.entries);
    else if(type==='navigate'){
      if(!row.snap.pages.includes(value?.page))return;
      const next=comparisonRoute(value,row.route,row.snap.home,row.snap.pages);
      if(next&&row.done){row.route=next;loadCompare(row);}
      return;
    }
    if(row.done&&!row.paint)row.paint=requestAnimationFrame(()=>{row.paint=0;row.activity.textContent=row.elapsed+' ms · ログ '+row.logs+' · エラー '+row.errors+' · 通信 '+row.networks.size;});
  }
  function addRule(row){
    if(options.rules.length>=24){selection('test');const status=body.querySelector('#lab-mock-status');if(status)status.textContent='応答は24件まで追加できます。';return;}
    const next={method:row.method??'GET',path:row.path??'/api/example',status:row.status??200,body:row.body??'[]'};
    const duplicate=options.rules.findIndex(x=>x.path===next.path&&x.method===next.method);
    if(duplicate>=0)options.rules[duplicate]=next;else options.rules.push(next);
    if(dialog.open&&tab==='test')render();else selection('test');
    body.querySelector('#lab-mock')?.scrollIntoView({block:'nearest'});
    const status=body.querySelector('#lab-mock-status');
    if(status)status.textContent=duplicate>=0?'同じメソッド・パスの応答を更新しました。':'OpenAPIからモックを追加しました。';
  }
  function renderTest(){
    const active=ctx.applied(),available=!!ctx.snapshot();
    const overview=grouped('lab-test-overview',badge(active?'条件を適用中':'未適用',active?'accent':''),note(available?'条件は適用後に反映されます。通常とは別の保存領域で試せます。':'Webアプリを隔離プレビューで開くと、ここで条件を適用できます。'));
    const network=block('通信条件','外部通信と、アプリが使う fetch の待ち時間を試します。');
    const clock=block('日時・言語');
    const delay=select('fetchの待ち時間',[['0','遅延なし'],['400','400 ms'],['1200','1.2 秒'],['2500','2.5 秒']],String(options.delay),panelPickers);
    const zone=select('表示タイムゾーン',[['','端末の設定'],['Asia/Tokyo','東京'],['UTC','UTC'],['America/Los_Angeles','ロサンゼルス'],['Europe/Paris','パリ']],options.timeZone,panelPickers);
    const language=select('表示言語',[['','端末の設定'],['ja-JP','日本語'],['en-US','英語']],options.locale,panelPickers);
    const date=input('datetime-local','テスト開始日時');date.value=options.date;
    const offline=input('checkbox','外部通信をオフラインにする');offline.checked=options.offline;
    delay.onchange=()=>options.delay=Number(delay.value);zone.onchange=()=>options.timeZone=zone.value;language.onchange=()=>options.locale=language.value;date.oninput=()=>options.date=date.value;offline.onchange=()=>options.offline=offline.checked;
    network.append(field('外部通信をオフラインにする',offline),field('fetchの待ち時間',delay));
    clock.append(field('開始日時（端末の時刻）',date),grouped('lab-field-pair',field('タイムゾーン',zone),field('言語',language)),note('日時・言語は、アプリ側で指定していない表示形式に反映します。'));
    const staged=live('lab-error');
    const mock=block('APIモック','アプリ内のパスへの fetch に、指定のJSONを返します。OpenAPIファイルからも追加できます。');mock.id='lab-mock';
    const mockStatus=live();mockStatus.id='lab-mock-status';
    const list=el('div',undefined,'lab-list');
    const addMock=button('応答を追加',()=>{
      if(options.rules.length>=24){mockStatus.textContent='応答は24件まで追加できます。';return;}
      options.rules.push({method:'GET',path:'/api/example',status:200,body:'[]'});redrawRules();dirtyState();
      list.lastElementChild?.querySelector('input[type=text]')?.focus({preventScroll:true});list.lastElementChild?.scrollIntoView({block:'nearest'});
      mockStatus.textContent='';
    });
    const apply=button('条件を適用して再読み込み',()=>{
      if(date.validity.badInput){staged.textContent='日時の入力を確認してください。';date.focus();return;}
      const d=date.value?new Date(date.value).getTime():null;
      if(date.value&&!Number.isFinite(d)){staged.textContent='日時の入力を確認してください。';date.focus();return;}
      const bad=mockRuleProblem(options.rules);
      if(bad){
        staged.textContent='応答 '+bad.line+' の'+bad.field+'を確認してください。';
        const row=list.querySelector('[data-rule="'+(bad.line-1)+'"]');
        const selector=bad.field==='応答JSON'?'textarea':bad.field.startsWith('ステータス')?'input[type=number]':'input[type=text]';
        row?.querySelector(selector)?.focus();return;
      }
      options={...options,delay:Number(delay.value),date:date.value,epoch:d,timeZone:zone.value,locale:language.value,offline:offline.checked};
      if(ctx.apply(structuredClone(options)))dialog.close();
      else staged.textContent='隔離プレビューが開いていません。';
    },true);apply.disabled=!available;
    const reset=button('条件を解除',()=>{if(ctx.apply(null)){options=emptySettings();dialog.close();}});
    reset.hidden=!active;
    foot.append(staged,grouped('lab-footer-row',note(active?'現在のプレビューにテスト条件を適用中':'条件を適用するとプレビューが再読み込みされます。'),actions(...(active?[reset,apply]:[apply]))));foot.hidden=!available;
    function redrawRules(){
      resetPickers(rulePickers);list.replaceChildren();
      for(const [i,row] of options.rules.entries()){
        const method=select('HTTPメソッド',['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(v=>[v,v]),row.method,rulePickers),p=input('text','パス'),status=input('number','応答ステータス'),code=multiline('応答JSON',row.body);
        p.value=row.path;p.placeholder='/api/items/{id}';p.maxLength=301;status.value=row.status;status.min=200;status.max=599;code.maxLength=30000;
        const edited=()=>{staged.textContent='';};
        method.onchange=()=>{row.method=method.value;edited();dirtyState();};p.oninput=()=>{row.path=p.value.trim();edited();};status.oninput=()=>{row.status=status.valueAsNumber;edited();};code.oninput=()=>{row.body=code.value;edited();};
        const remove=button('削除',()=>{options.rules.splice(i,1);redrawRules();edited();dirtyState();const next=list.children[Math.min(i,options.rules.length-1)];(next?.querySelector('button')??addMock).focus({preventScroll:true});});
        remove.setAttribute('aria-label','応答 '+(i+1)+' を削除');remove.classList.add('lab-subtle');
        const card=el('div',undefined,'lab-row lab-rule');card.dataset.rule=String(i);
        card.append(grouped('lab-between',badge('応答 '+(i+1)),remove),grouped('lab-rule-fields',field('メソッド',method),field('パス',p),field('状態コード',status)),field('応答JSON',code));list.append(card);
      }
      if(!options.rules.length)list.append(empty('まだモックを設定していません。','code'));
      addMock.disabled=options.rules.length>=24;
    }
    mock.append(list,actions(addMock),mockStatus);
    const steps=block('テストレシピ','よく確認する操作をアプリ別に保存。');
    const caption=live(),stepList=el('div',undefined,'lab-list'),add=input('text','確認する操作');add.maxLength=180;add.placeholder='例　オフラインでメモを保存する';
    const addStep=button('手順を追加',()=>{
      const text=add.value.trim();if(text&&recipe.length<40){recipe.push({text,done:false});add.value='';drawRecipe();add.focus({preventScroll:true});}
    });
    addStep.disabled=true;add.oninput=()=>addStep.disabled=!add.value.trim()||recipe.length>=40;
    add.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addStep.click();}};
    const finish=button('このアプリに保存',()=>{
      const before=savedRecipe;savedRecipe=recipe.map(x=>x.text);
      if(save()){caption.textContent='このアプリに保存しました。';finish.disabled=true;}
      else{savedRecipe=before;caption.textContent='このブラウザに保存できませんでした。';}
    });
    const preset=select('プリセット',[['','プリセットを選ぶ'],['memo','メモの同期'],['login','Googleログイン'],['game','iPadでゲーム'],['date','日付・時間帯']],undefined,panelPickers);
    const examples={memo:['メモを作る','オフラインにする','メモを編集する','通信を戻す','内容が残っている'],login:['検証用URLを別タブで開く','テストアカウントでログイン','ログイン元のページに戻る','再読み込みしてログイン状態を確認'],game:['iPadで縦向きに開く','横向きにして表示を確認','タッチ操作を確認','別のアプリから戻り、音が重複しないことを確認'],date:['固定した日時で開く','タイムゾーンを変更する','翌日・月末の表示を確認']};
    const addPreset=button('追加',()=>{if(examples[preset.value]){recipe.push(...examples[preset.value].slice(0,40-recipe.length).map(text=>({text,done:false})));preset.value='';drawRecipe();}});addPreset.setAttribute('aria-label','プリセットを追加');
    preset.onchange=()=>addPreset.disabled=!preset.value||recipe.length>=40;
    const clearChecks=button('チェックを戻す',()=>{for(const x of recipe)x.done=false;drawRecipe();});
    function recipeState(){
      const done=recipe.filter(s=>s.done).length;
      caption.textContent=recipe.length?done+' / '+recipe.length+' 完了':'手順はまだありません。';
      finish.hidden=!selectedKey;finish.disabled=JSON.stringify(recipe.map(x=>x.text))===JSON.stringify(savedRecipe);
      clearChecks.hidden=!recipe.length;clearChecks.disabled=!done;
      addPreset.disabled=!preset.value||recipe.length>=40;
      addStep.disabled=!add.value.trim()||recipe.length>=40;
    }
    function drawRecipe(){
      stepList.replaceChildren();for(const [i,step] of recipe.entries()){
        const c=input('checkbox',step.text);c.checked=step.done;c.onchange=()=>{step.done=c.checked;recipeState();};
        const b=button('削除',()=>{recipe.splice(i,1);drawRecipe();(stepList.children[Math.min(i,recipe.length-1)]?.querySelector('button')??add).focus({preventScroll:true});});
        b.classList.add('lab-subtle');b.setAttribute('aria-label','手順 '+(i+1)+' を削除');
        const row=el('div',undefined,'lab-step');row.append(field(step.text,c),b);stepList.append(row);
      }
      recipeState();
    }
    steps.append(grouped('lab-inline-form',preset,addPreset),stepList,grouped('lab-inline-form',add,addStep),grouped('lab-between',caption,actions(finish,clearChecks)));
    const check=input('text','確認するCSSセレクター');check.maxLength=240;check.placeholder='#message や .notice';
    const verdict=live();
    const runCheck=button('表示を確認',()=>{
      if(!check.value.trim())return;
      const id=++counter;pendingCheck={id,node:verdict};
      verdict.textContent=ctx.bridge('lab-check',{selector:check.value.trim(),id})?'確認中…':'隔離プレビューを起動してください。';
    });
    const checkForm=grouped('lab-inline-form',check,runCheck);
    runCheck.disabled=true;check.oninput=()=>{runCheck.disabled=!ctx.ready()||!check.value.trim();verdict.textContent='';};
    check.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();runCheck.click();}};
    const auto=block('要素の表示チェック','CSSセレクターで、表示中のページに要素が見えているか確認。');
    auto.append(checkForm,verdict);
    const marker=overview.firstElementChild;
    const dirtyState=()=>{
      const comparable=o=>JSON.stringify([o.offline,o.delay,o.timeZone,o.locale,o.date,o.rules]);
      const dirty=comparable(options)!==comparable(active??emptySettings());
      marker.textContent=dirty?'未反映の変更あり':active?'条件を適用中':'未適用';
      marker.classList.toggle('accent',!!active&&!dirty);marker.classList.toggle('warn',dirty);
      apply.disabled=!available||!!active&&!dirty;
    };
    for(const n of [delay,zone,language,date,offline])for(const prop of ['oninput','onchange'])if(n[prop]){
      const cb=n[prop];n[prop]=e=>{cb(e);staged.textContent='';dirtyState();};
    }
    mock.addEventListener('input',dirtyState);mock.addEventListener('click',dirtyState);
    body.append(overview,grouped('lab-card-grid',network,clock),mock,steps,auto);drawRecipe();redrawRules();dirtyState();
  }
  function renderConnect(){
    const outputStatus=(node,message,error=false)=>{node.replaceChildren(note(message));node.dataset.error=String(error);};
    const tile=(title,copy,symbol)=>{
      const card=block(title,copy);card.querySelector('h3').prepend(icon(symbol));return card;
    };
    const connectionInput=(name,hint,value)=>{
      const n=input('text',name);n.inputMode='url';n.autocomplete='off';n.autocapitalize='off';n.spellcheck=false;
      n.placeholder=hint;n.value=value;return n;
    };
    const formFor=(fieldName,f,cta,run)=>{
      const form=el('form',undefined,'lab-connect-form'),submit=button(cta);submit.type='submit';submit.disabled=!f.value.trim();
      const reset=()=>{submit.disabled=!f.value.trim();};
      f.addEventListener('input',reset);form.append(field(fieldName,f),actions(submit));form.onsubmit=e=>{e.preventDefault();if(f.value.trim()&&!submit.disabled)void run(submit);};return form;
    };
    const github=tile('GitHubから開く','リポジトリ・ブランチ・PRのURLを入力。','code');
    const git=connectionInput('GitHubのURL','https://github.com/owner/repo',connectDraft.git);
    const result=el('div',undefined,'lab-connection-result');result.setAttribute('aria-live','polite');
    github.append(formFor('GitHub URL',git,'ZIPの場所を表示',()=>{
      try{
        const x=githubLinks(git.value);
        const context=link(x.label+' を開く',x.context);
        result.dataset.error='false';
        if(x.archive){
          const download=link('ZIPをダウンロード',x.archive);download.prepend(icon('download'));
          result.replaceChildren(note('ZIPを保存したらZipStageのファイル選択で開いてください。'),actions(download,context));
        }else result.replaceChildren(note('GitHubの「Code」から「Download ZIP」を選べます。'),actions(context));
        enterContent(result,{duration:130,y:2});
      }catch(err){outputStatus(result,err.message,true);}
    }),result);
    git.addEventListener('input',()=>{connectDraft.git=git.value;result.replaceChildren();});
    const device=tile('実機で確認','検証用URLをQRコードにして、iPadやスマホで開きます。','phone');
    const url=connectionInput('検証用のHTTPS URL','https://example.web.app/',connectDraft.url||ctx.state().hosted||'');
    const output=el('div',undefined,'lab-connection-result lab-qr-output');output.setAttribute('aria-live','polite');
    let qrTurn=0;
    device.append(formFor('検証用HTTPS URL',url,'QRコードを表示',async submit=>{
      const ticket=++qrTurn;outputStatus(output,'QRコードを準備中…');submit.disabled=true;
      try{
        const u=testShareURL(url.value);
        const {default:QR}=await import('./vendor/qr/index.mjs');if(ticket!==qrTurn||!output.isConnected)return;
        const q=new QR(-1,1);q.addData(u.href);q.make();const c=el('canvas');c.setAttribute('role','img');c.setAttribute('aria-label','検証URLのQRコード');const n=q.getModuleCount();c.width=c.height=(n+8)*5;
        const g=c.getContext('2d');if(!g)throw Error('このブラウザではQRコードを描画できません。');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#0c1716';
        for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))g.fillRect((x+4)*5,(y+4)*5,5,5);
        output.replaceChildren(c,link('検証URLを別タブで開く',u.href));enterContent(output,{duration:150,y:2});
      }catch(err){if(ticket===qrTurn&&output.isConnected)outputStatus(output,err.message,true);}
      finally{if(ticket===qrTurn)submit.disabled=!url.value.trim();}
    }),output);
    url.addEventListener('input',()=>{connectDraft.url=url.value;qrTurn++;output.replaceChildren();});
    const local=tile('開発サーバー・認証','PCで起動したアプリや、ログイン確認用のサイトを開きます。','screen');
    const origin=connectionInput('開発サーバーのURL','http://localhost:5173/',connectDraft.local);
    const out=el('div',undefined,'lab-connection-result');out.setAttribute('aria-live','polite');
    local.append(formFor('開発サーバーURL',origin,'開く方法を表示',()=>{
      try{
        const u=new URL(origin.value.trim());
        if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password||u.href.length>3500)throw Error();
        out.dataset.error='false';
        const buttons=actions(link('別タブで開く',u.href));
        if(u.protocol==='https:'&&u.origin!==location.origin)buttons.append(button('プレビューにも表示',()=>{dialog.close();ctx.hosted(u.href);}));
        out.replaceChildren(buttons);enterContent(out,{duration:130,y:2});
      }catch{outputStatus(out,'HTTPSか、この端末の localhost のURLを指定してください。',true);}
    }),out);
    origin.addEventListener('input',()=>{connectDraft.local=origin.value;out.replaceChildren();});
    const tips=el('details',undefined,'lab-disclosure');
    tips.append(el('summary','どう使い分ける？'),grouped('lab-mode-guide',grouped('lab-finding-copy',strong('隔離プレビュー'),note('ZIPやフォルダを使った動作確認')),grouped('lab-finding-copy',strong('このPCの開発サーバー'),note('開発中のビルドやSSR')),grouped('lab-finding-copy',strong('検証用のHTTPS'),note('Googleログインやスマホ・iPadでの確認'))),actions(link('Firebaseのテストアカウント', 'https://firebase.google.com/docs/emulator-suite/connect_auth?hl=ja')));
    local.append(tips);
    const folder=tile('フォルダ更新','編集した内容を同じプレビューに反映します。','folder');
    const supported=typeof window.showDirectoryPicker==='function';
    const watchNote=live('lab-watch-status');
    const update=()=>{watchNote.dataset.active=String(!!watch);watchNote.textContent=watch?'追従中 · '+watch.handle.name:supported?'自動追従はオフ':'このブラウザは自動追従に非対応。フォルダを選び直して更新できます。';};
    const watchButton=button('フォルダを選んで追従',async()=>{
      watchButton.disabled=true;
      try{
        const handle=await window.showDirectoryPicker({mode:'read'});
        stopWatch();watchNote.textContent='フォルダを読み込み中…';watch={handle,signature:null,busy:false};
        await poll(true);if(dialog.open&&tab==='connect')dialog.close();
      }catch(e){if(e.name==='AbortError')update();else watchNote.textContent='自動追従を開始できませんでした。'+e.message;}
      finally{watchButton.disabled=false;}
    });
    const stop=button('自動更新を停止',()=>{stopWatch();render();body.querySelector('#watch-control')?.focus({preventScroll:true});});
    stop.id=watchButton.id='watch-control';
    const choose=button('フォルダを選び直す',()=>{dialog.close();ctx.folder();});
    folder.append(watchNote,actions(...(watch?[stop,choose]:supported?[watchButton,choose]:[choose])));
    update();body.append(grouped('lab-card-grid lab-connect-grid',github,device,local,folder));
  }
  async function poll(first=false){
    const w=watch;
    if(!w||w.busy||!first&&document.hidden)return;
    w.busy=true;
    try{
      const rows=[];
      async function list(handle,path=''){
        for await(const [name,file] of handle.entries()){
          if(watch!==w)return;
          if(name.startsWith('.')&&name!=='.output'||name==='node_modules'||name==='__MACOSX')continue;
          if(file.kind==='directory'){if(path.split('/').length<30)await list(file,path+name+'/');}
          else{if(rows.length>=12000)throw Error('追従できるフォルダは12,000ファイルまでです。');const f=await file.getFile();rows.push({file:f,path:w.handle.name+'/'+path+name});}
        }
      }
      await list(w.handle);if(watch!==w)return;
      if(!rows.length)throw Error('フォルダが空です。');
      const signature=JSON.stringify(rows.map(({path,file})=>[path,file.size,file.lastModified]).sort((a,b)=>a[0].localeCompare(b[0])));
      if(w.signature!==signature){w.signature=signature;await ctx.watch(rows,w.handle.name,first);}
      if(watch===w){clearTimeout(dirty);dirty=setTimeout(()=>void poll(),2000);}
    }catch(err){
      if(watch===w){stopWatch();ctx.notice('フォルダの追従を停止しました。'+err.message);}
      if(first)throw err;
    }finally{w.busy=false;}
  }
  function stopWatch(){clearTimeout(dirty);dirty=null;watch=null;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&watch&&!watch.busy){clearTimeout(dirty);void poll();}});
  bar.replaceChildren(...tabs.map(([key,label],i)=>{
    const b=button(label,()=>selection(key));b.prepend(icon(tabs[i][2]));b.id='lab-'+key;b.dataset.key=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','lab-body');
    b.onkeydown=e=>{const index={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[e.key];if(index!==undefined){e.preventDefault();selection(tabs[index][0]);bar.children[index].focus();}};
    return b;
  }));
  dialog.onclose=()=>{if(dialog.open)return;scope++;cleanupCompare();resetPickers(panelPickers);resetPickers(rulePickers);};
  window.addEventListener('message',compareMessage);
  return {selection,project,save,begin,issue,stopWatch,leave,closeAsset,openAsset,refresh,receive(type,value){
    if(type==='lab-issue')issue(value?.id);
    if(type==='lab-check'&&pendingCheck?.id===value?.id&&pendingCheck?.node){pendingCheck.node.textContent=value.pass===null?'セレクターの書き方を確認してください。':value.pass?'表示されています。':'表示されていません。';pendingCheck=null;}
    if(type==='lab-audit'&&value&&typeof value==='object'){auditPending=false;audit=value;updateAudit();}
    if(type==='lab-frames'&&value&&[value.fps,value.max,value.slow].every(Number.isFinite)){framesPending=false;frames=value;updateAudit();}
  }};
}
