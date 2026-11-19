import test from 'node:test';
import assert from 'node:assert/strict';
import {cornerToggle,flipGeometry} from '../dist/motion.mjs';
import {previewPolicy} from '../dist/policy.mjs';

test('Focus corner hides after entry, reveals on the first tap and exits on the next',()=>{
  let callback,timeout,visible=false,exits=0;
  const ctl=cornerToggle(()=>{visible=true;},()=>{visible=false;},()=>{exits++;},{
    set:(fn,ms)=>{callback=fn;timeout=ms;return 1;},clear:()=>{}
  });
  ctl.press();assert.equal(visible,false);
  ctl.enter();assert.equal(visible,true);assert.equal(timeout,1050);
  const first=callback;first();assert.equal(visible,false);
  ctl.press();assert.equal(visible,true);assert.equal(timeout,1550);
  first();assert.equal(visible,true);
  const old=callback;ctl.press();assert.equal(visible,false);assert.equal(exits,1);
  ctl.enter();ctl.leave();old();assert.equal(visible,false);assert.equal(exits,1);
});
test('FLIP maps the new viewport to its previous visible bounds',()=>{
  const before={left:252,top:70,width:1010,height:740}, after={left:0,top:0,width:1280,height:850};
  const g=flipGeometry(before,after);
  assert.equal(g.x,252);assert.equal(g.y,70);
  assert.equal(g.sx*after.width,before.width);assert.equal(g.sy*after.height,before.height);
  assert.equal(flipGeometry(after,after),null);
  assert.equal(flipGeometry(null,after),null);
});
test('One preview CSP retains offline isolation and allows only opt-in HTTPS scripts',()=>{
  for(const online of [true,false]){
    const directives=Object.fromEntries(previewPolicy(online).trim().split(';').filter(Boolean).map(line=>{
      const [key,...values]=line.trim().split(/\s+/);return [key,values];
    }));
    assert.equal(directives['script-src'].includes('https:'),online);
    assert.equal(directives['script-src-elem'].includes('https:'),online);
    assert.equal(directives['connect-src'].includes('wss:'),online);
    assert.equal(directives['script-src'].includes("'self'"),false);
    assert.equal(directives['script-src-elem'].includes('http:'),false);
    assert.deepEqual(directives['frame-src'],["'none'"]);
  }
});
