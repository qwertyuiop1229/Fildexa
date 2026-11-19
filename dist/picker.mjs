let globalClose;
export function createPicker(host,labelId,onChange){
  const button=document.createElement('button');
  button.type='button';button.className='btn picker-trigger';button.id=host.id+'-button';
  const title=document.createElement('span');title.id=button.id+'-title';
  button.append(title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const use=document.createElementNS(icon.namespaceURI,'use');use.setAttribute('href','#i-chevron');icon.append(use);button.append(icon);
  const menu=document.createElement('ul');
  menu.className='picker-menu';menu.id=host.id+'-menu';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-labelledby',labelId);
  button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-labelledby',labelId+' '+title.id);
  host.className='picker';host.append(button);document.body.append(menu);
  let values=[],current='',highlight=0,type='',last=0;
  function refresh(){
    title.textContent=values.find(x=>x.value===current)?.label??'選択なし';
    title.title=title.textContent;
    [...menu.children].forEach((el,i)=>el.setAttribute('aria-selected',String(values[i].value===current)));
    button.disabled=!values.length;
  }
  function close(focus=false){menu.hidden=true;button.setAttribute('aria-expanded','false');if(globalClose===close)globalClose=null;if(focus)button.focus();}
  function position(){
    const r=button.getBoundingClientRect(),vh=window.innerHeight;
    const down=vh-r.bottom-7,up=r.top-7,above=down<130&&up>down;
    menu.style.width=Math.max(80,r.width)+'px';menu.style.left=r.left+'px';menu.style.maxHeight=Math.max(38,Math.min(230,above?up:down))+'px';
    menu.style.top=above?'auto':(r.bottom+4)+'px';menu.style.bottom=above?(vh-r.top+4)+'px':'auto';
  }
  function move(index){highlight=(index+values.length)%values.length;menu.children[highlight]?.focus({preventScroll:true});menu.children[highlight]?.scrollIntoView({block:'nearest'});}
  function open(){
    if(!values.length)return;
    globalClose?.();globalClose=close;
    position();menu.hidden=false;button.setAttribute('aria-expanded','true');move(Math.max(0,values.findIndex(x=>x.value===current)));
  }
  function choose(index){const next=values[index];if(!next)return;const prev=current;current=next.value;refresh();close(true);if(prev!==current)onChange(current);}
  button.addEventListener('click',()=>menu.hidden?open():close());
  button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(menu.hidden)open();}});
  menu.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close(true);}
    else if(e.key==='Tab'){close(true);}
    else if(e.key==='ArrowDown'){e.preventDefault();move(highlight+1);}
    else if(e.key==='ArrowUp'){e.preventDefault();move(highlight-1);}
    else if(e.key==='Home'){e.preventDefault();move(0);}
    else if(e.key==='End'){e.preventDefault();move(values.length-1);}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(highlight);}
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      const now=Date.now();type=(now-last<650?type:'')+e.key.toLowerCase();last=now;
      const index=values.findIndex(x=>x.label.toLowerCase().startsWith(type));if(index>=0)move(index);
    }
  });
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!host.contains(e.target)&&!menu.contains(e.target))close();},true);
  window.addEventListener('resize',()=>{if(!menu.hidden)position();});
  document.addEventListener('scroll',e=>{if(!menu.hidden&&e.target!==menu)position();},true);
  return {
    set(items,value){close();values=items;current=value;
      menu.replaceChildren(...items.map((x,i)=>{
        const li=document.createElement('li');li.setAttribute('role','option');li.tabIndex=-1;li.textContent=x.label;li.addEventListener('focus',()=>{highlight=i;});li.addEventListener('click',()=>choose(i));return li;
      }));
      refresh();
    },
    value(value){current=value;refresh();},
    close
  };
}
