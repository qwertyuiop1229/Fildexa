let globalClose;
export function pickerBounds(anchor,view,cap=260){
  const {left,top,right,bottom}=view, margin=6, gap=4;
  if(anchor.bottom<=top||anchor.top>=bottom||anchor.right<=left||anchor.left>=right)return null;
  const down=bottom-anchor.bottom-margin-gap,up=anchor.top-top-margin-gap,above=down<138&&up>down;
  const maxHeight=Math.min(cap,above?up:down);
  if(maxHeight<28)return null;
  const width=Math.min(right-left-2*margin,Math.max(105,anchor.width));
  if(width<=0)return null;
  return {left:Math.max(left+margin,Math.min(anchor.left,right-width-margin)),width,maxHeight,edge:above?anchor.top-gap:anchor.bottom+gap,above};
}
export function createPicker(host,labelId,onChange){
  const controller=new AbortController(), signal=controller.signal;
  const on=(node,type,fn,options={})=>node.addEventListener(type,fn,{...options,signal});
  const button=document.createElement('button');
  button.type='button';button.className='btn picker-trigger';button.id=host.id+'-button';
  const title=document.createElement('span');title.id=button.id+'-title';
  button.append(title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const use=document.createElementNS(icon.namespaceURI,'use');use.setAttribute('href','#i-chevron');icon.append(use);icon.setAttribute('aria-hidden','true');button.append(icon);
  const menu=document.createElement('ul');
  menu.className='picker-menu';menu.id=host.id+'-menu';menu.hidden=true;menu.inert=true;
  menu.setAttribute('role','listbox');menu.setAttribute('aria-labelledby',labelId);menu.setAttribute('aria-hidden','true');
  button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-labelledby',labelId+' '+title.id);
  host.classList.add('picker');host.append(button);document.body.append(menu);
  let values=[],current='',highlight=0,type='',last=0,shown=false;
  function refresh(){
    title.textContent=values.find(x=>x.value===current)?.label??'選択なし';
    title.title=title.textContent;
    [...menu.children].forEach((el,i)=>el.setAttribute('aria-selected',String(values[i].value===current)));
    button.disabled=!values.length;
  }
  function close(focus=false){
    if(!shown)return;
    if(focus||menu.contains(document.activeElement))button.focus({preventScroll:true});
    shown=false;menu.dataset.open='false';menu.inert=true;menu.setAttribute('aria-hidden','true');
    button.setAttribute('aria-expanded','false');if(globalClose===close)globalClose=null;
  }
  function position(){
    const visual=window.visualViewport;
    const left=visual?.offsetLeft??0,top=visual?.offsetTop??0;
    const view={left,top,right:left+(visual?.width??window.innerWidth),bottom:top+(visual?.height??window.innerHeight)};
    const portal=host.closest('dialog'),scroller=host.closest('.lab-body');
    const anchor=button.getBoundingClientRect();
    if(scroller){
      const clip=scroller.getBoundingClientRect();
      if(anchor.bottom<=clip.top||anchor.top>=clip.bottom){if(shown)close();return false;}
    }
    if(portal){
      const rect=portal.getBoundingClientRect();
      view.left=Math.max(view.left,rect.left);view.right=Math.min(view.right,rect.right);
      view.top=Math.max(view.top,rect.top);view.bottom=Math.min(view.bottom,rect.bottom);
    }
    const g=pickerBounds(anchor,view);if(!g){if(shown)close();return false;}
    menu.style.width=g.width+'px';menu.style.left=g.left+'px';
    menu.style.maxHeight=g.maxHeight+'px';
    menu.style.top=g.above?'auto':g.edge+'px';menu.style.bottom=g.above?(window.innerHeight-g.edge)+'px':'auto';
    menu.dataset.placement=g.above?'above':'below';return true;
  }
  function move(index){
    highlight=(index+values.length)%values.length;
    const option=menu.children[highlight];
    if(!option)return;
    option.focus({preventScroll:true});
    const top=option.offsetTop,end=top+option.offsetHeight;
    if(top<menu.scrollTop)menu.scrollTop=top;
    else if(end>menu.scrollTop+menu.clientHeight)menu.scrollTop=end-menu.clientHeight;
  }
  function open(){
    if(!values.length)return;
    globalClose?.();
    const portal=host.closest('dialog')??document.body;if(menu.parentNode!==portal)portal.append(menu);
    if(!position())return;globalClose=close;
    // Keep the list in the layout between opens so both directions can fade.
    menu.hidden=false;menu.getBoundingClientRect();
    shown=true;menu.dataset.open='true';menu.inert=false;menu.setAttribute('aria-hidden','false');button.setAttribute('aria-expanded','true');
    move(Math.max(0,values.findIndex(x=>x.value===current)));
  }
  function choose(index){const next=values[index];if(!next)return;const prev=current;current=next.value;refresh();close(true);if(prev!==current)onChange(current);}
  on(button,'click',()=>shown?close():open());
  on(button,'keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(!shown)open();}});
  on(menu,'click',e=>{
    const option=e.target.closest('[role=option]');
    if(option&&shown)choose(Number(option.dataset.index));
  });
  on(menu,'focusin',e=>{if(e.target.dataset.index!==undefined)highlight=Number(e.target.dataset.index);});
  on(menu,'keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    else if(e.key==='Tab'){close(true);}
    else if(e.key==='ArrowDown'){e.preventDefault();move(highlight+1);}
    else if(e.key==='ArrowUp'){e.preventDefault();move(highlight-1);}
    else if(e.key==='Home'){e.preventDefault();move(0);}
    else if(e.key==='End'){e.preventDefault();move(values.length-1);}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(highlight);}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      const now=Date.now();type=(now-last<650?type:'')+e.key.toLowerCase();last=now;
      const i=values.findIndex(x=>x.label.toLowerCase().startsWith(type));if(i>=0)move(i);
    }
  });
  on(document,'pointerdown',e=>{if(shown&&!host.contains(e.target)&&!menu.contains(e.target))close();},{capture:true});
  const reflow=()=>{if(shown)position();};
  on(window,'resize',reflow);
  if(window.visualViewport){on(window.visualViewport,'resize',reflow);on(window.visualViewport,'scroll',reflow);}
  on(document,'scroll',e=>{if(shown&&e.target!==menu)position();},{capture:true});
  return {
    set(items,value){close();values=items;current=value;
      menu.replaceChildren(...items.map((item,i)=>{
        const li=document.createElement('li');li.setAttribute('role','option');li.tabIndex=-1;li.textContent=item.label;li.dataset.index=String(i);return li;
      }));
      refresh();
    },
    value(value){current=value;refresh();},
    close,
    destroy(){close();controller.abort();menu.remove();button.remove();}
  };
}
