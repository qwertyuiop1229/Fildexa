import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {clean,mime,limits} from './dist/zip.mjs';

const dist=fileURLToPath(new URL('./dist/',import.meta.url));
const MAX_HEADER=2*1024*1024, MAX_BODY=limits.total+MAX_HEADER+4;
const TTL=60*60_000;
const baseHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'};
export const secret=()=>randomBytes(24).toString('hex');
const okPath=p=>typeof p==='string'&&clean(p)===p;
export function unpack(buf){
  if(buf.length<4)throw Error('データが不足しています。');
  const len=buf.readUInt32LE(0);
  if(len<2||len>MAX_HEADER||len+4>buf.length)throw Error('ファイル一覧が不正です。');
  const meta=JSON.parse(buf.subarray(4,4+len).toString('utf8'));
  if(!meta||!Array.isArray(meta.files)||!meta.files.length||meta.files.length>limits.count)throw Error('ファイル数を確認してください。');
  const files=new Map();let offset=4+len;
  for(const [name,n] of meta.files){
    if(!okPath(name)||!Number.isInteger(n)||n<0||n>limits.entry||offset+n>buf.length||files.has(name))throw Error('ファイル名またはサイズが不正です。');
    files.set(name,buf.subarray(offset,offset+n));offset+=n;
  }
  if(offset-4-len>limits.total)throw Error('展開後の上限は300 MBです。');
  if(offset!==buf.length||!okPath(meta.entry)||!files.has(meta.entry)||!/\.html?$/i.test(meta.entry))throw Error('開始ページが見つかりません。');
  const rewrites=(Array.isArray(meta.rewrites)?meta.rewrites:[]).slice(0,100).flatMap(rule=>{
    const s=rule?.source,d=rule?.destination;
    if(typeof s!=='string'||typeof d!=='string'||s.length>512||!d.startsWith('/')||d.includes('?')||!okPath(d.slice(1))||!files.has(d.slice(1))||!d.match(/\.html?$/i))return [];
    if(s==='**'||s==='/**')return [{source:'**',destination:d.slice(1)}];
    if(!s.startsWith('/')||/[?![\]{}]/.test(s)||s.includes('..')||s.split('/').some(p=>p.includes('*')&&p!=='*'&&p!=='**'))return [];
    return [{source:s,destination:d.slice(1)}];
  });
  return {files,entry:meta.entry,rewrites,spa:meta.spa===true,size:buf.length};
}
function patternMatches(pattern,path){
  if(pattern==='**')return true;
  if(!pattern.includes('*'))return pattern===path;
  const a=pattern.slice(1).split('/'),b=path.slice(1).split('/');
  if(a.length>50||b.length>100)return false;
  const memo=new Map();
  function match(i,j){
    const key=i+':'+j;
    if(memo.has(key))return memo.get(key);
    const yes=i===a.length?j===b.length:a[i]==='**'?match(i+1,j)||(j<b.length&&match(i,j+1)):
      j<b.length&&(a[i]==='*'||a[i]===b[j])&&match(i+1,j+1);
    memo.set(key,yes);
    return yes;
  }
  return match(0,0);
}
export function route(project,pathname,isDocument){
  const p=pathname.slice(1);
  if(!p)return project.files.has('index.html')?'index.html':project.entry;
  const path=p.replace(/\/$/,'');
  if(!okPath(path))return null;
  if(project.files.has(path)&&!p.endsWith('/'))return path;
  if(!isDocument||pathname.startsWith('/__/'))return null;
  if(project.files.has(path+'/index.html'))return path+'/index.html';
  if(!p.endsWith('/')&&project.files.has(path+'.html'))return path+'.html';
  for(const rule of project.rewrites)if(patternMatches(rule.source,pathname))return rule.destination;
  if(project.spa&&!path.split('/').at(-1).includes('.'))return project.entry;
  return null;
}
export function byteRange(header,length){
  if(!header)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||!length||!m[1]&&!m[2])return false;
  const start=m[1]?Number(m[1]):Math.max(0,length-Number(m[2]));
  const end=m[1]&&m[2]?Math.min(length-1,Number(m[2])):length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=length)return false;
  return [start,end];
}
function json(res,status,obj){
  res.writeHead(status,{...baseHeaders,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));
}
function fail(res,status,msg){json(res,status,{error:msg});}
function send(res,req,content,type,headers={}){
  const size=content.length, range=byteRange(req.headers.range,size);
  const h={...baseHeaders,...headers,'Content-Type':type,'Accept-Ranges':'bytes'};
  if(range===false){res.writeHead(416,{...h,'Content-Range':'bytes */'+size});res.end();return;}
  if(range){
    const [a,b]=range;res.writeHead(206,{...h,'Content-Range':'bytes '+a+'-'+b+'/'+size,'Content-Length':b-a+1});
    res.end(req.method==='HEAD'?undefined:content.subarray(a,b+1));return;
  }
  res.writeHead(200,{...h,'Content-Length':size});res.end(req.method==='HEAD'?undefined:content);
}
const nativeTypes={map:'application/json',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',avif:'image/avif',vtt:'text/vtt',bin:'application/octet-stream'};
const typeOf=p=>nativeTypes[p.split('.').at(-1).toLowerCase()]??mime(p);
function onlyRead(req){return req.method==='GET'||req.method==='HEAD';}
function urlPath(req){return decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}
async function body(req){
  const declared=Number(req.headers['content-length']);
  if(!Number.isSafeInteger(declared)||declared<4||declared>MAX_BODY)throw Error('サイズ上限は展開後300 MBです。');
  const out=Buffer.allocUnsafe(declared);let used=0;
  for await(const chunk of req){
    if(used+chunk.length>declared)throw Error('ボディサイズが不正です。');
    chunk.copy(out,used);used+=chunk.length;
  }
  if(used!==declared)throw Error('データが途中で切れています。');
  return out;
}
const listen=(s,port)=>new Promise((ready,error)=>{
  s.once('error',error);s.listen(port,'127.0.0.1',()=>{s.off('error',error);ready(s.address().port);});
});
export async function launch(port=0,{authPort=null}={}){
  const token=secret(), sessions=new Map(), oldPorts=new Set();let controlPort,receiving=false,closed=false;
  const origin=()=> 'http://127.0.0.1:'+controlPort;
  function stop(id){
    const s=sessions.get(id);if(!s)return false;
    clearTimeout(s.timer);sessions.delete(id);s.server.close();s.server.closeAllConnections?.();return true;
  }
  async function spawn(project){
    if(closed)throw Error('ZipStage Local は終了しました。');
    const id=secret(), host=authPort?'localhost':'zs-'+randomBytes(8).toString('hex')+'.localhost';let p=0;
    const server=createServer((req,res)=>{
      const headers={'Content-Security-Policy':"frame-ancestors 'self' "+origin(),'Cross-Origin-Opener-Policy':'same-origin-allow-popups'};
      if(req.headers.host!==host+':'+p)return fail(res,403,'ZipStage が発行したプレビューURLを使ってください。');
      if(!onlyRead(req))return fail(res,405,'このサーバーは静的ファイルを提供します。');
      try{
        const pathname=urlPath(req), isDocument=req.headers['sec-fetch-dest']==='document'||req.headers['sec-fetch-dest']==='iframe'||/\btext\/html\b/.test(req.headers.accept??'');
        const path=route(project,pathname,isDocument);
        if(!path)return fail(res,404,'ファイルが見つかりません。');
        send(res,req,project.files.get(path),typeOf(path),headers);
      }catch{fail(res,400,'URLが不正です。');}
    });
    if(authPort)p=await listen(server,authPort);
    else for(let trial=0;trial<12;trial++){
      p=await listen(server,0);if(!oldPorts.has(p))break;
      await new Promise(ok=>server.close(ok));p=0;
    }
    if(!p)throw Error('新しいプレビュー用ポートを確保できませんでした。');
    if(closed){server.close();throw Error('ZipStage Local は終了しました。');}
    if(!authPort)oldPorts.add(p);
    sessions.set(id,{server,size:project.size,timer:setTimeout(()=>stop(id),TTL).unref()});
    const entry=project.entry==='index.html'?'':'/'+project.entry.split('/').map(encodeURIComponent).join('/');
    return {id,url:'http://'+host+':'+p+(entry||'/'),expiresIn:TTL/1000};
  }
  const control=createServer(async(req,res)=>{
    if(closed||req.headers.host!=='127.0.0.1:'+controlPort)return fail(res,403,'不正なHostです。');
    try{
      const path=urlPath(req);
      if(path==='/__zipstage/session'&&req.method==='GET'){
        if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return fail(res,403,'別オリジンからは使えません。');
        return json(res,200,{token,authLocal:!!authPort});
      }
      if(path.startsWith('/__zipstage/')){
        if(req.headers.origin!==origin()||req.headers['x-zipstage-session']!==token)return fail(res,403,'セッションを確認できません。');
        if(path==='/__zipstage/project'&&req.method==='POST'){
          if(String(req.headers['content-type']).toLowerCase()!=='application/octet-stream')return fail(res,415,'データ形式が不正です。');
          if(receiving||sessions.size>=(authPort?1:4))return fail(res,429,'読み込み中です。不要なプレビューを停止してください。');
          receiving=true;
          try{
            const project=unpack(await body(req));
            if([...sessions.values()].reduce((sum,s)=>sum+s.size,0)+project.size>420*1024**2)return fail(res,413,'動作中のプレビューが大きすぎます。先に停止してください。');
            return json(res,201,await spawn(project));
          }catch(e){return fail(res,400,e.message);}
          finally{receiving=false;}
        }
        if(req.method==='DELETE'&&/^\/__zipstage\/project\/[a-f\d]{48}$/.test(path)){
          stop(path.split('/').pop());return json(res,200,{stopped:true});
        }
        return fail(res,404,'APIが見つかりません。');
      }
      if(!onlyRead(req))return fail(res,405,'読み込み専用です。');
      const p=path==='/'?'index.html':path.slice(1);
      if(!okPath(p))return fail(res,404,'ファイルが見つかりません。');
      const target=resolve(dist,p);
      if(!target.startsWith(dist.endsWith(sep)?dist:dist+sep))return fail(res,404,'ファイルが見つかりません。');
      let fs;
      try{fs=await stat(target);}catch{return fail(res,404,'ファイルが見つかりません。');}
      if(!fs.isFile())return fail(res,404,'ファイルが見つかりません。');
      send(res,req,await readFile(target),typeOf(p),{'Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'none'",'X-Frame-Options':'DENY'});
    }catch(e){if(!res.headersSent)fail(res,400,'読み込みに失敗しました。');else res.destroy();}
  });
  control.requestTimeout=180_000;
  controlPort=await listen(control,port);
  return {url:origin()+'/',close:()=>{closed=true;for(const id of sessions.keys())stop(id);control.close();control.closeAllConnections?.();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const stable=args.includes('--auth-localhost');
  const port=Number(args.find(a=>/^\d+$/.test(a))??4175);
  if(!Number.isInteger(port)||port<0||port>65535||args.some(a=>a!=='--auth-localhost'&&!/^\d+$/.test(a)))throw new Error('使い方: node server.mjs [ポート] [--auth-localhost]');
  const server=await launch(port,{authPort:stable?4176:null});
  if(stable)console.log('認証テスト用: localhost:4176 はデータを共有します。信頼する1つのアプリ専用にしてください。');
  console.log('ZipStage Local を起動しました。\nブラウザで '+server.url+' を開いてください。\n終了は Ctrl+C');
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close();process.exit(0);});
}
