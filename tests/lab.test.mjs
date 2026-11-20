import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {acceptsAsset,relativeAsset,parseDelimited,parseApi,githubLinks,publicReport,classify,sortedChanges,testShareURL} from '../dist/lab-core.mjs';
import {modelTriangles} from '../dist/model-view.mjs';
import {scan} from '../dist/project.mjs';
import {normalizeEntries} from '../dist/workspace.mjs';
import QR from '../dist/vendor/qr/index.mjs';
test('CSV keeps quoted commas, CRLF, embedded newlines, and escaped quotes',()=>{
  assert.deepEqual(parseDelimited('\ufeffID,名前\r\n1,"猫,犬"\r\n2,"a""b\nc"').rows,[['ID','名前'],['1','猫,犬'],['2','a"b\nc']]);
  assert.deepEqual(parseDelimited('a\tb\n\tc','\t').rows,[['a','b'],['','c']]);
  assert.equal(parseDelimited('a\nb\nc',',',2).truncated,true);
});
test('Assets resolve only inside an archive and classify supported formats',()=>{
  assert.equal(relativeAsset('docs/Readme.md','../images/猫%20A.svg'),'images/猫 A.svg');
  assert.equal(relativeAsset('Readme.md','https://a.example/p.svg'),null);
  assert.equal(relativeAsset('Readme.md','javascript:alert(1)'),null);
  assert.equal(acceptsAsset('tmp/Readme.MD'),true);
  assert.equal(acceptsAsset('sample.exe'),false);
});
test('Extracts OpenAPI JSON and block YAML examples for an API mock',()=>{
  const yaml='openapi: 3.0.3\npaths:\n  /api/card/{id}:\n    get:\n      summary: Sample\n      responses:\n        "200":\n          content:\n            application/json:\n              example:\n                message: hello\n                active: true';
  assert.deepEqual(parseApi(yaml),[{path:'/api/card/{id}',method:'GET',label:'Sample',status:200,body:'{"message":"hello","active":true}'}]);
  assert.deepEqual(parseApi('{"openapi":"3","paths":{"/p":{"post":{"responses":{"201":{"content":{"application/json":{"example":[1,2]}}}}}}}}'),[{path:'/p',method:'POST',label:'',status:201,body:'[1,2]'}]);
  assert.equal(parseApi('{}'),null);
});
test('Repo links allow only GitHub and preserve a PR number or slash branch',()=>{
  assert.equal(githubLinks('https://github.com/a/b/pull/17').archive,'https://github.com/a/b/archive/refs/pull/17/head.zip');
  assert.equal(githubLinks('https://github.com/a/b/tree/fix/path').archive,'https://github.com/a/b/archive/refs/heads/fix/path.zip');
  assert.throws(()=>githubLinks('https://github.com.example/a/b'));
  assert.throws(()=>githubLinks('https://user@github.com/a/b'));
});
test('Bug report uses an allowlist for logs, paths, queries, tokens, and test steps',()=>{
  const marker='this-is-private-data';
  const r=publicReport({viewport:[320,640],findings:[{id:'missing',count:2,detail:marker}],steps:[{text:marker,done:true}],metrics:20,network:[{url:'/'+marker,method:'GET',status:200,ms:45,received:[['cookie',marker]]}],route:'/some/path/'+marker+'?token='+marker});
  assert.equal(r.route,'/:path/:path/:path');
  assert.deepEqual(r.steps,[{done:true}]);
  assert.equal(JSON.stringify(r).includes(marker),false);
});
test('Diagnosis groups issues and size comparison identifies additions and removals',()=>{
  const findings=classify({files:['Demo.vue','index.html','my.wasm'],issues:[{id:'missing'},{id:'missing'}],status:'error',report:[{id:'auth'}]});
  assert.deepEqual(findings.map(x=>x.id),['boot','missing','framework','wasm','auth']);
  assert.equal(findings[1].count,2);
  assert.deepEqual(sortedChanges([['a',20],['b',5]],[['a',25],['c',6]]),[{path:'c',before:null,after:6},{path:'a',before:20,after:25},{path:'b',before:5,after:null}]);
});
test('Discovers nested static output directories and excludes unrelated hidden credentials',async()=>{
  const rows=['repo/apps/web/.output/public/index.html','repo/apps/game/dist/index.html','repo/apps/web/.env'].map(path=>({path,file:new Blob(['x'])}));
  const archive=normalizeEntries(rows);
  assert.equal(archive.files.has(rows[2].path),false);
  assert.deepEqual((await scan(archive)).candidates.slice(0,2).map(x=>x.root),['repo/apps/game/dist/','repo/apps/web/.output/public/']);
});
test('Small imported glTF models only read local geometry',async()=>{
  const doc={asset:{version:'2.0'},buffers:[{uri:'v.bin'}],bufferViews:[{buffer:0}],accessors:[{bufferView:0,componentType:5126,count:3}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]};
  const geom=new Float32Array([0,0,0,1,0,0,0,1,0]);
  assert.deepEqual(await modelTriangles('model/demo.gltf',new Blob([JSON.stringify(doc)]),p=>{assert.equal(p,'model/v.bin');return new Blob([geom]);}),[[[0,0,0],[1,0,0],[0,1,0]]]);
  doc.buffers[0].uri='https://example.com/v';
  await assert.rejects(()=>modelTriangles('model/demo.gltf',new Blob([JSON.stringify(doc)]),()=>assert.fail('external access')));
});
test('QR is rendered from a local encoder',()=>{
  assert.equal(testShareURL('https://example.com/demo').href,'https://example.com/demo');
  assert.throws(()=>testShareURL('https://example.com/?token=secret'));
  const q=new QR(-1,1);q.addData(testShareURL('https://example.com/demo').href);q.make();
  assert.ok(q.getModuleCount()>=21&&q.isDark(0,0)&&!q.isDark(1,1)&&q.isDark(3,3));
});
test('Fetch mock handles route parameters, expected status, and does not call remote endpoints',async()=>{
  const src=await readFile(new URL('../dist/lab-runtime.js',import.meta.url),'utf8');
  const calls=[];
  const env={requestAnimationFrame(){},setTimeout,clearTimeout,navigator:{},URL,Response,DOMException,Date,Intl,fetch:async url=>{calls.push(url);return new Response('original');}};
  env.window=env;
  const boot=vm.runInNewContext(src+'\nzipstageLabRuntime;',env);
  const resolve=s=>new URL(s,'https://zipstage.invalid'),localPath=u=>u.origin==='https://zipstage.invalid'?u.pathname.slice(1):null;
  boot(()=>{},{resolve,localPath,lab:{offline:true,rules:[{path:'/api/user/{id}',method:'GET',status:202,body:'{"name":"mock"}'}]}});
  const r=await env.fetch('/api/user/123');
  assert.equal(r.status,202);assert.deepEqual(await r.json(),{name:'mock'});
  assert.equal(r.headers.get('X-ZipStage-Mock'),'1');
  await assert.rejects(()=>env.fetch('https://example.com/'));
  assert.equal(env.navigator.onLine,false);
  assert.equal(calls.length,0);
});

