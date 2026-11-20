export const nativeControl = location => location.protocol==='http:'&&location.hostname==='127.0.0.1'&&!!location.port;
export function packageProject(rows,{entry,rewrites=[],spa=false}){
  const encoder=new TextEncoder();
  const header=encoder.encode(JSON.stringify({files:rows.map(([p,b])=>[p,b.size]),entry,rewrites,spa}));
  if(header.length>2*1024**2)throw Error('ファイル一覧のサイズが上限に達しました。');
  const prefix=new ArrayBuffer(4);new DataView(prefix).setUint32(0,header.length,true);
  return new Blob([prefix,header,...rows.map(([,blob])=>blob)],{type:'application/octet-stream'});
}
export function parseNative(value,authLocal=false){
  const url=new URL(value?.url);
  if(url.protocol!=='http:'||!(/^zs-[a-f0-9]{16}\.localhost$/.test(url.hostname)||authLocal&&url.hostname==='localhost'&&url.port==='4176')||!url.port||url.username||url.password||!/^[a-f\d]{48}$/.test(value?.id))throw Error('ローカルプレビューのURLが不正です。');
  return {id:value.id,url:url.href,authLocal:authLocal&&url.hostname==='localhost'};
}
let sessionToken;
async function token(signal){
  if(!nativeControl(location))throw Error('ZipStage Local を起動してください。');
  if(sessionToken)return sessionToken;
  const r=await fetch('/__zipstage/session',{cache:'no-store',signal});
  if(!r.ok)throw Error('ZipStage Local に接続できません。');
  if(!(r.headers.get('content-type')??'').startsWith('application/json'))throw Error('ZipStage Local を起動してください。');
  const d=await r.json();
  if(!/^[a-f\d]{48}$/.test(d.token))throw Error('ZipStage Local を起動してください。');
  return sessionToken={key:d.token,authLocal:d.authLocal===true};
}
export async function probeNative(signal){
  try{return await token(signal);}catch{return null;}
}
export async function createNative(rows,options,signal){
  const {key,authLocal}=await token(signal);
  const res=await fetch('/__zipstage/project',{method:'POST',headers:{'X-ZipStage-Session':key,'Content-Type':'application/octet-stream'},body:packageProject(rows,options),signal});
  const data=await res.json();
  if(!res.ok)throw Error(data?.error||'ローカルプレビューを起動できません。');
  return parseNative(data,authLocal);
}
export async function stopNative(id){
  if(!id||!sessionToken)return;
  await fetch('/__zipstage/project/'+encodeURIComponent(id),{method:'DELETE',headers:{'X-ZipStage-Session':sessionToken.key},keepalive:true}).catch(()=>{});
}
const checks=[
  ['oauth',/\b(?:signInWithPopup|signInWithRedirect|GoogleAuthProvider|google\.accounts\.id)\b|accounts\.google\.com\/gsi/i,'Google / OAuth'],
  ['database',/\b(?:getFirestore|getDatabase|firebaseio\.com|firestore\.googleapis\.com|firebaseapp\.com)\b/i,'Firebase / データベース'],
  ['storage',/\b(?:indexedDB|browserLocalPersistence|indexedDBLocalPersistence)\b/,'IndexedDB / 認証データ保存'],
  ['worker',/\b(?:serviceWorker|importScripts)\b/,'Service Worker'],
  ['realtime',/\b(?:WebSocket|RTCPeerConnection|Photon)\b/,'WebSocket / WebRTC'],
  ['spa',/\b(?:BrowserRouter|createBrowserRouter|createWebHistory|pushState)\b/,'SPAルーティング'],
];
export async function inspectCompatibility(rows,cancel=()=>false){
  const found=new Map();
  const sorted=[...rows].filter(([p])=>/\.(?:html?|[cm]?jsx?|tsx?)$/i.test(p)&&!/(?:^|\/)(?:vendor|node_modules)\//i.test(p)).sort((a,b)=>rank(a[0])-rank(b[0]));
  let budget=6*1024**2;
  for(const [path,blob] of sorted.slice(0,160)){
    if(!budget||cancel())break;
    const length=Math.min(blob.size,384*1024,budget);budget-=length;
    const text=await blob.slice(0,length).text();
    for(const [id,re,label] of checks)if(!found.has(id)&&re.test(text))found.set(id,{id,label,path});
  }
  return checks.flatMap(([id])=>found.has(id)?[found.get(id)]:[]);
}
function rank(p){return /(?:index|auth|login|firebase|main)\.[^/]+$/i.test(p)?0:1;}

export function parseHosted(raw,studioOrigin){
  let url;
  try{url=new URL(raw.trim());}catch{throw Error('https:// から始まるテスト用URLを入力してください。');}
  if(url.protocol!=='https:'||url.username||url.password||url.href.length>3500)throw Error('認証情報を含まない HTTPS のURLを入力してください。');
  if(url.origin===studioOrigin)throw Error('ZipStage本体とは別オリジンのURLを使ってください。');
  return url;
}
