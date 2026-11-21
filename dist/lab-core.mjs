export const types={
  text:/\.(?:md|markdown|txt|log|json|webmanifest|ya?ml|csv|tsv|[cm]?[jt]sx?|css|html?|vue|svelte|astro|xml|toml|ini|py|php|sql)$/i,
  image:/\.(?:svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i,
  audio:/\.(?:mp3|m4a|ogg|oga|wav|aac|flac)$/i,
  video:/\.(?:mp4|webm|mov|m4v|ogv)$/i,
  font:/\.(?:woff2?|ttf|otf)$/i,
  model:/\.(?:glb|gltf)$/i,
  pdf:/\.pdf$/i
};
export const acceptsAsset=p=>Object.values(types).some(exp=>exp.test(p));
export const supported='.zip,.html,.htm,.md,.markdown,.txt,.log,.json,.webmanifest,.yaml,.yml,.csv,.tsv,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.ico,.pdf,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.mp4,.webm,.mov,.m4v,.ogv,.woff,.woff2,.ttf,.otf,.glb,.gltf,.js,.jsx,.mjs,.ts,.tsx,.mts,.css,.vue,.svelte,.astro,.xml,.toml,.ini,.py,.php,.sql,.cjs,.cts';
export const ext=p=>p.split('.').pop().toLowerCase();
const typeOverrides={pdf:'application/pdf',glb:'model/gltf-binary',gltf:'model/gltf+json',avif:'image/avif',bmp:'image/bmp',ico:'image/x-icon',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',oga:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',webm:'video/webm',ogv:'video/ogg'};
export const assetBlob=(path,blob)=>typeOverrides[ext(path)]?blob.slice(0,blob.size,typeOverrides[ext(path)]):blob;
export function relativeAsset(base,raw){
  if(!raw||/^(?:[\w+.-]+:|\/\/|#)/.test(raw))return null;
  try{
    const u=new URL(raw,new URL('/'+base.split('/').map(encodeURIComponent).join('/'),'https://zipstage.invalid'));
    return decodeURIComponent(u.pathname.slice(1));
  }catch{return null;}
}
export function parseDelimited(text,sep=',',rowLimit=401){
  if(!text)return {rows:[],truncated:false};
  const rows=[];let row=[],value='',quote=false;
  const field=()=>{if(row.length<100)row.push(value);value='';};
  const end=()=>{field();rows.push(row);row=[];};
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quote){
      if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else quote=false;}
      else value+=c;
    }else if(c==='"'&&value==='')quote=true;
    else if(c===sep)field();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;end();if(rows.length>=rowLimit)return {rows,truncated:i+1<text.length};}
    else value+=c;
  }
  if(row.length||value||!/[\r\n]$/.test(text))end();
  return {rows,truncated:false};
}
const dataMethod=/^(get|post|put|patch|delete|head|options)$/i;
const yamlScalar=(raw='')=>{
  const v=raw.trim();
  if(!v)return Object.create(null);
  try{if(v.startsWith('{')||v.startsWith('[')||v.startsWith('"')||/^(true|false|null|-?\d+(?:\.\d+)?)$/.test(v))return JSON.parse(v);}catch{}
  if(v.startsWith("'")&&v.endsWith("'"))return v.slice(1,-1).replaceAll("''","'");
  return v;
};
// Bounded OpenAPI block mappings and common simple sequence examples. No YAML tags or external refs.
export function parseApi(text){
  let doc;
  if(text.length>500000)throw Error('API定義は500 KBまでです。');
  try{doc=JSON.parse(text);}catch{
    doc=Object.create(null);const stack=[[-1,doc]];
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
    for(let i=0;i<lines.length&&i<9500;i++){
      const raw=lines[i], m=/^( *)(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:(?:[ \t]+(.*)|\s*)$/.exec(raw);
      if(!m||/^\s*(?:#|-[ \t])/.test(raw)||m[1].length>120)continue;
      const indent=m[1].length,key=(m[2]??m[3]??m[4]).trim(),val=m[5]??'';
      if(['__proto__','constructor','prototype'].includes(key))continue;
      while(stack.length>1&&stack.at(-1)[0]>=indent)stack.pop();
      const obj=stack.at(-1)[1];obj[key]=yamlScalar(val);
      if(!val&&i<lines.length-1&&/^\s+-\s+/.test(lines[i+1])&&lines[i+1].search(/\S/)>indent){
        obj[key]=[];
        while(i+1<lines.length&&/^\s+-\s+/.test(lines[i+1])&&lines[i+1].search(/\S/)>indent&&obj[key].length<100)obj[key].push(yamlScalar(lines[++i].trim().slice(1)));
      }
      if(!val&&!Array.isArray(obj[key]))stack.push([indent,obj[key]]);
    }
  }
  if(!doc?.openapi||!doc.paths||typeof doc.paths!=='object')return null;
  const rows=[];
  for(const [path,verbs] of Object.entries(doc.paths)){
    if(!/^\/(?!\/)[^\s?#]{0,300}$/.test(path)||!verbs||typeof verbs!=='object')continue;
    for(const [verb,operation] of Object.entries(verbs)){
      if(!dataMethod.test(verb)||!operation||typeof operation!=='object'||rows.length>=180)continue;
      const responses=operation.responses??{}, ok=Object.keys(responses).find(x=>/^2\d\d$/.test(x)), status=Number(ok??200);
      const media=responses[ok]?.content?.['application/json']??{};
      const example=media.example??Object.values(media.examples??{})[0]?.value??media.schema?.example??null;
      const body=JSON.stringify(example);
      rows.push({path,method:verb.toUpperCase(),label:typeof operation.summary==='string'?operation.summary.slice(0,120):'',status,body:body.length<=30000?body:'null'});
    }
  }
  return rows;
}
export function queryless(value){
  const raw=String(value??'').split(/[?#]/,1)[0];
  try{const url=new URL(raw);return url.origin;}catch{return raw.startsWith('/')?'/'+raw.split('/').filter(Boolean).map(()=>':path').join('/'):'（非公開）';}
}
export function publicReport({viewport, findings, steps, metrics, network, route}){
  // Deliberate allowlist. App-controlled logs, selectors, input, paths and request content are not exported.
  return {version:1,generated:new Date().toISOString(),viewport:viewport.slice(0,2).map(Number),route:queryless(route),
    findings:findings.map(x=>({id:x.id,count:x.count??1})),steps:steps.map(x=>({done:!!x.done})),
    preview:{startupMs:Number.isFinite(metrics)?metrics:null},
    network:network.slice(0,150).map(x=>({method:/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(x.method)?x.method:undefined,status:Number.isInteger(x.status)?x.status:null,durationMs:Number.isFinite(x.ms)?x.ms:null}))};
}
export function testShareURL(raw){
  let u;
  try{u=new URL(raw.trim());}catch{}
  if(!u||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.href.length>650||!/^[\x21-\x7e]+$/.test(u.href))throw Error('ログイン情報や ?・# を含まない650文字以下のHTTPS URLを指定してください。');
  return u;
}
export function githubLinks(raw){
  let u;try{u=new URL(raw.trim());}catch{throw Error('GitHubのリポジトリ、ブランチ、PRのURLを入れてください。');}
  const [owner,repo,section,...rest]=u.pathname.split('/').filter(Boolean);
  if(u.origin!=='https://github.com'||u.username||u.password||![owner,repo].every(v=>/^[\w.-]{1,100}$/.test(v??''))||[owner,repo].some(v=>v==='.'||v==='..'))throw Error('github.com のリポジトリURLを指定してください。');
  const base='https://github.com/'+owner+'/'+repo;
  const branch=section==='tree'?rest.map(x=>decodeURIComponent(x)).join('/'):'';
  if(section==='pull'&&/^\d{1,10}$/.test(rest[0]??''))return {context:base+'/pull/'+rest[0],archive:base+'/archive/refs/pull/'+rest[0]+'/head.zip',label:'PR #'+rest[0]};
  if(branch&&/^[\w./-]{1,190}$/.test(branch)&&branch.split('/').every(x=>x&&x!=='.'&&x!=='..'))return {context:base+'/tree/'+branch,archive:base+'/archive/refs/heads/'+branch+'.zip',label:branch};
  return {context:base,archive:null,label:'リポジトリ'};
}
export function sortedChanges(a,b){
  const old=new Map(a),next=new Map(b);
  const output=[];
  for(const [path,size] of next){const prev=old.get(path);if(prev!==size)output.push({path,before:prev??null,after:size});}
  for(const [path,size] of old)if(!next.has(path))output.push({path,before:size,after:null});
  return output.sort((a,b)=>Math.abs((b.after??0)-(b.before??0))-Math.abs((a.after??0)-(a.before??0))||a.path.localeCompare(b.path));
}
export function classify({files=[],report=[],issues=[],status='',compileErrors=[]}){
  const out=[],add=(id,title,detail,count)=>out.push({id,title,detail,count});
  const paths=files.map(x=>Array.isArray(x)?x[0]:x);
  const get=id=>issues.filter(x=>x.id===id);
  if(status==='error')add('boot','起動に失敗','コンソールで最初のエラーを確認。ビルド済みなら、公開フォルダを選び直してください。');
  if(!paths.length&&status!=='error')add('empty','まだ解析するファイルがありません','ファイルかフォルダを開くと診断が出ます。');
  if(paths.length&&!paths.some(x=>/\.html?$/i.test(x)))add('no-entry','HTMLの入口がありません','資料だけならファイルを選択。アプリならビルド済みフォルダか、開発サーバーのURLを開いてください。');
  for(const [id,title,detail] of [['missing','見つからないファイル','パスの大文字・小文字、ビルド時の base、公開フォルダを確認。'],['csp','ブラウザが通信を制限','通信タブで対象を確認。信頼できるアプリなら外部通信をオンにできます。'],['request','ネットワークに失敗','サーバーが起動しているか確認。CORSはFildexa側では解除できません。'],['js','JavaScriptエラー','コンソールの最初のエラーから確認すると原因を絞れます。']]){
    const rows=get(id);
    if(rows.length)add(id,title,detail,rows.length);
  }
  if(compileErrors.length)add('compile','ソース変換に失敗','コンソールにファイル名と変換エラーを出しています。',compileErrors.length);
  if(paths.some(p=>/\.(vue|svelte|astro)$/.test(p)))add('framework','フレームワークの変換が必要','コンポーネントの中身は読めます。動かすにはプロジェクトの開発サーバーかビルド済みフォルダを使ってください。');
  if(paths.some(p=>/\.wasm$/i.test(p)))add('wasm','WebAssemblyを検出','入口HTMLと配布用の素材をまとめて開きます。スレッドを使うビルドは必要なヘッダーを付けた検証URLで試してください。');
  if(report.some(x=>/auth|firebase|google/i.test(x.id)))add('auth','認証を使うアプリ','本物のログインは認証設定済みのテストURLを別タブで。テストアカウントにはアプリ側のエミュレーター設定が必要です。');
  if(report.some(x=>/worker|storage|idb|indexed/i.test(x.id)))add('storage','ブラウザの保存機能を使うアプリ','Service Worker・IndexedDBはローカルモードまたはテストURLで確認してください。');
  return out;
}

export function assetGroup(path){
  if(types.image.test(path)||types.font.test(path)||types.model.test(path)||types.audio.test(path)||types.video.test(path))return 'media';
  if(/\.(?:json|csv|tsv|ya?ml|webmanifest)$/i.test(path))return 'data';
  if(/\.(?:md|markdown|txt|log|pdf)$/i.test(path))return 'docs';
  return 'code';
}
export function mockRuleProblem(rules){
  const seen=new Set();
  for(let i=0;i<rules.length;i++){
    const r=rules[i],line=i+1;
    if(!/^\/(?!\/)[^\s?#\\]{0,300}$/.test(r.path)||/[{}]/.test(r.path.replace(/\{[^/{}]+\}/g,'')))return {line,field:'パス'};
    if(!Number.isInteger(r.status)||r.status<200||r.status>599)return {line,field:'ステータス（200〜599）'};
    try{if(r.body.length>30000)throw Error();JSON.parse(r.body);}catch{return {line,field:'応答JSON'};}
    const key=r.method+' '+r.path.replace(/\{[^/{}]+\}/g,'{}');
    if(seen.has(key))return {line,field:'重複するメソッドとパス'};
    seen.add(key);
  }
  return null;
}
export function comparisonRoute(next,prev,home,pages){
  if(typeof next?.page!=='string'||!pages.includes(next.page))return {page:home};
  const route={page:next.page,query:String(next.query??'').slice(0,700),hash:String(next.hash??'').slice(0,700),request:String(next.request??next.page).slice(0,1200)};
  return route.page===prev?.page&&route.query===(prev.query??'')&&route.hash===(prev.hash??'')&&route.request===(prev.request??prev.page)?null:route;
}
export async function compareFiles(a,b,{limit=32*2**20,cancel=()=>false}={}){
  const old=new Map(a),next=new Map(b),changes=sortedChanges(a.map(([p,f])=>[p,f.size]),b.map(([p,f])=>[p,f.size]));
  let used=0,skipped=0,examined=0;
  for(const [path,after] of next){
    if(cancel())return null;
    const before=old.get(path);
    if(!before||before.size!==after.size||before===after||!after.size)continue;
    if(used+after.size*2>limit){skipped++;continue;}
    used+=after.size*2;
    try{
      const [x,y]=await Promise.all([before.arrayBuffer(),after.arrayBuffer()]);
      if(cancel())return null;
      const left=new Uint8Array(x),right=new Uint8Array(y);examined++;
      if(left.some((byte,i)=>byte!==right[i]))changes.push({path,before:before.size,after:after.size,content:true});
    }catch{skipped++;}
  }
  return {changes,skipped,examined};
}
