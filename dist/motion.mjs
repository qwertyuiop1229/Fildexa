const running=new WeakMap();
const reduce=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const curve='cubic-bezier(.22,.75,.23,1)';
export function cancelMotion(element) {
  running.get(element)?.cancel();running.delete(element);
}
function animate(element,keyframes,options) {
  if(reduce()||!element.animate)return;
  cancelMotion(element);
  const animation=element.animate(keyframes,{easing:curve,...options});
  running.set(element,animation);
  animation.finished.then(()=>{if(running.get(element)===animation)running.delete(element);},()=>{});
}
export function rectOf(element) {
  return element.hidden?null:element.getBoundingClientRect();
}
export function flipGeometry(before,after) {
  if(!before||!after||before.width<2||before.height<2||after.width<2||after.height<2)return null;
  const x=before.left-after.left,y=before.top-after.top,sx=before.width/after.width,sy=before.height/after.height;
  if(Math.abs(x)+Math.abs(y)+Math.abs(before.width-after.width)+Math.abs(before.height-after.height)<1)return null;
  return {x,y,sx,sy};
}
export function playFlip(element,before,duration=245) {
  if(reduce())return;
  const g=flipGeometry(before,rectOf(element));
  if(!g)return;
  animate(element,[{transformOrigin:'top left',transform:'translate3d('+g.x+'px,'+g.y+'px,0) scale('+g.sx+','+g.sy+')'},{transformOrigin:'top left',transform:'translate3d(0,0,0) scale(1)'}],{duration});
}
export function enterContent(element,{duration=160,x=0,y=3,opacity=.75}={}) {
  const offset='translate3d('+x+'px,'+y+'px,0)';
  animate(element,[{opacity,transform:offset},{opacity:1,transform:'translate3d(0,0,0)'}],{duration});
}
export function flashIcon(element) {
  animate(element,[{opacity:.4,transform:'scale(.86)'},{opacity:1,transform:'scale(1)'}],{duration:175});
}
export function cornerToggle(show,hide,exit,{delay=1050,hold=1550,set=setTimeout,clear=clearTimeout}={}) {
  let active=false,visible=false,timer=null,epoch=0;
  const stop=()=>{epoch++;if(timer!==null)clear(timer);timer=null;};
  const conceal=()=>{stop();visible=false;hide();};
  const reveal=duration=>{
    stop();visible=true;show();
    const id=epoch;
    timer=set(()=>{if(id===epoch)conceal();},duration);
  };
  return {
    enter(){active=true;reveal(delay);},
    leave(){active=false;conceal();},
    press(){
      if(!active)return;
      if(visible){active=false;conceal();exit();}
      else reveal(hold);
    }
  };
}
