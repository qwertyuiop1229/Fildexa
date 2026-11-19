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
