import {clean,limits,mime} from './zip.mjs';
const prefix='zipstage:app:v2:';
const single=n=>n.replace(/\.html?$/i,'').trim()||'index';
export const prettySize=n=>n>=2**20?(n/2**20).toFixed(n>=10*2**20?0:1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
export function normalizeEntries(rows){
  const out=new Map();let size=0;let seen=0;
  for(const {file,path} of rows){
    if(++seen>limits.count)throw new Error('フォルダは12,000ファイル以下にしてください。');
    const p=clean(path||file.name);
    if(!p)continue;
    if(out.has(p))throw new Error('同じパスのファイルが複数選ばれています。 · '+p);
    if(file.size>limits.entry)throw new Error('96 MBを超えるファイルがあります。 · '+p);
    size+=file.size;
    if(size>limits.total)throw new Error('取り込みは合計300 MBまでです。');
    out.set(p,file);
  }
  return {
    size,
    files:new Map([...out].map(([path,file])=>[path,{length:file.size}])),
    blob:async (path,type=mime(path))=>{
      const f=out.get(path);if(!f)throw new Error('ファイルが見つかりません。');return f.slice(0,f.size,type);
    }
  };
}
export async function listDrop(data){
  const entries=[...(data.items??[])].filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
  const plain=[...(data.files??[])];
  if(!entries.some(x=>x.isDirectory))return plain.map(file=>({file,path:file.webkitRelativePath||file.name}));
  const output=[];
  async function visit(entry,path=''){
    if(!clean(path+entry.name))return;
    if(entry.isFile){
      const file=await new Promise((ok,fail)=>entry.file(ok,fail));
      output.push({file,path:path+entry.name});
      if(output.length>limits.count)throw new Error('フォルダは12,000ファイル以下にしてください。');
      return;
    }
    if(!entry.isDirectory)return;
    const r=entry.createReader();
    for(;;){
      const files=await new Promise((ok,fail)=>r.readEntries(ok,fail));
      if(!files.length)break;
      for(const f of files)await visit(f,path+entry.name+'/');
    }
  }
  for(const e of entries)await visit(e);
  return output;
}
export function projectKey(name,root,wrapper='',kind='',signature=''){
  const stripped=name.replace(/\.(?:zip|html?)$/i,'').replace(/-(?:main|master)$/i,'').normalize('NFKC').trim();
  const relative=root.startsWith(wrapper)?root.slice(wrapper.length):root;
  return JSON.stringify([kind==='単体HTML'?'HTML':'project',kind==='単体HTML'?single(name):stripped||'project',relative.replace(/^(?:dist|public|out|build|www|dist\/client)\/$/,''),signature]);
}
export function safeStorage(input){
  if(!Array.isArray(input))return {};
  let size=0;const entries=[];
  for(const pair of input.slice(0,150)){
    if(!Array.isArray(pair)||pair.length!==2)continue;
    const [k,v]=pair;
    if(typeof k!=='string'||typeof v!=='string'||k.length>1024||v.length>65536)continue;
    size+=k.length+v.length;if(size>230000)break;
    entries.push([k,v]);
  }
  return Object.fromEntries(entries);
}
export class SavedProjects {
  constructor(backend){this.backend=backend;}
  key(id){return prefix+encodeURIComponent(id);}
  load(id){try{return JSON.parse(this.backend.getItem(this.key(id))??'null');}catch{return null;}}
  write(id,record){this.backend.setItem(this.key(id),JSON.stringify({...record,id,updated:Date.now()}));}
  erase(id){this.backend.removeItem(this.key(id));}
  list(){
    const out=[];
    for(let i=0;i<this.backend.length;i++){
      const key=this.backend.key(i);
      if(!key?.startsWith(prefix))continue;
      try{const o=JSON.parse(this.backend.getItem(key));if(o?.id)out.push(o);}catch{}
    }
    return out.sort((a,b)=>b.updated-a.updated);
  }
}
let compiler;
export function loader(path){
  const ext=path.split('.').pop().toLowerCase();
  if(ext==='tsx'||ext==='jsx')return ext;
  if(['ts','mts','cts'].includes(ext))return 'ts';
  return null;
}
export async function compile(items,notify, cancel=()=>false){
  const targets=items.filter(([p])=>loader(p)&&!p.endsWith('.d.ts'));
  if(!targets.length)return {items,converted:0,errors:[]};
  notify(0,targets.length);
  if(!compiler)compiler=import('./vendor/esbuild.mjs').then(async engine=>{
    await engine.initialize({wasmURL:new URL('./vendor/esbuild.wasm',import.meta.url).href,worker:true});
    return engine;
  }).catch(e=>{compiler=null;throw e;});
  const engine=await compiler;
  const mapped=new Map(items),errors=[];let converted=0;
  for(const [p,f] of targets){
    if(cancel())return null;
    try{
      if(f.size>8*2**20)throw new Error('ソースが8 MBを超えています。ビルド済みのファイルを使ってください。');
      const output=await engine.transform(await f.text(),{loader:loader(p),format:'esm',target:'es2020',sourcefile:p,jsx:'automatic',sourcemap:'inline',tsconfigRaw:{compilerOptions:{useDefineForClassFields:true}}});
      mapped.set(p,new Blob([output.code],{type:'text/javascript'}));converted++;
    }catch(e){errors.push({path:p,message:String(e?.message??e).slice(0,500)});}
    notify(converted+errors.length,targets.length);
  }
  return {items:[...mapped],converted,errors};
}
export function clamp(value,min,max){return Math.min(max,Math.max(min,Math.round(value)));}
export function fitViewport(w,h,areaW,areaH){
  const ratio=Math.max(.01,Math.min(1,areaW/w,areaH/h));
  return {ratio,w:w*ratio,h:h*ratio};
}
export const describePage=({page,hash='',query='',request})=>'/'+(request??page)+query+hash;
export async function appSignature(items,home){
  const blob=items.find(([p])=>p===home)?.[1];
  if(!blob)return '';
  const html=await blob.slice(0,48000).text();
  const title=html.match(/<title\b[^>]*>([^<]{1,240})<\/title\s*>/i)?.[1].trim()??'';
  const refs=[...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)].map(x=>x[1].split(/[?#]/)[0].replace(/-[\w]{8,24}(?=\.[a-z]+$)/i,''));
  const raw=title||refs.length?JSON.stringify([title,refs.slice(0,12)]):html.slice(0,24000);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash).slice(0,10),b=>b.toString(16).padStart(2,'0')).join('');
}