test('Comparison matches same-sized changes, reports skipped reads, and cancels stale work',async()=>{
  const {compareFiles}=await import('../dist/lab-core.mjs');
  const left=[['changed.txt',new Blob(['ab'])],['same.txt',new Blob(['12'])],['removed.txt',new Blob(['abc'])]];
  const right=[['changed.txt',new Blob(['ac'])],['same.txt',new Blob(['12'])],['added.txt',new Blob(['abc'])]];
  const normal=await compareFiles(left,right);
  assert.deepEqual(normal.changes.map(x=>[x.path,!!x.content]),[['added.txt',false],['removed.txt',false],['changed.txt',true]]);
  assert.equal(normal.examined,2);
  assert.equal((await compareFiles(left,right,{limit:3})).skipped,2);
  assert.equal(await compareFiles(left,right,{cancel:()=>true}),null);
});
test('Comparison navigates to valid pages without reloading an identical route',async()=>{
  const {comparisonRoute}=await import('../dist/lab-core.mjs');const pages=['index.html','other.html'];
  const prev={page:'index.html'};
  assert.equal(comparisonRoute({page:'index.html'},prev,'index.html',pages),null);
  assert.deepEqual(comparisonRoute({page:'other.html',hash:'#id',request:'other'},prev,'index.html',pages),{page:'other.html',query:'',hash:'#id',request:'other'});
  assert.deepEqual(comparisonRoute({page:'unknown'},null,'index.html',pages),prev);
});
test('A validation error names the affected mock row and rejects equivalent route patterns',async()=>{
  const {mockRuleProblem}=await import('../dist/lab-core.mjs');
  const a={method:'GET',path:'/api/{id}',status:200,body:'{}'};
  assert.equal(mockRuleProblem([a]),null);
  assert.deepEqual(mockRuleProblem([a,{...a,status:110}]),{line:2,field:'ステータス（200〜599）'});
  assert.deepEqual(mockRuleProblem([a,{...a,path:'/api/{post}'}]),{line:2,field:'重複するメソッドとパス'});
  assert.deepEqual(mockRuleProblem([{...a,path:'/a/{oops'}]),{line:1,field:'パス'});
});
test('Picker position stays in the visible viewport and flips away from the keyboard',async()=>{
  const {pickerBounds}=await import('../dist/picker.mjs');
  const view={left:0,top:15,right:390,bottom:460};
  const anchor={left:305,top:373,right:385,bottom:417,width:80};
  const b=pickerBounds(anchor,view);
  assert.equal(b.above,true);assert.equal(b.left,279);assert.equal(b.width,105);assert.equal(b.edge,369);
  assert.equal(pickerBounds({...anchor,top:475,bottom:515},view),null);
});
