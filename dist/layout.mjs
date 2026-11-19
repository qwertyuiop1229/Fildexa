import {installSplitter,limitSize} from './splitter.mjs';

export const defaultLayout=Object.freeze({side:248,right:330,bottom:204,ratio:.41,placement:'bottom'});
export function readLayout(value){
  const range=(field,min,max)=>{
    const n=value?.[field];return Number.isFinite(n)?limitSize(n,min,max):defaultLayout[field];
  };
  return {
    side:range('side',188,500),right:range('right',268,560),bottom:range('bottom',96,490),
    ratio:Number.isFinite(value?.ratio)?Math.max(.16,Math.min(.84,value.ratio)):defaultLayout.ratio,
    placement:value?.placement==='right'?'right':'bottom'
  };
}
export function createLayout($,dock,reflow,onResize,onStart){
  const key='zipstage:layout:v1',root=document.documentElement,stage=$('preview'),studio=document.querySelector('.studio');
  const media=window.matchMedia('(min-width: 901px) and (min-height: 421px)');
  let stored;try{stored=JSON.parse(localStorage.getItem(key));}catch{}
  const state=readLayout(stored);
  let open=false,dockMode='bottom',inner=null;
  function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{}}
  const sideRange=()=>[188,Math.max(188,Math.min(500,studio.clientWidth-515))];
  const rightRange=()=>[268,Math.max(268,Math.min(560,stage.clientWidth-365))];
  const bottomRange=()=>{
    const max=Math.max(52,Math.min(490,Math.floor(stage.clientHeight*.62)-83));
    return [Math.min(96,max),max];
  };
  const clamp=(v,[a,b])=>limitSize(v,a,b);
  const canSide=()=>media.matches&&stage.clientWidth>=645;
  function refresh(){
    const right=canSide();
    dockMode=open&&right&&state.placement==='right'?'right':'bottom';
    if(stage.dataset.dock!==dockMode)stage.dataset.dock=dockMode;
    const next=state.placement==='right'?'下に配置':'右に配置';
    const position=$('dock-position');
    position.hidden=!right;
    position.setAttribute('aria-label','開発ツールを'+next);
    position.title='開発ツールを'+next;
    position.setAttribute('aria-pressed',String(state.placement==='right'));
    $('dock-icon').setAttribute('href',state.placement==='right'?'#i-dock-bottom':'#i-dock-right');
    $('tool-split').hidden=!open;
    root.style.setProperty('--side-width',clamp(state.side,sideRange())+'px');
    root.style.setProperty('--dock-width',clamp(state.right,rightRange())+'px');
    root.style.setProperty('--dock-height',clamp(state.bottom,bottomRange())+'px');
    sidebar.render();handle.render();inner?.update();onResize();
  }
  const sidebar=installSplitter($('sidebar-split'),{
    range:sideRange,value:()=>clamp(state.side,sideRange()),initial:()=>defaultLayout.side,
    change:v=>{state.side=v;refresh();},commit:save,start:onStart
  });
  const handle=installSplitter($('tool-split'),{
    axis:()=>dockMode==='right'?'x':'y',sign:()=>-1,
    label:()=>dockMode==='right'?'開発ツールの幅を調整':'開発ツールの高さを調整',
    range:()=>dockMode==='right'?rightRange():bottomRange(),
    value:()=>dockMode==='right'?clamp(state.right,rightRange()):clamp(state.bottom,bottomRange()),
    initial:()=>dockMode==='right'?defaultLayout.right:defaultLayout.bottom,
    change:v=>{if(dockMode==='right')state.right=v;else state.bottom=v;refresh();},commit:save,start:onStart
  });
  function mount(host){
    inner?.dispose();inner=null;
    if(!host)return;
    const bar=document.createElement('div');
    bar.className='splitter pane-split';bar.setAttribute('role','separator');bar.tabIndex=0;
    host.insertBefore(bar,host.lastElementChild);
    const range=()=>{
      const width=host.clientWidth;
      const min=Math.min(95,Math.floor(width*.34));
      return [min,Math.max(min,width-min)];
    };
    const config={
      label:()=> '一覧と詳細の幅を調整',
      range,
      value:()=>clamp(host.clientWidth*state.ratio,range()),
      initial:()=>host.clientWidth*defaultLayout.ratio,
      change:v=>{if(host.clientWidth)state.ratio=v/host.clientWidth;update();},commit:save
    };
    const split=installSplitter(bar,config);
    function update(){
      if(!host.isConnected||!host.clientWidth)return;
      host.style.setProperty('--pane-list-width',config.value()+'px');split.render();
    }
    const observer=window.ResizeObserver?new ResizeObserver(update):null;observer?.observe(host);
    inner={update,dispose(){observer?.disconnect();split.dispose();}};
    update();
  }
  $('dock-position').onclick=()=>{
    if(!canSide())return;
    state.placement=state.placement==='right'?'bottom':'right';save();
    if(!open)dock.show();
    else reflow(refresh);
  };
  const observer=window.ResizeObserver?new ResizeObserver(refresh):null;
  observer?.observe(studio);observer?.observe(stage);
  window.addEventListener('resize',refresh);
  media.addEventListener?.('change',refresh);
  refresh();
  return {mount,panel(v){open=v;refresh();},refresh};
}
