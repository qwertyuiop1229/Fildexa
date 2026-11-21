import {enterContent} from './motion.mjs';
import {prettySize} from './workspace.mjs';
import {assetBlob,relativeAsset,parseDelimited,parseApi,types,ext} from './lab-core.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const b=el('button',text,'btn lab-small');b.type='button';b.onclick=fn;return b;};
const input=(text,type='search')=>{const f=el('input');f.type=type;f.placeholder=text;f.setAttribute('aria-label',text);return f;};
const pre=text=>el('pre',text,'asset-code');
function table(headers,rows,sort){
  const t=el('table',undefined,'asset-table'),head=el('thead'),hr=el('tr');
  headers.forEach((h,i)=>{const cell=el('th');cell.scope='col';cell.append(sort?button(h||'#'+(i+1),()=>sort(i)):document.createTextNode(h));hr.append(cell);});head.append(hr);t.append(head);
  const body=el('tbody');for(const row of rows){const r=el('tr');for(const value of row)r.append(el('td',String(value??'')));body.append(r);}t.append(body);return t;
}
export function viewAssets(host,ctx){
  let seq=0, urls=[], font=null, disposeModel=null,path='',archiveToken=null;
  const url=blob=>{const u=URL.createObjectURL(blob);urls.push(u);return u;};
  function close(){seq++;for(const u of urls)URL.revokeObjectURL(u);urls=[];if(font)document.fonts.delete(font);font=null;disposeModel?.();disposeModel=null;host.replaceChildren();path='';archiveToken=null;}
  async function open(next){
    close();path=next;archiveToken=ctx.token();const turn=seq, same=()=>turn===seq;
    host.hidden=false;
    const toolbar=el('div',undefined,'asset-bar'),meta=el('div',undefined,'asset-heading'),mark=el('span',ext(next).toUpperCase(),'lab-badge accent'),title=el('strong',next.split('/').at(-1));title.title=next;
    const details=el('span','読み込み中…','quiet');meta.append(title,details);
    const tools=el('div',undefined,'lab-actions asset-actions');
    const browse=button('ファイル一覧',ctx.browse),back=button('閉じる',ctx.back);
    back.setAttribute('aria-label','ファイルプレビューを閉じる');tools.append(browse,back);
    toolbar.append(mark,meta,tools);
    const pane=el('div',undefined,'asset-content'),loading=el('p','ファイルを読み込み中…','asset-loading');
    loading.setAttribute('role','status');pane.append(loading);host.append(toolbar,pane);
    back.focus({preventScroll:true});
    try{
      const blob=await ctx.read(next);if(!same())return;
      const format=ext(next),file=assetBlob(next,blob);
      details.textContent=prettySize(blob.size);
      const link=el('a','元ファイル','btn lab-small');link.download=next.split('/').at(-1);link.href=url(file);
      tools.insertBefore(link,back);
      pane.replaceChildren();enterContent(pane,{duration:150,y:2});
      if(types.image.test(next)){
        const tools=el('div',undefined,'lab-actions asset-segment');tools.setAttribute('role','group');tools.setAttribute('aria-label','画像の背景');const well=el('div',undefined,'asset-image checker'),img=el('img');img.src=link.href;img.alt=title.textContent;
        img.onerror=()=>well.replaceChildren(el('p','このブラウザではこの画像を表示できません。','quiet'));
        well.append(img);for(const [name,cls] of [['透明','checker'],['明','light'],['暗','dark']]){
          const b=button(name,()=>{well.className='asset-image '+cls;for(const item of tools.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===b));});
          b.setAttribute('aria-pressed',String(cls==='checker'));tools.append(b);
        }
        const sizes=el('div',undefined,'asset-sizes');for(const size of [16,32,64]){
          const icon=el('img');icon.src=link.href;icon.alt='';icon.width=icon.height=size;const cell=el('div');cell.append(icon,el('span',size+' px','quiet'));sizes.append(cell);
        }
        pane.append(tools,well,sizes);
      }else if(types.audio.test(next)||types.video.test(next)){
        const node=el(types.audio.test(next)?'audio':'video');node.controls=true;node.playsInline=true;node.preload='metadata';node.src=link.href;
        node.onerror=()=>pane.append(el('p','この端末ではこの音声・動画を再生できません。','quiet'));pane.append(node);
      }else if(types.pdf.test(next)){
        const frame=el('iframe');frame.title='PDF '+next;frame.setAttribute('sandbox','');frame.src=link.href;frame.className='asset-pdf';
        pane.append(el('p','表示されない場合は「元ファイル」から端末のPDFビューアーで開けます。','quiet'),frame);
      }else if(types.font.test(next)){
        const face=await new FontFace('ZipStageAsset',file.size<=16*2**20?await file.arrayBuffer():new ArrayBuffer(0)).load();
        if(!same())return;
        font=face;document.fonts.add(font);
        const f=input('試したい文字を入力','text'),sample=el('p','Fildexa こんにちは Aa 123','asset-font');f.value=sample.textContent;f.oninput=()=>sample.textContent=f.value;pane.append(f,sample);
      }else if(types.model.test(next)){
        const model=await import('./model-view.mjs');if(!same())return;
        const draw=await model.viewModel(next,file,pane,(p)=>ctx.read(p),same);if(!same()){draw?.();return;}disposeModel=draw;
      }else if(types.text.test(next)){
        const max=500000,text=await blob.slice(0,max).text();if(!same())return;
        if(blob.size>max)pane.append(el('p','先頭500 KBのみ表示しています。','quiet'));
        if(['md','markdown'].includes(format)){
          const doc=el('article',undefined,'asset-md'),tracks=[],paths=new Set(ctx.paths());
          for(const line of text.split(/\r?\n/).slice(0,1600)){
            if(/^\s*```/.test(line)){
              if(tracks.length)doc.append(pre(tracks.pop().join('\n')));else tracks.push([]);continue;
            }
            if(tracks.length){tracks[0].push(line);continue;}
            if(!line.trim())continue;
            const m=/^(#{1,5})\s+(.*)$/.exec(line),quote=line.startsWith('> '),list=/^\s*[-*]\s+/.test(line);
            const row=el(m?'h'+Math.min(6,m[1].length+1):quote?'blockquote':'p',undefined,list?'md-item':'');
            const content=m?m[2]:quote?line.slice(2):list?line.replace(/^\s*[-*]\s+/,''):line;
            let last=0;
            for(const hit of content.matchAll(/(!?)\[([^\]]{0,150})\]\(([^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g)){
              row.append(content.slice(last,hit.index));last=hit.index+hit[0].length;
              if(hit[4]||hit[5])row.append(el(hit[4]?'code':'strong',hit[4]??hit[5]));
              else {
                const relative=relativeAsset(next.replace(/^\//,''),hit[3]);
                const p=relative&&(next.startsWith('/')&&paths.has('/'+relative)?'/'+relative:relative);
                if(p&&paths.has(p)){
                  if(hit[1]&&types.image.test(p)){
                    const img=el('img');img.alt=hit[2];row.append(img);void ctx.read(p).then(f=>{if(same())img.src=url(assetBlob(p,f));}).catch(()=>{});
                  }else row.append(button(hit[2]||p,()=>open(p)));
                }else row.append(hit[2]||hit[3]);
              }
            }
            row.append(content.slice(last));doc.append(row);
          }
          if(tracks.length)doc.append(pre(tracks.pop().join('\n')));
          pane.append(doc);
        }else if(['csv','tsv'].includes(format)){
          const data=parseDelimited(text,format==='tsv'?'\t':','),headers=data.rows.shift()??[],f=input('行を検索');
          let col=-1,desc=false;const wrap=el('div',undefined,'asset-table-wrap');
          function render(){const q=f.value.trim().toLowerCase();const rows=data.rows.filter(row=>row.some(c=>c.toLowerCase().includes(q)));if(col>=0)rows.sort((a,b)=>(desc?-1:1)*String(a[col]??'').localeCompare(String(b[col]??''),'ja',{numeric:true}));wrap.replaceChildren(table(headers,rows,i=>{desc=col===i?!desc:false;col=i;render();wrap.querySelectorAll('th')[i]?.setAttribute('aria-sort',desc?'descending':'ascending');wrap.querySelectorAll('th button')[i]?.focus();}));}
          f.oninput=render;pane.append(f,wrap);if(data.truncated)pane.append(el('p','先頭400行を表示しています。','quiet'));render();
        }else if(['json','webmanifest','yaml','yml'].includes(format)){
          let api;try{api=parseApi(text);}catch{}
          if(api?.length){
            const grid=el('div',undefined,'lab-list');
            for(const row of api){
              const item=el('div',undefined,'lab-row');item.append(el('div',row.method+' '+row.path,'lab-mono'),el('p',row.label||('応答 '+row.status),'quiet'),button('モックに追加',()=>ctx.mock(row)));grid.append(item);
            }
            const source=el('details');source.append(el('summary','元の定義を見る'),pre(text));pane.append(el('h3','APIの操作'),grid,source);
          }else if(['json','webmanifest'].includes(format)){
            let data;try{data=JSON.parse(text);}catch{pane.append(el('p','JSONを解析できませんでした。','quiet'),pre(text));return;}
            const f=input('キー・値を検索'),tree=el('div',undefined,'asset-tree');let count=0;
            function treeFor(key,value,root=false,depth=0){
              if(++count>700||depth>24)return el('p','表示を省略しました。','quiet');
              if(value===null||typeof value!=='object')return el('p',(key?key+'  ':'')+JSON.stringify(value),'lab-mono');
              const entries=Object.entries(value),d=el('details');d.open=root;d.append(el('summary',(key?key+'  ':'')+(Array.isArray(value)?'配列':'オブジェクト')+' · '+entries.length));
              const children=el('div');d.append(children);
              let drawn=false;function draw(){if(drawn||!d.open)return;drawn=true;for(const [k,v] of entries.slice(0,120))children.append(treeFor(k,v,false,depth+1));if(entries.length>120)children.append(el('p','最初の120項目を表示','quiet'));}
              d.addEventListener('toggle',draw);draw();return d;
            }
            function render(){
              count=0;tree.replaceChildren();
              const q=f.value.toLowerCase();
              if(!q){tree.append(treeFor('',data,true));return;}
              const found=[];let visited=0;
              function walk(value,paths=[]){if(found.length>=120||paths.length>24||++visited>40000)return;if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value)){if(found.length>=120||visited>40000)break;walk(v,[...paths,k]);}}else{const p=paths.join('.'),v=JSON.stringify(value);if(p.toLowerCase().includes(q)||v.toLowerCase().includes(q))found.push(el('p',p+'  '+v,'lab-mono'));}}
              walk(data);tree.append(...(found.length?found:[el('p','一致する値はありません。','quiet')]));
            }
            f.oninput=render;pane.append(f,tree);render();
          }else pane.append(pre(text));
        }else pane.append(pre(text));
      }else pane.append(el('p','この形式はブラウザで表示できません。「元ファイル」を使ってください。','quiet'));
    }catch(e){if(same()){details.textContent='読み込みエラー';const error=el('p',String(e?.message??e),'lab-error');error.setAttribute('role','status');pane.replaceChildren(error);}}
  }
  return {open,close,current:()=>path,isCurrent:()=>path&&archiveToken===ctx.token()};
}
