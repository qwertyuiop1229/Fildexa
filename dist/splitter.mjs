export function limitSize(value,min,max) {
  return Math.max(min,Math.min(Math.max(min,max),Math.round(value)));
}
export function resizeValue(start,delta,sign,min,max){
  return limitSize(start+delta*sign,min,max);
}
export function installSplitter(el,config){
  const abort=new AbortController(),{signal}=abort;
  let drag=null,raf=0,next=null;
  const dragSurface=document.documentElement;
  const axis=()=>config.axis?.()??'x';
  const sign=()=>config.sign?.()??1;
  const pos=(event,a)=>a==='x'?event.clientX:event.clientY;
  function render(){
    const [min,max]=config.range();
    const orientation=axis()==='x'?'vertical':'horizontal';
    el.dataset.orientation=orientation;
    el.setAttribute('aria-orientation',orientation);
    el.setAttribute('aria-valuemin',String(min));el.setAttribute('aria-valuemax',String(Math.max(min,max)));
    el.setAttribute('aria-valuenow',String(limitSize(config.value(),min,max))); 
    if(config.label){
      const label=config.label();
      el.setAttribute('aria-label',label);el.title=label+' · ダブルクリックで元に戻す';
    }
  }
  function apply(value) {
    const [min,max]=config.range();
    config.change(limitSize(value,min,max));render();
  }
  function flush(){
    raf=0;
    if(!drag||next===null)return;
    const v=next;next=null;
    const [min,max]=config.range();
    const size=resizeValue(drag.value,v-drag.start,drag.sign,min,max);
    if(size!==config.value())apply(size);
  }
  function end(event){
    if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;
    if(event?.type==='pointerup')next=pos(event,drag.axis);
    if(raf)cancelAnimationFrame(raf);
    flush();
    drag=null;next=null;el.classList.remove('dragging');
    dragSurface.removeAttribute('data-splitting');config.commit?.();
  }
  el.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||drag)return;
    event.preventDefault();
    const a=axis();
    try{el.setPointerCapture(event.pointerId);}catch{return;}
    drag={id:event.pointerId,axis:a,sign:sign(),start:pos(event,a),value:config.value()};
    el.classList.add('dragging');dragSurface.dataset.splitting=a;
    config.start?.();
  },{signal});
  el.addEventListener('pointermove',event=>{
    if(event.pointerId!==drag?.id)return;
    next=pos(event,drag.axis);
    if(!raf)raf=requestAnimationFrame(flush);
  },{signal});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,end,{signal});
  window.addEventListener('blur',end,{signal});
  el.addEventListener('keydown',event=>{
    const a=axis(),d=a==='x'?{ArrowLeft:-1,ArrowRight:1}:{ArrowUp:-1,ArrowDown:1};
    const delta=d[event.key];
    if(!delta&&!['Home','End'].includes(event.key))return;
    event.preventDefault();
    const [min,max]=config.range();
    const next=event.key==='Home'?min:event.key==='End'?max:config.value()+delta*sign()*(event.shiftKey?40:12);
    config.start?.();apply(next);config.commit?.();
  },{signal});
  el.addEventListener('dblclick',()=>{
    config.start?.();apply(config.initial());config.commit?.();
  },{signal});
  render();
  return {render,dispose(){end();abort.abort();}};
}
