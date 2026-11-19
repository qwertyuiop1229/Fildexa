import assert from 'node:assert/strict';
import test from 'node:test';
import {installSplitter,limitSize,resizeValue} from '../dist/splitter.mjs';
import {readLayout,defaultLayout} from '../dist/layout.mjs';
import {previewPolicy,previewSandbox} from '../dist/policy.mjs';

test('Splitter grows left, bottom, right and detail panels in the expected direction',()=>{
  assert.equal(resizeValue(248,37,1,188,500),285);
  assert.equal(resizeValue(330,-87,-1,268,560),417);
  assert.equal(resizeValue(204,-72,-1,90,360),276);
  assert.equal(resizeValue(300,-99,1,95,450),201);
  assert.equal(resizeValue(330,1000,-1,268,560),268);
  assert.equal(limitSize(555,95,60),95);
});
test('Layout restoration validates old and corrupted preferences',()=>{
  assert.deepEqual(readLayout(null),defaultLayout);
  assert.deepEqual(readLayout({side:1300,right:0,bottom:250,ratio:2,placement:'right'}),{side:500,right:268,bottom:250,ratio:.84,placement:'right'});
  assert.equal(readLayout({side:'300',placement:'malformed'}).side,248);
  assert.equal(readLayout({placement:'malformed'}).placement,'bottom');
});
test('Game controls only grant pointer lock and do not relax network/host isolation',()=>{
  assert.equal(previewSandbox(), 'allow-scripts');
  assert.equal(previewSandbox(true), 'allow-scripts allow-pointer-lock');
  for(const enabled of [false,true]){
    assert.doesNotMatch(previewSandbox(enabled),/same-origin|forms|popups|top-navigation/);
    assert.match(previewPolicy(enabled), /form-action 'none'/);
    assert.match(previewPolicy(enabled), /frame-src 'none'/);
  }
});

test('Primary touch input is captured, clamped and released on a tap-drag',()=>{
  const descriptors = Object.fromEntries(['document','window','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const classes=new Set(), attributes=new Map(), dataset={};
  globalThis.document={documentElement:{dataset,removeAttribute(name){if(name==='data-splitting')delete dataset.splitting;}}};
  globalThis.window=new EventTarget();
  let pending=null,ui=204,commits=0,captured=0;
  globalThis.requestAnimationFrame=fn=>{pending=fn;return 7;};
  globalThis.cancelAnimationFrame=()=>{pending=null;};
  try{
    const el=Object.assign(new EventTarget(),{
      dataset:{},setAttribute:(k,v)=>attributes.set(k,v),
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},
      setPointerCapture(id){captured=id;}
    });
    const splitter=installSplitter(el,{axis:()=> 'y',sign:()=>-1,range:()=>[96,320],value:()=>ui,initial:()=>204,change:v=>{ui=v;},commit:()=>{commits++;}});
    function touch(type,y,id=10,isPrimary=true){
      const e=new Event(type,{cancelable:true});
      Object.assign(e,{pointerId:id,pointerType:'touch',isPrimary,button:0,clientY:y});
      el.dispatchEvent(e);
      return e;
    }
    assert.equal(touch('pointerdown',600).defaultPrevented,true);
    touch('pointerdown',600,11,false);
    assert.equal(captured,10);
    touch('pointermove',563);pending();
    assert.equal(ui,241);assert.equal(dataset.splitting,'y');
    touch('pointerup',485);assert.equal(ui,319);assert.equal(commits,1);
    assert.equal(attributes.get('aria-valuenow'),'319');
    assert.equal(classes.size,0);assert.equal(dataset.splitting,undefined);
    splitter.dispose();
  }finally{
    for(const [key,d] of Object.entries(descriptors))if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];
  }
});
