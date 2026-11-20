import assert from 'node:assert/strict';
import test from 'node:test';
import {request} from 'node:http';
import {launch,unpack,byteRange,route} from '../server.mjs';
import {inspectCompatibility,packageProject,parseNative,parseHosted} from '../dist/native.mjs';
const blob=(x)=>new Blob([x]);
const rows=[['index.html',blob('<h1>ZipStage local</h1>')],['other.html',blob('<h1>subpage</h1>')],['assets/a.js',blob('export const a=1;')],['data.bin',blob('abcdefghij')],['sw.js',blob('self.addEventListener("fetch",()=>{});')]];
const build=async (entries=rows,meta={entry:'index.html',spa:true,rewrites:[{source:'/auth',destination:'/other.html'}]})=>Buffer.from(await packageProject(entries,meta).arrayBuffer());
test('Native packaging validates files and config, without accepting secrets or traversal',async()=>{
  const body=await build();
  const p=unpack(body);
  assert.equal(route(p,'/auth',true),'other.html');
  assert.equal(route(p,'/new/routed/page',true),'index.html');
  assert.equal(route(p,'/missing.js',true),null);
  assert.equal(route(p,'/api/missing',false),null);
  assert.equal(route(p,'/__/auth/handler',true),null);
  assert.equal(route(p,'/assets/a.js',false),'assets/a.js');
  for(const name of ['../private.html','a/../../x','.env','credentials.json','a\\x'])await assert.rejects(async()=>unpack(await build([...rows,[name,blob('bad')]])),/ファイル名/);
  assert.throws(()=>unpack(body.subarray(0,body.length-1)));
  assert.deepEqual(byteRange('bytes=1-3',10),[1,3]);
  assert.deepEqual(byteRange('bytes=-2',10),[8,9]);
  assert.equal(byteRange('bytes=10-',10),false);
});
function previewRequest(url,path,headers={}){
  const target=new URL(url);
  return new Promise((done,reject)=>{
    const r=request({host:'127.0.0.1',port:target.port,path,headers:{Host:target.host,...headers}},res=>{
      const bits=[];res.on('data',b=>bits.push(b));res.on('end',()=>done({code:res.statusCode,headers:res.headers,body:Buffer.concat(bits).toString()}));
    });r.on('error',reject);r.end();
  });
}
test('Local server delivers unmodified web files on distinct origins and rejects untrusted callers',async t=>{
  const s=await launch();t.after(s.close);
  const origin=new URL(s.url).origin;
  const api=p=>new URL('/__zipstage/'+p,s.url);
  assert.equal((await fetch(api('session'),{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const {token}=await (await fetch(api('session'))).json();
  const body=await build();
  const headers={Origin:origin,'X-ZipStage-Session':token,'Content-Type':'application/octet-stream'};
  const create=h=>fetch(api('project'),{method:'POST',headers:h,body});
  assert.equal((await create({...headers,Origin:'https://example.com'})).status,403);
  assert.equal((await create({...headers,'X-ZipStage-Session':'invalid'})).status,403);
  const response=await create(headers);
  assert.equal(response.status,201);
  const a=parseNative(await response.json()), b=parseNative(await (await create(headers)).json());
  assert.notEqual(new URL(a.url).hostname,new URL(b.url).hostname);
  const root=await previewRequest(a.url,'/',{Accept:'text/html'});
  assert.equal(root.body,'<h1>ZipStage local</h1>');
  assert.match(root.headers['content-security-policy'],/frame-ancestors/);
  assert.equal((await previewRequest(a.url,'/other',{Accept:'text/html'})).body,'<h1>subpage</h1>');
  assert.equal((await previewRequest(a.url,'/assets/a.js')).headers['content-type'],'text/javascript; charset=utf-8');
  assert.equal((await previewRequest(a.url,'/sw.js')).code,200);
  assert.equal((await previewRequest(a.url,'/data.bin',{Range:'bytes=1-3'})).body,'bcd');
  assert.equal((await previewRequest(a.url,'/sw.js',{Host:'127.0.0.1:'+new URL(a.url).port})).code,403);
  assert.equal((await previewRequest(a.url,'/__zipstage/session')).code,404);
  assert.equal((await fetch(api('project/'+a.id),{method:'DELETE',headers})).status,200);
  await assert.rejects(previewRequest(a.url,'/'));
});
test('Stable localhost is accepted only when the user launches the auth test server',async t=>{
  assert.throws(()=>parseNative({id:'1'.repeat(48),url:'http://localhost:4176/'}));
  assert.throws(()=>parseNative({id:'1'.repeat(48),url:'https://localhost:4176/'},true));
  assert.equal(parseNative({id:'1'.repeat(48),url:'http://localhost:4176/'},true).authLocal,true);
});
test('Compatibility scan identifies OAuth and relevant browser features',async()=>{
  const result=await inspectCompatibility([['index.html',blob('GoogleAuthProvider signInWithPopup indexedDB serviceWorker')],['app.js',blob('new WebSocket("wss://host"); new BrowserRouter()')]]);
  assert.deepEqual(result.map(x=>x.id),['oauth','storage','worker','realtime','spa']);
  assert.equal((await inspectCompatibility([['index.html',blob('signInWithRedirect')]],()=>true)).length,0);
});

test('Hosted preview accepts only a separate HTTPS origin and no embedded credentials',()=>{
  assert.equal(parseHosted('https://example.web.app/index.html','https://zipstage.example').host,'example.web.app');
  for(const url of ['http://example.web.app','javascript:alert(1)','https://a:b@example.com','https://zipstage.example/'])
    assert.throws(()=>parseHosted(url,'https://zipstage.example'));
});
