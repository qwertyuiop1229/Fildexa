import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {clean,readZip} from '../dist/zip.mjs';
import {scan,expand} from '../dist/project.mjs';
const fixture=()=>readFile(new URL('../dist/sample.zip',import.meta.url));
test('Finds hosting.public under a GitHub-style folder and extracts only deployed files',async()=>{
  const z=readZip(await fixture());
  const {candidates}=await scan(z);
  assert.equal(candidates[0].kind,'Firebase Hosting');
  assert.equal(candidates[0].root,'ZipStage-sample/dist/');
  assert.deepEqual(candidates[0].pages,['index.html','details/index.html']);
  assert.deepEqual(candidates[0].rewrites,[{source:'/details',destination:'/details/index.html'}]);
  const parts=new Map(await expand(z,candidates[0]));
  assert.equal(parts.has('firebase.json'),false);
  assert.match(await parts.get('index.html').text(),/ZIPから、こんにちは。/);
  assert.equal(parts.get('styles/main.css').type,'text/css');
  assert.match(await parts.get('assets/counter.js').text(),/plusOne/);
});
test('Rejects invalid archives and excludes traversal, dot files and key files',()=>{
  assert.throws(()=>readZip(Uint8Array.of(1,2,3)),/ZIP/);
  for(const p of ['../../escape','/etc/passwd','C:\\Users\\x','site\\..\\secret','/absolute','.env','a/.git/config','x/server.pem','x/service-account.json','node_modules/pkg/index.html'])
    assert.equal(clean(p),null,p);
  for(const [a,b] of [['docs//index.html','docs/index.html'],['公開/地図.png','公開/地図.png']])assert.equal(clean(a),b);
});
test('Rejects corrupt compressed bytes', async()=>{
  const bytes=await fixture(), z=readZip(bytes), path='ZipStage-sample/dist/index.html', p=z.files.get(path);
  bytes[p.from+5]^=255;
  await assert.rejects(z.blob(path),/ZIP/);
});
test('Detects a build-required Vite source tree with no publication output',async()=>{
  const base='FlickMemo-main/';
  const data=new Map([[base+'index.html','<script type="module" src="/src/main.ts"></script>'],[base+'src/main.ts',''],[base+'package.json',JSON.stringify({scripts:{build:'vite build'},devDependencies:{vite:'^5.0.0'}})]]);
  const scanResult=await scan({files:new Map([...data].map(([p,t])=>[p,{length:t.length}])),blob:async p=>new Blob([data.get(p)])});
  assert.equal(scanResult.build,true);
  assert.equal(scanResult.candidates[0].root,base);
});
test('Finds both an Astro-Fray-like public directory and a direct zipped publication folder',async()=>{
  for(const paths of [['Astro-Fray-master/firebase.json','Astro-Fray-master/public/index.html'],['public/index.html','public/assets/app.js']]){
    const expected=paths[0].includes('Astro')?'Astro-Fray-master/public/':'public/';
    const res=await scan({files:new Map(paths.map(p=>[p,{length:30}])),blob:async()=>new Blob(['{"hosting":{"public":"public"}}'])});
    assert.equal(res.candidates[0].root,expected);
  }
});

import vm from 'node:vm';
import {normalizeEntries,projectKey,SavedProjects,safeStorage,fitViewport,describePage} from '../dist/workspace.mjs';

test('Returns from nested sample page to the root and preserves rewrite paths',async()=>{
  const runner=await readFile(new URL('../dist/runner.js',import.meta.url),'utf8');
  const route=vm.runInNewContext(runner+'\nzipstageRoutes');
  const files=new Map([['index.html',''],['details/index.html',''],['topics/article.htm','']]);
  assert.equal(route('',files,[]),'index.html');
  assert.equal(route('details',files,[]),'details/index.html');
  assert.equal(route('details/',files,[]),'details/index.html');
  assert.equal(route('topics/article',files,[]),'topics/article.htm');
  assert.equal(route('topics/some/thing',files,[{source:'/topics/**',destination:'/topics/article.htm'}]),'topics/article.htm');
  assert.equal(route('other',files,[]),null);
  assert.equal(describePage({page:'index.html',request:'',query:'?a=1',hash:'#about'}),'/?a=1#about');
});
test('Selects a local source folder without treating it as a ZIP',async()=>{
  const base=new URL('./fixtures/ViteQA/',import.meta.url);
  const paths=['index.html','package.json','src/main.ts','src/message.ts','src/data.json','src/style.css'];
  const rows=await Promise.all(paths.map(async path=>({path:'ViteQA/'+path,file:new Blob([await readFile(new URL(path,base))])})));
  const archive=normalizeEntries(rows);
  const found=await scan(archive);
  assert.equal(found.build,true);
  assert.equal(found.candidates[0].home,'index.html');
  assert.match(await (await archive.blob('ViteQA/src/main.ts')).text(),/interface Status/);
});
test('Fits custom viewports without overflowing the stage',()=>{
  assert.deepEqual(fitViewport(768,1024,400,512),{ratio:.5,w:384,h:512});
  assert.deepEqual(fitViewport(390,844,900,844),{ratio:1,w:390,h:844});
});
test('Stores project data independently and deletes only the selected record',()=>{
  const data=new Map();
  const storage=new SavedProjects({get length(){return data.size},key:i=>[...data.keys()][i],setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k),removeItem:k=>data.delete(k)});
  const a=projectKey('Covo-master.zip','Covo-master/public/','Covo-master/','Firebase Hosting');
  const b=projectKey('Astro-Fray','Astro-Fray/public/','Astro-Fray/','公開フォルダ');
  assert.notEqual(a,b);
  storage.write(a,{enabled:true,local:{score:'4'}});storage.write(b,{enabled:true,local:{score:'1'}});
  assert.equal(storage.load(a).local.score,'4');
  assert.equal(storage.list().length,2);
  storage.erase(b);
  assert.equal(storage.load(a).local.score,'4');
  assert.equal(storage.load(b),null);
  assert.deepEqual(safeStorage([['x','1'],['bad',3],[{},'bad']]),{x:'1'});
});

test('Distinguishes unrelated projects with the same generic folder name', async()=>{
  const {appSignature}=await import('../dist/workspace.mjs');
  const signature=markup=>appSignature([['index.html',new Blob([markup])]],'index.html');
  const a=await signature('<title>Covo</title><script src="/assets/main-AbCdEf98.js"></script>');
  const aUpdate=await signature('<title>Covo</title><script src="/assets/main-AbCdEf00.js"></script>');
  const b=await signature('<title>Astro Fray</title><script src="/assets/main-AbCdEf98.js"></script>');
  assert.equal(a,aUpdate);assert.notEqual(a,b);
  assert.notEqual(projectKey('public','public/','public/','公開フォルダ',a),projectKey('public','public/','public/','公開フォルダ',b));
});
