import {prettySize} from './workspace.mjs';
import {createPicker} from './picker.mjs';
import {enterContent} from './motion.mjs';

const create=(tag,text,cls)=>{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;
};
const input=(placeholder,aria)=>{
  const f=create('input');f.type='search';f.placeholder=placeholder;f.setAttribute('aria-label',aria??placeholder);return f;
};
const action=(text,fn,cls='btn')=>{
  const b=create('button',text,cls);b.type='button';b.onclick=fn;return b;
};
const replace=(target,...nodes)=>target?.replaceChildren(...nodes);
const note=text=>create('p',text,'quiet');
const date=()=>new Date().toLocaleTimeString('ja-JP',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const phaseLabel={pending:'進行中',complete:'完了',failed:'失敗',blocked:'制限',observed:'計測',queued:'送信待ち',closed:'終了'};
const levelNames={warn:'警告',error:'エラー',info:'情報',log:'ログ',debug:'デバッグ',result:'結果',command:'入力',table:'表'};
const short=(s,n=3500)=>String(s??'').slice(0,n);
const textJSON=value=>JSON.stringify(value,null,2);
const filters={console:'',elements:'',network:'',sources:''};
const names={console:'コンソール',elements:'要素',network:'通信',sources:'ファイル',performance:'性能',application:'ストレージ'};
export function toolDock($,bridge,ctx){
  const host=$('tool-content'), drawer=$('tool-drawer'), toggle=$('tool-toggle'), buttons=[...$('tool-tabs').querySelectorAll('[data-key]')];
  let tab='console', isOpen=false, scheduled=false, view={}, logs=[], net=new Map(), metrics=null,
    elements=null, info=null,picking=false, selectedFile='',selectedNet='',panelVersion=0,netMessage='',level='all',fileVersion=0,autoScroll=true,keepAfterReload=false,levelPicker=null,closingTimer=0;
  function update(){
    if(scheduled)return;scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      $('log-count').textContent=logs.length;
      if(!isOpen)return;
      if(tab==='console')renderLogs();
      else if(tab==='network')renderNet();
      else if(tab==='elements')renderElements();
      else if(tab==='performance')renderMetrics();
      else if(tab==='application')renderStorage();
    });
  }
  function body(cls){const b=create('div',undefined,'tool-body'+(cls?' '+cls:''));host.append(b);return b;}
  function controls(...children){const e=create('div',undefined,'tool-controls');e.append(...children);host.append(e);return e;}
  function help(text){return create('span',text,'control-note');}
  function search(key,label,fn){
    const f=input(label);f.value=filters[key];f.oninput=()=>{filters[key]=f.value;if(fn)fn(f.value);else update();};return f;
  }
  function doBridge(type,value){
    if(bridge(type,value))return true;
    log({level:'warn',message:'プレビューの起動を待ってから操作してください。'});return false;
  }
  function syncPick(){
    if(view.pick){view.pick.setAttribute('aria-pressed',String(picking));view.pick.textContent=picking?'選択をキャンセル':'画面で選ぶ';}
  }
  function open(key=tab){
    if(!names[key])key='console';
    if(tab==='elements'&&key!=='elements'&&picking){picking=false;bridge('pick',false);}
    const wasOpen=isOpen,changed=tab!==key;
    tab=key;isOpen=true;host.inert=false;host.setAttribute('aria-hidden','false');toggle.setAttribute('aria-expanded','true');
    host.setAttribute('aria-labelledby','tab-'+key);
    for(const b of buttons){const same=b.dataset.key===key;b.tabIndex=same?0:-1;b.setAttribute('aria-selected',String(same));}
    clearTimeout(closingTimer);drawer.classList.remove('is-closing');
    if(!wasOpen||changed)ctx.reflow(()=>{
      drawer.classList.add('is-open');mount();
    });
    if(wasOpen&&changed)enterContent(host,{duration:135,y:0});
  }
  function close(){
    if(picking){picking=false;bridge('pick',false);}
    isOpen=false;levelPicker?.close();host.inert=true;host.setAttribute('aria-hidden','true');toggle.setAttribute('aria-expanded','false');
    ctx.reflow(()=>{drawer.classList.remove('is-open');drawer.classList.add('is-closing');});
    clearTimeout(closingTimer);closingTimer=setTimeout(()=>drawer.classList.remove('is-closing'),175);
    view={};panelVersion++;
  }
  function mount(){
    panelVersion++;levelPicker?.destroy();levelPicker=null;host.replaceChildren();view={};
    if(tab==='console'){
      const filter=create('div');filter.id='log-picker';
      const levelLabel=create('span','ログレベル','sr-only');levelLabel.id='log-level-label';filter.append(levelLabel);
      levelPicker=createPicker(filter,levelLabel.id,value=>{level=value;update();});
      levelPicker.set([['all','すべて'],['error','エラー'],['warn','警告'],['normal','情報・結果']].map(([value,label])=>({value,label})),level);
      const keep=action('保持',()=>{keepAfterReload=!keepAfterReload;keep.setAttribute('aria-pressed',String(keepAfterReload));});
      keep.title='再読み込みしてもログを保持';keep.setAttribute('aria-label',keep.title);keep.setAttribute('aria-pressed',String(keepAfterReload));
      controls(search(tab,'コンソールを検索'),filter,keep,action('消去',()=>{logs=[];update();}),action('コピー',()=>copy(logs.map(x=>x.time+' '+(levelNames[x.level]??x.level)+' '+x.message).join('\n'))));
      view.list=body();view.list.setAttribute('aria-label','ログ');
      view.list.onscroll=()=>{autoScroll=view.list.scrollHeight-view.list.scrollTop-view.list.clientHeight<22;};
      const form=create('form',undefined,'console-entry');
      const expr=input('JavaScriptを実行（プレビュー内）','JavaScriptコマンド');expr.type='text';expr.autocomplete='off';expr.spellcheck=false;
      const b=create('button','実行','btn primary');b.type='submit';form.append(expr,b);host.append(form);
      form.onsubmit=e=>{e.preventDefault();const v=expr.value.trim();if(v&&v.length<=4000&&doBridge('command',v)){log({level:'command',message:v});expr.value='';}};
      renderLogs();
    }else if(tab==='elements'){
      const field=search(tab,'CSSセレクター・テキストで検索',v=>bridge('elements',v));
      view.pick=action('画面で選ぶ',()=>{const next=!picking;if(doBridge('pick',next)){picking=next;syncPick();}});syncPick();
      controls(field,view.pick,action('更新',()=>doBridge('elements',filters.elements)));
      const wrap=body('dual-pane');view.list=create('div',undefined,'inspector-list');view.details=create('div');wrap.append(view.list,view.details);
      bridge('elements',filters.elements);renderElements();
    }else if(tab==='network'){
      controls(search(tab,'URL・ドメイン・種類を検索'),action('消去',()=>{net.clear();selectedNet='';netMessage='';update();}),action('コピー',()=>copy(textJSON([...net.values()]))));
      const wrap=body('dual-pane');view.list=create('div');view.details=create('div');view.details.id='net-info';wrap.append(view.list,view.details);
      renderNet();
    }else if(tab==='sources'){
      controls(search(tab,'ファイルを検索',()=>renderFiles()),action('コピー',()=>{if(view.sourceText)copy(view.sourceText);}));
      const wrap=body('dual-pane');view.list=create('div',undefined,'inspector-list');view.details=create('div');wrap.append(view.list,view.details);
      renderFiles();if(selectedFile)showFile(selectedFile);
    }else if(tab==='performance'){
      controls(action('計測値を更新',()=>doBridge('metrics')),help('ブラウザから取得できる実行中の指標'));
      view.list=body();bridge('metrics');renderMetrics();
    }else{
      controls(action('保存データを管理',ctx.openStorage),help('現在のプレビューから見えているデータ'));
      view.list=body();renderStorage();
    }
  }
  function log(item){
    if(typeof item?.message!=='string')return;
    const raw=short(item.level,20);
    const name=Object.hasOwn(levelNames,raw)?raw:'log',message=short(item.message,5000);
    logs.push({level:name,message,time:date()});if(logs.length>350)logs.shift();update();
  }
  function renderLogs(){
    if(!view.list)return;
    const query=filters.console.toLowerCase();
    const found=logs.filter(x=>(x.message.toLowerCase().includes(query)||x.level.includes(query))&&(level==='all'||(level==='normal'?!['error','warn'].includes(x.level):x.level===level)));
    const previous=view.list.scrollTop;
    replace(view.list,...(found.length?found.map(x=>{
      const row=create('div',undefined,'console-line '+x.level),time=create('time',x.time),p=create('pre',x.message);
      p.title=levelNames[x.level]??'ログ';row.append(time,p);return row;
    }):[note('一致するログはありません。実行するとここに表示されます。')]));
    view.list.scrollTop=autoScroll?view.list.scrollHeight:previous;
  }
  function renderElements(){
    if(!view.list)return;
    const prev=view.list.scrollTop,rows=Array.isArray(elements?.rows)?elements.rows:[];
    const labels=rows.length?rows.slice(0,420).map(row=>{
      const b=action(short(row.label,250),()=>doBridge('select',row.id),'element-row');
      b.setAttribute('aria-current',String(row.id===info?.id));b.style.paddingLeft=(7+Math.min(8,Number(row.depth)||0)*9)+'px';return b;
    }):[];
    replace(view.list,note(elements?short(elements.kind,25)+' · '+String(elements.total)+'件'+(elements.total>420?'（先頭420）':''):'ページを読み込むと利用できます。'),...labels);
    view.list.scrollTop=prev;
    if(!info)replace(view.details,note('要素を選ぶと、HTMLと適用後のスタイルが表示されます。'));
    else if(info.error)replace(view.details,note(short(info.error,250)));
    else{
      const scroll=view.details.scrollTop;
      const dims=Array.isArray(info.bounds)?info.bounds.slice(0,4):[];
      const lines=Array.isArray(info.styles)?info.styles.slice(0,30).map(x=>short(x?.[0],50)+': '+short(x?.[1],200)):[]; 
      const edit=create('details',undefined,'inline-editor');
      const expanded=view.details.querySelector('.inline-editor')?.open;
      edit.open=expanded??false;
      const area=create('textarea');area.value=short(info.inline,4000);area.maxLength=4000;area.rows=3;area.setAttribute('aria-label','インラインCSS');
      const buttons=create('div',undefined,'editor-actions');
      buttons.append(action('反映',()=>doBridge('style',{id:info.id,css:area.value})),action('元に戻す',()=>doBridge('style',{id:info.id,reset:true})));
      edit.append(create('summary','インラインCSSを試す'),area,buttons);
      replace(view.details,note(short(info.label,250)+' · '+dims.slice(0,2).join(' × ')+' px'),edit,create('pre',short(info.html,13000)),create('pre',lines.join('\n')));
      view.details.scrollTop=scroll;
    }
    syncPick();
  }
  function receiveNet(item,session){
    if(!item||typeof item.url!=='string'||!Number.isSafeInteger(item.id))return;
    const key=session+':'+item.id, prev=net.get(key);
    const allowed={};
    for(const prop of ['type','url','phase','method','error','contentType','mime','protocol','final'])if(typeof item[prop]==='string')allowed[prop]=short(item[prop],prop==='url'||prop==='final'?1600:250);
    for(const prop of ['status','bytes','ms','t','upload','download'])if(Number.isFinite(item[prop]))allowed[prop]=item[prop];
    for(const prop of ['sent','received'])if(Array.isArray(item[prop]))allowed[prop]=item[prop].slice(0,16).filter(x=>Array.isArray(x)&&x.length===2).map(([k,v])=>[short(k,70),short(v,360)]);
    net.set(key,{...prev,...allowed,key});
    if(net.size>550)net.delete(net.keys().next().value);
    update();
  }
  function hostName(raw){try{const u=new URL(raw);return /^https?:$|^wss?:$/.test(u.protocol)?u.hostname:'';}catch{return '';}}
  function renderNet(){
    if(!view.list)return;
    const q=filters.network.toLowerCase(), rows=[...net.values()].filter(x=>(x.url+' '+x.type+' '+x.phase+' '+(x.status??'')).toLowerCase().includes(q));
    const old=view.list.scrollTop,list=create('ul',undefined,'net-list');
    for(const item of [...rows].reverse()){
      const li=create('li'),b=action('',()=>{selectedNet=item.key;netMessage='';renderNet();},'net-row');
      const p=item.status?String(item.status):phaseLabel[item.phase]??item.phase??'';
      b.title=item.url;b.setAttribute('aria-current',String(selectedNet===item.key));
      b.append(create('span',p,'tag '+(item.phase==='blocked'?'blocked':item.phase==='failed'?'failed':item.phase==='complete'?'ok':'')),create('span',hostName(item.url)||item.url,'net-host'),create('span',item.type??''));
      li.append(b);list.append(li);
    }
    replace(view.list,note(rows.length+'件 · '+(ctx.metadata().online?'外部通信オン':'外部通信オフ')),list);view.list.scrollTop=old;
    const item=net.get(selectedNet);
    if(!item){replace(view.details,note('通信を選ぶと詳細を確認できます。IPはDNSの候補のみ確認可能です。'));return;}
    const scroll=view.details.scrollTop, host=hostName(item.url), opened=new Set([...view.details.querySelectorAll('details[open] > summary')].map(x=>x.textContent));
    const details=[
      ['通信先',item.url],['ドメイン',host],['種類',item.type],['メソッド',item.method],
      ['状態',(phaseLabel[item.phase]??item.phase??'')+(item.status?' · '+item.status:'')],
      ['時間',item.ms==null?null:item.ms+' ms'],['サイズ',item.bytes==null?null:prettySize(item.bytes)],['HTTP',item.protocol],
      ['Content-Type',item.contentType||item.mime],['リダイレクト先',item.final],['WebSocket送信／受信',item.upload==null?null:item.upload+' / '+(item.download??0)],['補足',item.error]
    ].filter(([,v])=>v).map(([k,v])=>create('p',k+' · '+v));
    for(const [title,rows] of [['リクエストヘッダー',item.sent],['レスポンスヘッダー',item.received]])if(rows?.length){
      const group=create('details');group.open=opened.has(title);group.append(create('summary',title),create('pre',rows.map(x=>x.join(': ')).join('\n')));details.push(group);
    }
    if(host){
      const scope=panelVersion, target=item.key;
      const lookup=action('DNSのIP候補を調べる',async()=>{
        netMessage='Cloudflare DNSに問い合わせ中…';renderNet();
        try{
          const addresses=await dns(host);
          if(panelVersion!==scope||selectedNet!==target)return;
          netMessage=addresses.length?'DNS候補 · '+addresses.join(' / '):'DNSのA・AAAAレコードが見つかりませんでした。';
        }catch{if(panelVersion===scope&&selectedNet===target)netMessage='DNS問い合わせに失敗しました。';}
        if(panelVersion===scope&&selectedNet===target)renderNet();
      });
      lookup.title='Cloudflare DNS にドメイン名のみ送信します';
      details.push(lookup,note('候補の取得にはCloudflare DNSを利用します。実際に接続したIPとは限りません。'));
      if(netMessage)details.push(create('p',netMessage));
    }
    replace(view.details,...details);view.details.scrollTop=scroll;
  }
  function renderFiles(){
    if(!view.list)return;
    const all=ctx.files(),q=filters.sources.toLowerCase();
    const matches=all.filter(([p])=>p.toLowerCase().includes(q)), rows=matches.slice(0,450).map(([p])=>{
      const b=action(p,()=>{selectedFile=p;renderFiles();showFile(p);},'source-row');b.setAttribute('aria-current',String(p===selectedFile));return b;
    });
    const prev=view.list.scrollTop;
    replace(view.list,note(matches.length+'件'+(matches.length>450?'（先頭450）':'')),...rows);
    view.list.scrollTop=prev;
    if(!selectedFile)replace(view.details,note('ファイルを選んで中身を確認できます。'));
  }
  async function showFile(path){
    const ver=++fileVersion,scope=panelVersion;
    const blob=ctx.files().find(([p])=>p===path)?.[1];
    if(!blob){replace(view.details,note('ファイルは現在のフォルダにありません。'));return;}
    const textual=/^(text\/|application\/(?:json|xml|manifest))/.test(blob.type)||/\.(tsx?|jsx|mts|cts|vue|svelte|md|svg)$/i.test(path);
    if(!textual){view.sourceText='';replace(view.details,note(path+' · '+prettySize(blob.size)),note('バイナリファイルです。'));return;}
    view.sourceText='';replace(view.details,note('データを読み込み中…'));
    try{
      const txt=await blob.slice(0,240000).text();
      if(ver!==fileVersion||scope!==panelVersion||tab!=='sources')return;
      view.sourceText=txt;
      const raw=txt.split(/\r?\n/),code=create('pre',undefined,'code-lines');
      const fragment=document.createDocumentFragment();
      for(let i=0;i<Math.min(raw.length,3000);i++){
        const line=create('span',raw[i]||' ', 'code-line');
        line.dataset.line=String(i+1);fragment.append(line);
      }
      code.append(fragment);
      replace(view.details,note(path+' · '+prettySize(blob.size)+(blob.size>240000||raw.length>3000?' · 表示範囲を制限':'')),code);
    }catch{if(ver===fileVersion&&scope===panelVersion)replace(view.details,note('ファイルを表示できませんでした。'));}
  }
  function renderMetrics(){
    if(!view.list)return;
    const meta=ctx.metadata(), fmt=x=>Number.isFinite(x)?x+' ms':'—', paint=Array.isArray(metrics?.paint)?metrics.paint:[];
    const rows=[
      ['起動にかかった時間',fmt(meta.duration)],['DOM要素',Number.isFinite(metrics?.nodes)?metrics.nodes+' 個':'—'],
      ['ビューポート',Array.isArray(metrics?.viewport)?metrics.viewport.slice(0,2).join(' × ')+' px':'—'],
      ['取得できたリソース',Number.isFinite(metrics?.count)?metrics.count+' 件':'—'],
      ['転送サイズの合計',metrics?.transfer?prettySize(metrics.transfer):'—'],
      ['リソース時間の合計',fmt(metrics?.requestMs)],['最初の描画',fmt(paint.find(x=>x[0]==='first-paint')?.[1])],
      ['TS / JSX 変換済み',meta.compiler+' 件']
    ];
    const grid=create('div',undefined,'metric-grid');
    for(const [label,value] of rows){const tile=create('div',label,'metric');tile.append(create('strong',String(value)));grid.append(tile);}
    replace(view.list,grid,note('複数の通信は同時に進むため、通信時間の合計と実際の待ち時間は一致しません。'));
  }
  function renderStorage(){
    if(!view.list)return;
    const snapshot=ctx.storage(), local=Object.entries(snapshot?.localStorage??{}), session=Object.entries(snapshot?.sessionStorage??{});
    const output=[];
    for(const [title,entries] of [['localStorage',local],['sessionStorage',session]]){
      output.push(note(title+' · '+entries.length+' 件'));
      if(entries.length)output.push(create('pre',short(textJSON(Object.fromEntries(entries)),12000)));
    }
    replace(view.list,...output,note('IndexedDB・Cookieは表示されません。'));
  }
  function copy(value){
    if(!value)return;
    navigator.clipboard?.writeText(value).catch(()=>log({level:'warn',message:'クリップボードにコピーできませんでした。'}));
  }
  function invalidate(){
    elements=null;info=null;metrics=null;picking=false;update();
    if(tab==='sources'&&isOpen){selectedFile='';renderFiles();}
  }
  function reset(){
    invalidate();logs=[];net.clear();selectedNet='';selectedFile='';netMessage='';update();
  }
  function receive(type,data,token){
    if(type==='log')log(data);
    else if(type==='console-clear'){logs=[];update();}
    else if(type==='network')receiveNet(data,token);
    else if(type==='elements'){if(data?.query!==filters.elements.trim().slice(0,160))return;elements=data;update();}
    else if(type==='element-info'){info=data;picking=false;update();}
    else if(type==='metrics'){metrics=data;update();}
  }
  function ready(){
    if(isOpen&&tab==='elements')bridge('elements',filters.elements);
    if(isOpen&&tab==='performance')bridge('metrics');
    if(isOpen&&tab==='sources')renderFiles();
    update();
  }
  toggle.onclick=()=>isOpen?close():open();
  for(const [i,b] of buttons.entries()){
    b.tabIndex=i===0?0:-1;
    b.onclick=()=>open(b.dataset.key);
    b.onkeydown=e=>{
      const next={ArrowRight:(i+1)%buttons.length,ArrowLeft:(i+buttons.length-1)%buttons.length,Home:0,End:buttons.length-1}[e.key];
      if(next!==undefined){e.preventDefault();buttons[next].focus();open(buttons[next].dataset.key);}
    };
  }
  return {log,receive,invalidate,reset,open,ready,keepAfterReload:()=>keepAfterReload,storage:()=>{if(tab==='application')update();}};
}
async function dns(host){
  if(!/^(?:[a-z\d-]+\.)*[a-z\d-]+$/i.test(host)&&!host.includes(':'))return [];
  if(/^(?:\d+\.){3}\d+$/.test(host)||host.includes(':'))return [host];
  const result=await Promise.allSettled(['A','AAAA'].map(async type=>{
    const p=new URL('https://cloudflare-dns.com/dns-query');p.searchParams.set('name',host);p.searchParams.set('type',type);
    const r=await fetch(p,{headers:{accept:'application/dns-json'},credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout?.(8000)});
    if(!r.ok)throw Error('DNS');const j=await r.json();return (j.Answer??[]).filter(x=>x.type===1||x.type===28).map(x=>short(x.data,80));
  }));
  if(result.every(x=>x.status==='rejected'))throw Error('DNS');
  return [...new Set(result.flatMap(x=>x.status==='fulfilled'?x.value:[]))];
}
