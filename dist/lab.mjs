import {acceptsAsset,assetBlob,classify,githubLinks,publicReport,sortedChanges,testShareURL} from './lab-core.mjs';
import {createPicker} from './picker.mjs';
import {viewAssets} from './asset-view.mjs';
import {prettySize} from './workspace.mjs';
import {previewSandbox,previewPolicy} from './policy.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,primary=false)=>{const n=el('button',text,'btn'+(primary?' primary':''));n.type='button';n.onclick=fn;return n;};
const note=text=>el('p',text,'quiet');
const strong=text=>el('strong',text);
const input=(type,label)=>{const n=el('input');n.type=type;n.setAttribute('aria-label',label);return n;};
const link=(text,href)=>{const a=el('a',text,'btn');a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
const block=(title,copy)=>{
  const s=el('section',undefined,'lab-block');s.append(el('h3',title));if(copy)s.append(note(copy));return s;
};
const actions=(...nodes)=>{const d=el('div',undefined,'lab-actions');d.append(...nodes);return d;};
const multiline=(label,value='')=>{const n=el('textarea');n.setAttribute('aria-label',label);n.placeholder=label;n.value=value;n.rows=3;return n;};
const field=(title,control)=>{const l=el('label',undefined,'lab-field');l.append(el('span',title),control);return l;};
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
const tabs=[['diagnosis','診断'],['files','ファイル'],['compare','比較'],['test','テスト'],['connect','接続']];
export function createLab($,ctx){
  const dialog=$('lab-dialog'),body=$('lab-body'),bar=$('lab-tabs'),host=$('asset-stage');
  let tab='diagnosis', selectedKey='', scope=0, tick=0, counter=0, pendingCheck=null, savedRecipe=[], recipe=[], options=emptySettings(), issues=[], audit=null, frames=null, baseline=null, compareFrames=[], dirty=null, watch=null, panelPickers=[], rulePickers=[];
  function resetPickers(list){for(const p of list.splice(0))p.destroy();}
  function readKey(key){try{return JSON.parse(localStorage.getItem('zipstage:session:v1:'+key)??'null');}catch{return null;}}
  function writeKey(key,value){if(key)try{localStorage.setItem('zipstage:session:v1:'+key,JSON.stringify(value));return true;}catch{}return false;}
  function project(key){
    if(!key||key===selectedKey)return null;
    selectedKey=key;const prev=readKey(key);savedRecipe=Array.isArray(prev?.recipe)?prev.recipe.slice(0,40):[];recipe=savedRecipe.map(text=>({text,done:false}));
    options=emptySettings();return prev?.view??null;
  }
  function save(){
    if(selectedKey&&!writeKey(selectedKey,{recipe:savedRecipe,view:ctx.view()}))return false;
    return !!selectedKey;
  }
  function selection(key){
    if(!tabs.some(t=>t[0]===key))return;
    cleanupCompare();
    tab=key;render();if(!dialog.open)dialog.showModal();
  }
  function refresh(){
    if(!dialog.open||!['diagnosis','compare'].includes(tab)||tick||tab==='compare')return;
    tick=requestAnimationFrame(()=>{tick=0;if(dialog.open&&tab==='diagnosis')renderDiagnosis();});
  }
  function issue(id){if(activeIds.includes(id)&&issues.length<400)issues.push({id});refresh();}
  const getFindings=()=>classify({files:ctx.paths(),report:ctx.state().report,issues,status:ctx.state().phase,compileErrors:ctx.state().compileErrors});
  function begin(){issues=[];audit=null;frames=null;pendingCheck=null;refresh();}
  const view=viewAssets(host,{paths:ctx.paths,read:ctx.read,token:ctx.token,mock(row){selection('test');addRule(row);},back:()=>closeAsset()});
  async function openAsset(path){
    if(!acceptsAsset(path))return;
    if(dialog.open)dialog.close();ctx.asset(true);await view.open(path);
  }
  function closeAsset(){view.close();ctx.asset(false);}
  function leave(){
    closeAsset();begin();selectedKey='';options=emptySettings();recipe=[];savedRecipe=[];pendingCheck=null;
  }
  function render(){
    scope++;resetPickers(panelPickers);resetPickers(rulePickers);body.scrollTop=0;body.replaceChildren();
    for(const b of bar.children){const active=b.dataset.key===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
    body.setAttribute('aria-labelledby','lab-'+tab);
    if(tab==='diagnosis')renderDiagnosis();
    if(tab==='files')renderFiles();
    if(tab==='compare')renderCompare();
    if(tab==='test')renderTest();
    if(tab==='connect')renderConnect();
  }
  let findingList,auditList,auditButton,frameButton;
  function renderDiagnosis(){
    if(!findingList?.isConnected){
      const overview=block('表示されないとき','読み込んだファイルと実行中に見つかった問題を分けて表示。');
      findingList=el('div',undefined,'lab-list');overview.append(findingList,actions(button('コンソールを開く',()=>{dialog.close();ctx.dock('console');}),button('動作モードを見る',()=>{dialog.close();ctx.compat();})));
      const review=block('公開前チェック','今のページを確認。別ページや実機での確認も必要です。');
      auditButton=button('このページをチェック',()=>{if(ctx.bridge('lab-audit'))auditList.replaceChildren(note('ページを確認中…'));});
      frameButton=button('FPS・フレームを測る',()=>{if(ctx.bridge('lab-frames'))frameButton.disabled=true;});
      auditList=el('div',undefined,'lab-list');review.append(actions(auditButton,frameButton),auditList);
      const share=block('不具合レポート','画面サイズ、診断の件数、通信の状態をJSONで保存。ログ本文・URLのパスや入力内容は含めません。');
      share.append(button('JSONを保存',()=>{
        const state=ctx.state(),value=publicReport({viewport:ctx.viewport(),findings:getFindings(),steps:recipe,metrics:state.duration,network:ctx.network(),route:state.route});
        const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=el('a');
        a.href=url;a.download='ZipStage-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
      }));
      body.replaceChildren(overview,review,share);
    }
    const findings=getFindings();
    if(document.activeElement!==auditButton&&document.activeElement!==frameButton){
      auditButton.disabled=!ctx.ready();frameButton.disabled=!ctx.ready();
    }
    findingList.replaceChildren(...(findings.length?findings.map(row=>{
      const item=el('div',undefined,'lab-row finding');item.append(strong(row.title+(row.count>1?' · '+row.count+' 件':'')),note(row.detail));return item;
    }):[note('今のところ、診断対象の問題は見つかっていません。')]));
    updateAudit();
  }
  function updateAudit(){
    if(!auditList?.isConnected)return;
    const display=[];
    if(audit){
      for(const [id,label] of Object.entries(labels))if(audit[id])display.push(note(label+(typeof audit[id]==='number'?' · '+audit[id]+' 件':'')));
      if(!display.length)display.push(note('この簡易チェックでは問題が見つかりませんでした。'));
    }
    if(frames)display.push(note(frames.fps+' FPS · 最大 '+frames.max+' ms · 34 ms以上 '+frames.slow+' フレーム（約1秒間）'));
    if(display.length)auditList.replaceChildren(...display);
  }
  function renderFiles(){
    const all=ctx.paths().filter(acceptsAsset);
    const section=block('ファイル','資料・画像・ソースを実行せずに確認できます。');
    const f=input('search','ファイル名を検索');f.placeholder='ファイル名を検索';
    const rows=el('div',undefined,'lab-list'),count=note('');
    const list=()=>{
      const q=f.value.toLowerCase(),found=all.filter(p=>p.toLowerCase().includes(q));
      count.textContent=found.length+' 件'+(found.length>160?' · 先頭160件':'');
      rows.replaceChildren(...found.slice(0,160).map(p=>button(p,()=>openAsset(p))));
      if(!found.length)rows.append(note(all.length?'一致するファイルがありません。':'最初にファイル、ZIP、またはフォルダを開いてください。'));
    };
    f.oninput=list;section.append(f,count,rows);body.append(section);list();
  }
  function cleanupCompare(){
    for(const x of compareFrames){clearTimeout(x.timer);x.ro?.disconnect();x.frame.remove();}
    compareFrames=[];
  }
  function renderCompare(){
    const top=block('変更前と変更後','今の版を「変更前」に固定してから、新しいZIPやフォルダを開きます。画面サイズをそろえて比較できます。');
    const status=note(baseline?'変更前 · '+baseline.name:'変更前の版が未設定です。'),current=ctx.snapshot();
    const pin=button('今の版を変更前に固定',()=>{baseline=ctx.snapshot();render();},true);pin.disabled=!current;
    const clear=button('固定を解除',()=>{baseline=null;cleanupCompare();render();});clear.hidden=!baseline;
    const run=button('2画面を表示',()=>void sideBySide(baseline,ctx.snapshot(),results,run));run.disabled=!baseline||!current;
    top.append(status,actions(pin,clear,run));body.append(top);
    const results=el('section',undefined,'lab-compare-output');body.append(results);
    if(baseline&&current){
      const changes=sortedChanges(baseline.fileSizes,current.fileSizes);
      const assets=block('ファイルの増減','サイズが変わらない修正はここには出ません。');
      for(const item of changes.slice(0,35)){
        const row=el('div',undefined,'lab-row');row.append(strong(item.path),note((item.before==null?'追加':prettySize(item.before))+' → '+(item.after==null?'削除':prettySize(item.after))));assets.append(row);
      }
      if(!changes.length)assets.append(note('ファイル名とサイズに変更はありません。'));
      else if(changes.length>35)assets.append(note('全 '+changes.length+' 件のうち先頭35件'));
      body.append(assets);
    }
  }
  async function sideBySide(before,after,results,run){
    if(!before||!after)return;
    cleanupCompare();
    const version=scope;run.disabled=true;
    results.replaceChildren(note('プレビューを準備中…'));
    try{
      const raw=await ctx.runner();
      if(version!==scope||tab!=='compare'||!dialog.open)return;
      results.replaceChildren();
      const grid=el('div',undefined,'lab-compare-grid');results.append(grid);
      const [w,h]=ctx.viewport().map((v,i)=>Math.max(i?200:240,Math.min(Math.round(v),i?2160:3840)));
      results.append(note('両方とも '+w+' × '+h+' px。外部通信オフ。保存領域は左右で独立しています。'));
      for(const [label,snap] of [['変更前',before],['変更後',after]]){
        const card=el('section',undefined,'lab-compare-card'),pane=el('div',undefined,'lab-compare-frame'),activity=note('起動中…'),frame=el('iframe');
        const token=crypto.randomUUID(), startAt=performance.now(),route=snap.pages.includes(after.route.page)?{...after.route}:{page:snap.home};
        frame.title=label+'のプレビュー';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox',previewSandbox(false));
        const csp=previewPolicy(false);
        frame.srcdoc='<!doctype html><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+raw+'\nzipstageBootstrap('+JSON.stringify(token)+',false,'+JSON.stringify(csp)+');<\/script>';
        frame.style.width=w+'px';frame.style.height=h+'px';pane.append(frame);
        card.append(strong(label+' · '+snap.name),pane,activity);grid.append(card);
        const fit=()=>{const scale=Math.min(1,(pane.clientWidth||300)/w,330/h);frame.style.transform='scale('+scale+')';pane.style.height=Math.round(h*scale)+'px';};
        fit();const ro=window.ResizeObserver?new ResizeObserver(fit):null;ro?.observe(pane);
        const row={token,frame,ready:false,done:false,activity,route,snap,startAt,logs:0,networks:new Set(),errors:0,ro};compareFrames.push(row);
        row.timer=setTimeout(()=>{if(!row.done)activity.textContent='応答がありません。';},18000);
      }
    }catch(error){if(version===scope)results.replaceChildren(note(error.message));}
    finally{if(version===scope)run.disabled=false;}
  }
  function compareMessage(e){
    const row=compareFrames.find(x=>e.origin==='null'&&e.source===x.frame.contentWindow&&e.data?.zipstage===x.token);
    if(!row)return;
    const {type,value}=e.data;
    if(type==='ready'&&!row.ready){row.ready=true;row.frame.contentWindow.postMessage({zipstage:row.token,type:'start',value:{items:row.snap.items,...row.route,rewrites:row.snap.rewrites,transformed:row.snap.transformed}},'*');}
    else if(type==='fatal'&&!row.done){clearTimeout(row.timer);row.activity.textContent='起動できませんでした。';}
    else if(type==='rendered'&&!row.done){row.done=true;clearTimeout(row.timer);row.elapsed=Math.round(performance.now()-row.startAt);}
    else if(type==='network'&&Number.isSafeInteger(value?.id)&&row.networks.size<2000)row.networks.add(value.id);
    else if(type==='log'){row.logs++;if(value?.level==='error')row.errors++;}
    else if(type==='navigate')row.activity.textContent='移動に対応するページを確認中…';if(row.snap.pages.includes(value?.page)){row.route={page:value.page,query:String(value.query??'').slice(0,700),hash:String(value.hash??'').slice(0,700),request:String(value.request??'').slice(0,1200)};clearTimeout(row.timer);row.startAt=performance.now();row.ready=row.done=false;row.logs=row.errors=0;row.networks.clear();row.frame.srcdoc=row.frame.srcdoc;row.timer=setTimeout(()=>{if(!row.done)row.activity.textContent='応答がありません。';},18000);}
    if(row.done&&type!=='navigate')row.activity.textContent=row.elapsed+' ms · ログ '+row.logs+' · エラー '+row.errors+' · 通信 '+row.networks.size;
  }
  function addRule(row){
    if(options.rules.length>=24)return;
    const next={method:row.method??'GET',path:row.path??'/api/example',status:row.status??200,body:row.body??'[]'};
    options.rules.push(next);render();
  }
  function renderTest(){
    const app=ctx.snapshot();
    const conditions=block('通信・日時のテスト','隔離プレビュー用です。実際の回線・時計・保存データは変えず、別のテスト用保存領域を使います。');
    const delay=select('fetchの待ち時間',[['0','遅延なし'],['400','400 ms'],['1200','1.2 秒'],['2500','2.5 秒']],String(options.delay),panelPickers);
    const zone=select('表示タイムゾーン',[['','端末の設定'],['Asia/Tokyo','東京'],['UTC','UTC'],['America/Los_Angeles','ロサンゼルス'],['Europe/Paris','パリ']],options.timeZone,panelPickers);
    const language=select('表示言語',[['','端末の設定'],['ja-JP','日本語'],['en-US','英語']],options.locale,panelPickers);
    const date=input('datetime-local','テスト開始日時');date.value=options.date;
    const offline=input('checkbox','外部通信をオフラインにする');offline.checked=options.offline;
    delay.onchange=()=>options.delay=Number(delay.value);zone.onchange=()=>options.timeZone=zone.value;language.onchange=()=>options.locale=language.value;date.oninput=()=>options.date=date.value;offline.onchange=()=>options.offline=offline.checked;
    const help=note('オフラインは外部通信を停止。遅延・モックは fetch のみ。タイムゾーンと言語は、書式を指定していない日時表示などに適用します。');
    const grid=el('div',undefined,'lab-form-grid');grid.append(field('fetchの待ち時間',delay),field('表示タイムゾーン',zone),field('表示言語',language),field('テスト開始日時（端末時間）',date));
    const staged=note('');
    const apply=button('条件を適用して再読み込み',()=>{
      const d=date.value?new Date(date.value).getTime():null;if(date.value&&!Number.isFinite(d)){staged.textContent='日時を正しい形式で入力してください。';return;}
      if(options.rules.some(r=>!/^\/(?!\/)[^\s?#]{0,300}$/.test(r.path)||!Number.isInteger(r.status)||r.status<200||r.status>599||r.body.length>30000||!validJSON(r.body))){staged.textContent='モックのパス・ステータス・JSONを確認してください。';return;}
      options={...options,delay:Number(delay.value),date:date.value,epoch:d,timeZone:zone.value,locale:language.value,offline:offline.checked};
      ctx.apply(structuredClone(options));dialog.close();
    },true);apply.disabled=!app;
    conditions.append(field('外部通信をオフラインにする',offline),grid,help);
    const mock=block('APIのモック','同じアプリ内のパスを指定すると、fetch にサンプル応答を返せます。OpenAPIファイルからも追加できます。');
    const list=el('div',undefined,'lab-list');
    const redrawRules=()=>{
      resetPickers(rulePickers);list.replaceChildren();
      for(const [i,row] of options.rules.entries()){
        const method=select('HTTPメソッド',['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(v=>[v,v]),row.method,rulePickers),p=input('text','パス'),status=input('number','応答ステータス'),code=multiline('応答JSON',row.body);
        p.value=row.path;p.placeholder='/api/items/{id}';p.maxLength=301;status.value=row.status;status.min=200;status.max=599;code.maxLength=30000;
        method.onchange=()=>row.method=method.value;p.oninput=()=>row.path=p.value.trim();status.oninput=()=>row.status=status.valueAsNumber;code.oninput=()=>row.body=code.value;
        const card=el('div',undefined,'lab-row');const fields=el('div',undefined,'lab-form-grid');fields.append(field('メソッド',method),field('パス',p),field('ステータス',status));
        card.append(fields,field('応答JSON',code),button('この応答を削除',()=>{options.rules.splice(i,1);redrawRules();}));list.append(card);
      }
      if(!options.rules.length)list.append(note('モックは設定されていません。'));
    };
    mock.append(list,button('応答を追加',()=>{if(options.rules.length<24){options.rules.push({method:'GET',path:'/api/example',status:200,body:'[]'});redrawRules();}else staged.textContent='応答は24件まで追加できます。';}),actions(apply,button('適用中の条件を解除',()=>{options=emptySettings();ctx.apply(null);render();})),staged);
    const steps=block('テストレシピ','よく確認する操作を、アプリ別のチェックリストとして保存できます。');
    const caption=note(''),stepList=el('div',undefined,'lab-list'),add=input('text','確認する操作');add.maxLength=180;add.placeholder='例　オフラインでメモを保存する';
    const addStep=button('手順を追加',()=>{
      const text=add.value.trim();if(text&&recipe.length<40){recipe.push({text,done:false});add.value='';drawRecipe();}
    });
    add.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addStep.click();}};
    const finish=button('手順をこのアプリに保存',()=>{savedRecipe=recipe.map(x=>x.text);caption.textContent=save()?'このアプリに保存しました。':'先にアプリを開いてください。';});
    const preset=select('プリセット',[['','プリセットを選ぶ'],['memo','メモの同期'],['login','Googleログイン'],['game','iPadでゲーム'],['date','日付・時間帯']],undefined,panelPickers);
    const examples={memo:['メモを作る','オフラインにする','メモを編集する','通信を戻す','内容が残っている'],login:['検証用URLを別タブで開く','テストアカウントでログイン','ログイン元のページに戻る','再読み込みしてログイン状態を確認'],game:['iPadで縦向きに開く','横向きにして表示を確認','タッチ操作を確認','別のアプリから戻り、音が重複しないことを確認'],date:['固定した日時で開く','タイムゾーンを変更する','翌日・月末の表示を確認']};
    function drawRecipe(){
      stepList.replaceChildren();for(const [i,step] of recipe.entries()){
        const c=input('checkbox',step.text);c.checked=step.done;c.onchange=()=>{step.done=c.checked;caption.textContent=recipe.filter(s=>s.done).length+' / '+recipe.length+' 完了';};
        const b=button('削除',()=>{recipe.splice(i,1);drawRecipe();});b.setAttribute('aria-label','手順 '+(i+1)+' を削除');
        const row=el('div',undefined,'lab-step');row.append(field(step.text,c),b);stepList.append(row);
      }
      caption.textContent=recipe.length?recipe.filter(s=>s.done).length+' / '+recipe.length+' 完了':'手順はまだありません。';
    }
    const check=input('text','確認するCSSセレクター');check.maxLength=240;check.placeholder='#message や .notice';
    const verdict=note('');verdict.setAttribute('role','status');
    const test=button('要素が表示されているか確認',()=>{
      if(!check.value.trim())return;
      const id=++counter;pendingCheck={id,node:verdict};
      verdict.textContent=ctx.bridge('lab-check',{selector:check.value.trim(),id})?'確認中…':'隔離プレビューを起動してください。';
    });test.disabled=!ctx.ready();
    steps.append(preset,button('プリセットを追加',()=>{if(examples[preset.value]){recipe.push(...examples[preset.value].slice(0,40-recipe.length).map(text=>({text,done:false})));drawRecipe();}}),stepList,actions(add,addStep),actions(finish,button('完了チェックを戻す',()=>{for(const x of recipe)x.done=false;drawRecipe();})),caption);
    const auto=block('画面の簡易チェック','CSSセレクターで、今の画面に要素が見えているかを調べます。');
    auto.append(field('確認する要素',check),test,verdict);
    body.append(conditions,mock,steps,auto);drawRecipe();redrawRules();
  }
  function validJSON(s){try{JSON.parse(s);return true;}catch{return false;}}
  function renderConnect(){
    const github=block('GitHubからZIPを取得','ダウンロードしたZIPを戻って開きます。Codespacesやビルドの起動はしません。');
    const git=input('url','GitHubのURL');git.placeholder='https://github.com/owner/repo';git.required=true;
    const result=el('div',undefined,'lab-actions');
    const form=el('form',undefined,'lab-actions'), submit=button('ZIPの場所を表示');submit.type='submit';
    form.append(git,submit);form.onsubmit=e=>{e.preventDefault();try{const x=githubLinks(git.value);result.replaceChildren(link(x.label+' を開く',x.context));if(x.archive)result.append(link('ZIPをダウンロード',x.archive));else result.append(note('GitHubで Code → Download ZIP を選択。ビルド済みは Releases も確認できます。'));}catch(err){result.replaceChildren(note(err.message));}};
    github.append(form,result);
    const device=block('別の端末で開く','iPhone・iPadならカメラで読み取れます。検証用HTTPSページを共有し、ZIPの中身は送信しません。');
    const url=input('url','検証用のHTTPS URL');url.placeholder='https://example.web.app/';const state=ctx.state();if(state.hosted)url.value=state.hosted;
    const output=el('div',undefined,'lab-qr-output');
    const qrForm=el('form',undefined,'lab-actions'),make=button('QRコードを表示');make.type='submit';qrForm.append(url,make);
    let qrTurn=0;
    qrForm.onsubmit=async e=>{
      e.preventDefault();const ticket=++qrTurn;output.replaceChildren(note('QRコードを準備中…'));
      try{
        const u=testShareURL(url.value);
        const {default:QR}=await import('./vendor/qr/index.mjs');if(ticket!==qrTurn||!output.isConnected)return;
        const q=new QR(-1,1);q.addData(u.href);q.make();const c=el('canvas');c.setAttribute('aria-label','検証URLのQRコード');const n=q.getModuleCount();c.width=c.height=(n+8)*5;
        const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#0c1716';
        for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))g.fillRect((x+4)*5,(y+4)*5,5,5);
        output.replaceChildren(c,link('検証URLを別タブで開く',u.href));
      }catch(err){if(ticket===qrTurn)output.replaceChildren(note(err.message));}
    };
    device.append(qrForm,output);
    const local=block('開発サーバー・認証','ビルドが必要なアプリはPCで起動してURLを開きます。iPadからはPCのlocalhostではなく、検証用HTTPS URLを使ってください。');
    const origin=input('url','開発サーバーのURL');origin.placeholder='http://localhost:5173/';
    const localForm=el('form',undefined,'lab-actions'),add=button('開く方法を表示');add.type='submit';localForm.append(origin,add);
    const out=el('div',undefined,'lab-actions');
    localForm.onsubmit=e=>{e.preventDefault();try{
      const u=new URL(origin.value.trim());
      if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password)throw Error('HTTPSか、この端末のlocalhostを指定してください。');
      out.replaceChildren(link('開発サーバーを別タブで開く',u.href));
      if(u.protocol==='https:')out.append(button('プレビューにも表示',()=>{dialog.close();ctx.hosted(u.href);}));
    }catch(err){out.replaceChildren(note(err.message));}};
    const graph=el('div',undefined,'lab-flow');for(const [a,b] of [['隔離','HTML・動作確認'],['PCで開く','開発サーバー・SSR'],['HTTPSで開く','ログイン・iPad']]){const f=el('div');f.append(strong(a),note(b));graph.append(f);}
    local.append(graph,localForm,out,note('2つのアカウントを試す場合は、別のブラウザプロファイルか別端末で同じ検証URLを開きます。'),link('Firebase テストアカウントの設定', 'https://firebase.google.com/docs/emulator-suite/connect_auth?hl=ja'));
    const folder=block('フォルダの変更を追いかける','元ファイルを編集したら再読み込み。未対応の端末はフォルダを選び直せます。');
    const watchNote=note(watch?'このフォルダを確認中':'');
    const watchButton=button('フォルダを選んで追従',async()=>{
      try{
        const handle=await window.showDirectoryPicker({mode:'read'});watchButton.disabled=true;watchNote.textContent='フォルダを読み込み中…';
        watch={handle,signature:null,changed:false,busy:false};
        await poll(true);
        if(dialog.open)dialog.close();
      }catch(e){if(e.name!=='AbortError')watchNote.textContent=e.message;watchButton.disabled=false;}
    });
    watchButton.hidden=typeof window.showDirectoryPicker!=='function';
    const stop=button('自動更新を停止',()=>{stopWatch();render();});stop.hidden=!watch;
    folder.append(actions(watchButton,button('フォルダを選び直す',()=>{dialog.close();ctx.folder();}),stop),watchNote);
    if(watchButton.hidden)folder.append(note('このブラウザではフォルダの自動追従は利用できません。ZIPやフォルダの読み込みは引き続き使えます。'));
    body.append(github,device,local,folder);
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
      if(watch===w)clearTimeout(dirty),dirty=setTimeout(()=>void poll(),2000);
    }catch(err){
      if(watch===w){stopWatch();ctx.notice('フォルダの追従を停止しました。'+err.message);}
      if(first)throw err;
    }finally{w.busy=false;}
  }
  function stopWatch(){clearTimeout(dirty);dirty=null;watch=null;}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&watch&&!watch.busy){clearTimeout(dirty);void poll();}});
  bar.replaceChildren(...tabs.map(([key,label],i)=>{
    const b=button(label,()=>selection(key));b.id='lab-'+key;b.dataset.key=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','lab-body');
    b.onkeydown=e=>{const index={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[e.key];if(index!==undefined){e.preventDefault();selection(tabs[index][0]);bar.children[index].focus();}};
    return b;
  }));
  dialog.onclose=()=>{scope++;cleanupCompare();resetPickers(panelPickers);resetPickers(rulePickers);};
  window.addEventListener('message',compareMessage);
  return {selection,project,save,begin,issue,stopWatch,leave,closeAsset,openAsset,refresh,renderIfFiles:()=>dialog.open&&tab==='files'&&renderFiles(),receive(type,value){
    if(type==='lab-issue')issue(value?.id);
    if(type==='lab-check'&&pendingCheck?.id===value?.id&&pendingCheck?.node){pendingCheck.node.textContent=value.pass===null?'セレクターの書き方を確認してください。':value.pass?'表示されています。':'表示されていません。';pendingCheck=null;}
    if(type==='lab-audit'&&value&&typeof value==='object'){audit=value;updateAudit();}
    if(type==='lab-frames'&&value&&[value.fps,value.max,value.slow].every(Number.isFinite)){frames=value;if(frameButton?.isConnected)frameButton.disabled=false;updateAudit();}
  }};
}
