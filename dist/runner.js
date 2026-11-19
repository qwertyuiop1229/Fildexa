function zipstageRoutes(p,files,rewrites) {
  const direct=p ? [p,p.endsWith('/')?p+'index.html':p+'/index.html',p+'.html',p+'.htm'] : ['index.html','index.htm'];
  for(const c of direct)if(/\.html?$/i.test(c)&&files.has(c))return c;
  const match=(pattern,path)=>{
    if(pattern==='**'||pattern==='/**')return true;
    const a=pattern.replace(/^\//,'').split('/'),b=path.split('/');
    if(a.length>40||b.length>40)return false;
    const memo=new Map();
    function walk(i,j){
      const key=i+':'+j;if(memo.has(key))return memo.get(key);
      let yes;
      if(i===a.length)yes=j===b.length;
      else if(a[i]==='**')yes=walk(i+1,j)||(j<b.length&&walk(i,j+1));
      else yes=j<b.length&&(a[i]==='*'||a[i]===b[j])&&walk(i+1,j+1);
      memo.set(key,yes);return yes;
    }
    return walk(0,0);
  };
  for(const {source,destination} of rewrites??[]){
    if(match(source,p)){
      const path=destination.replace(/^\//,'');
      if(/\.html?$/i.test(path)&&files.has(path))return path;
    }
  }
  return null;
}
function zipstageBootstrap(token, online, policy) {
  const send = (type, value) => parent.postMessage({zipstage:token,type,value}, '*');
  const shorten = (value,max=500) => String(value ?? '').slice(0,max);
  const origin = 'https://zipstage.invalid';
  const safeJSON = value => JSON.stringify(value).replace(/</g,'\\u003c');
  const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
  const virtual = p => origin+'/'+encodePath(p);
  const makeURL = (s,b) => { try{return new URL(s,b);}catch{return null;} };
  const localPath = u => {try{return u?.origin===origin?decodeURIComponent(u.pathname.slice(1)):null;}catch{return null;}};
  const trimHash = s => typeof s==='string'&&s.startsWith('#');
  const native = {attr:Element.prototype.setAttribute, fetch:window.fetch.bind(window)};
  window.addEventListener('message', async function init(e) {
    if(e.source!==parent || e.data?.zipstage!==token || e.data?.type!=='start')return;
    window.removeEventListener('message',init);
    try {await render(e.data.value);}
    catch(err) {send('fatal',shorten(err?.message||err));}
  });
  send('ready');
  async function render({items,page,rewrites,storage,hash,query,request,packages,cdn,transformed}) {
    const files=new Map(items), pageURL=virtual(page), transpiled=new Set(transformed??[]);
    const assets=new Map(), css=new Map(), modules=new Map(), moduleMap=Object.create(null), missing=new Set(), blobPaths=new Map();
    function makeBlob(blob,path){const url=URL.createObjectURL(blob);if(path)blobPaths.set(url,path);return url;}
    let docBase=pageURL;
    const reportMissing = p => {
      if(!p||missing.has(p)||missing.size>=60)return;
      missing.add(p);send('log',{level:'warn',message:'ZIPに見つかりません · '+shorten(p,260)});
    };
    const getResource = (p, sha='') => {
      if(!files.has(p))return null;
      if(!assets.has(p))assets.set(p,makeBlob(files.get(p),p));
      return assets.get(p)+sha;
    };
    function resolve(s,b=docBase){return makeURL(s,b);}
    function normalizedResource(raw,base=docBase,shouldLog=true) {
      if(!raw||trimHash(raw))return raw;
      const u=resolve(raw,base), p=localPath(u);
      if(p===null)return u&&/^https?:$/.test(u.protocol)?u.href:raw;
      const resource=getResource(p,u.hash);
      if(!resource&&shouldLog)reportMissing(p);
      return resource??'data:,';
    }
    async function cssText(content,base,trail) {
      // Process imports before url() so that nested CSS retains its own directory.
      const imports=[];
      content=content.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|"([^"]*)"|'([^']*)')/gi,(all,...parts)=>{
        const raw=parts.slice(0,5).find(x=>x!==undefined);
        const id=imports.push(raw)-1;
        return '@import ZIPSTAGE_CSS_IMPORT_'+id+'_TOKEN';
      });
      content=content.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi,(_m,a,b,c)=>'url('+JSON.stringify(normalizedResource(a??b??c,base))+')');
      for(let i=0;i<imports.length;i++){
        const raw=imports[i], u=resolve(raw,base), p=localPath(u);
        const url=p===null?u?.href??raw:await cssFile(p,trail);
        content=content.replace('ZIPSTAGE_CSS_IMPORT_'+i+'_TOKEN','url('+JSON.stringify(url)+')');
      }
      return content;
    }
    async function cssFile(path,trail=new Set()) {
      if(trail.has(path))return 'data:text/css,';
      if(css.has(path))return css.get(path);
      if(!files.has(path)){reportMissing(path);return 'data:text/css,';}
      const next=new Set(trail).add(path);
      const txt=await cssText(await files.get(path).text(),virtual(path),next);
      const url=makeBlob(new Blob([txt],{type:'text/css'}),path);
      css.set(path,url);return url;
    }
    const modulePath = p => {
      for(const x of [p,p+'.js',p+'.mjs',p+'.ts',p+'.tsx',p+'.jsx',p+'.mts',p+'/index.js',p+'/index.ts',p+'/index.tsx',p+'/index.jsx'])if(files.has(x))return x;
      return null;
    };
    const isCode = p => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(p);
    const bare = /^(?:@[a-z\d][a-z\d_.-]*\/)?[a-z\d][a-z\d_.-]*(?:\/[a-z\d_.-]+)*$/i;
    const env = {MODE:'development',DEV:true,PROD:false,SSR:false,BASE_URL:'/'};
    const looksResolved = s => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(s);
    function specifier(s,b) {
      if(typeof s!=='string')return s;
      if(s.startsWith('@/')||s.startsWith('~/')){
        const aliased='src/'+s.slice(2);
        if(modulePath(aliased))return virtual(modulePath(aliased));
      }
      if(!looksResolved(s)){
        if(cdn&&bare.test(s)){
          const bits=s.split('/'), count=s.startsWith('@')?2:1, pkg=bits.slice(0,count).join('/'), rest=bits.slice(count).join('/');
          const pin=Object.prototype.hasOwnProperty.call(packages??{},pkg)?String(packages[pkg]).replace(/^[~^]/,''):'';
          if(Object.prototype.hasOwnProperty.call(packages??{},pkg)){
            const target='https://esm.sh/'+pkg+(/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(pin)?'@'+pin:'')+(rest?'/'+rest:'');
            moduleMap[s]=target;
            return target;
          }
        }
        return s;
      }
      const u=resolve(s,b), p=localPath(u);
      if(p===null)return u?.href??s;
      if(!modulePath(p))reportMissing(p);
      return virtual(modulePath(p)??p);
    }
    function rewriteJS(code,base) {
      let imports;
      try{[imports]=parse(code,base);}catch{return code;}
      const changes=[];
      for(const it of imports){
        if(it.t===3){
          const m=/^\s*\.\s*(url|env)\b/.exec(code.slice(it.e));
          if(m)changes.push([it.s,it.e+m[0].length,m[1]==='url'?safeJSON(base):'('+safeJSON(env)+')']);
        }else if(it.n!==undefined){
          let next=specifier(it.n,base);
          if(it.a<0&&next.startsWith(origin+'/')&&/\.json$/i.test(next)&&!it.n.startsWith('http'))next+='?import-json';
          if(next===it.n)continue;
          changes.push([it.s,it.e,it.d>=0?safeJSON(next):safeJSON(next).slice(1,-1).replace(/'/g,'\\x27')]);
        }else if(it.t===2){
          // Wrap the expression, leaving optional import attributes in place.
          const end=it.a>=0?code.lastIndexOf(',',it.a):it.se-1;
          if(end>=it.s && code[it.se-1]===')'){
            changes.push([end,end,','+safeJSON(base)+')']);
            changes.push([it.s,it.s,'globalThis.__zipstageSpecifier(']);
          }
        }
      }
      for(const [s,e,text] of changes.sort((a,b)=>b[0]-a[0]))code=code.slice(0,s)+text+code.slice(e);
      return code;
    }
    async function makeModule(path) {
      if(modules.has(path))return modules.get(path);
      if(!files.has(path)){reportMissing(path);return 'data:text/javascript,';}
      let url;
      if(/\.css$/i.test(path)){
        const href=await cssFile(path);
        const styles=Object.create(null);
        if(path.endsWith('.module.css')){
          const text=await files.get(path).text();
          for(const rule of text.matchAll(/([^{}]+)\{/g))for(const match of rule[1].matchAll(/\.([a-z_][\w-]*)/gi))styles[match[1]]=match[1];
        }
        url=makeBlob(new Blob(['const x=document.createElement("link");x.rel="stylesheet";x.href='+safeJSON(href)+';document.head.append(x);export default '+safeJSON(styles)+';'],{type:'text/javascript'}),path);
      }else if(/\.json$/i.test(path)){
        // A direct Vite JSON import and native JSON import attributes each get their expected MIME.
        url=getResource(path);
        let payload;
        try{payload='export default JSON.parse('+safeJSON(await files.get(path).text())+');';}
        catch{payload='throw Error("JSON を読み込めませんでした");';}
        moduleMap[virtual(path)+'?import-json']=makeBlob(new Blob([payload],{type:'text/javascript'}),path);
      }else if(!isCode(path)){
        const href=getResource(path);
        url=makeBlob(new Blob(['export default '+safeJSON(href)+';'],{type:'text/javascript'}),path);
      }else if(/\.(?:[cm]?ts|[jt]sx)$/i.test(path)&&!transpiled.has(path)){
        reportMissing(path+'（変換できませんでした）');url='data:text/javascript,';
      }else{
        const src=rewriteJS(await files.get(path).text(),virtual(path));
        url=makeBlob(new Blob([src],{type:'text/javascript'}),path);
      }
      modules.set(path,url);moduleMap[virtual(path)]=url;
      return url;
    }
    const source = await files.get(page).text();
    const parsed = new DOMParser().parseFromString(source,'text/html');
    const originalBase=parsed.querySelector('base[href]')?.getAttribute('href');
    if(originalBase){
      const candidate=resolve(originalBase,pageURL);
      if(candidate?.origin===origin)docBase=candidate.href;
    }
    parsed.querySelectorAll('base, meta[http-equiv], iframe, frame, object, embed').forEach(el=>{
      if(el.tagName!=='META' || ['content-security-policy','refresh'].includes(el.httpEquiv.toLowerCase()))el.remove();
    });
    if(parsed.body?.tagName==='FRAMESET')throw new Error('フレームセットには対応していません。');
    const defaultDoctype=parsed.doctype?.name.toLowerCase()==='html'?'<!doctype html>':'';
    const startingMap = Object.create(null), mappedTargets = new Map(), preblocked = new Map();
    for(const el of parsed.querySelectorAll('script[type="importmap"]')){
      try{
        const map=JSON.parse(el.textContent);
        for(const [name,url] of Object.entries(map.imports??{}))if(typeof url==='string'){
          const u=resolve(url,docBase);
          const n=looksResolved(name)?specifier(name,docBase):name;
          const p=modulePath(localPath(u)??'');
          if(u)mappedTargets.set(n,u);
          startingMap[n]=u?.origin===origin&&p?await makeModule(p):u?.href??url;
        }
      }catch{}
      el.remove();
    }
    const hasModules=parsed.querySelector('script[type="module"]') || [...parsed.querySelectorAll('script:not([src])')].some(e=>/\bimport\s*\(/.test(e.textContent));
    if(hasModules){
      for(const p of files.keys())if(isCode(p)||/\.(?:css|json|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|ico|mp3|wav)$/i.test(p))await makeModule(p);
    }
    const moduleLists=new Map();
    const isOffsiteScript=u=>u&&localPath(u)===null&&/^https?:$/.test(u.protocol);
    function staticImports(code,base){
      try{return parse(code,base)[0].filter(item=>item.d===-1&&typeof item.n==='string').map(item=>item.n);}
      catch{return [];}
    }
    async function offlineDependencies(deps,base){
      const blocked=new Set(), checked=new Set(), queue=deps.map(name=>[name,base]);
      for(let i=0;i<queue.length&&i<1600&&blocked.size<40;i++){
        const [name,from]=queue[i];
        let url=mappedTargets.get(name);
        if(!url&&(name.startsWith('@/')||name.startsWith('~/'))){
          const alias=modulePath('src/'+name.slice(2));
          if(alias)url=resolve(virtual(alias));
        }
        if(!url&&looksResolved(name))url=resolve(name,from);
        if(!url)continue;
        if(isOffsiteScript(url)){blocked.add(url.href);continue;}
        const p=modulePath(localPath(url)??'');
        if(!p||!isCode(p)||checked.has(p))continue;
        checked.add(p);
        if(!moduleLists.has(p))moduleLists.set(p,staticImports(await files.get(p).text(),virtual(p)));
        for(const item of moduleLists.get(p))queue.push([item,virtual(p)]);
      }
      return [...blocked];
    }
    function blockScript(el,urls){
      // Keep the real offline CSP in place. Avoid scheduling a request known to be denied.
      for(const url of urls)if(preblocked.size<90)preblocked.set(url,'script-src-elem');
      el.removeAttribute('src');el.removeAttribute('integrity');
      el.type='application/x-zipstage-offline';el.textContent='';
      el.setAttribute('data-zipstage-offline','true');
    }
    for(const el of parsed.querySelectorAll('[src],[href],[poster],[srcset],[data-src], style,[style]')){
      if(el.closest('template'))continue;
      const tag=el.localName;
      const get=a=>el.getAttribute(a), put=(a,v)=>el.setAttribute(a,v);
      if(tag==='link'&&get('href')){
        const rel=(get('rel')??'').toLowerCase();
        if(/^(?:preconnect|dns-prefetch|prefetch|prerender|modulepreload)$/.test(rel)){el.remove();continue;}
        const u=resolve(get('href')),p=localPath(u);
        if(p!==null){put('href',rel==='stylesheet'?await cssFile(p):normalizedResource(get('href')));el.removeAttribute('integrity');}
        else if(u&&/^https?:$/.test(u.protocol))put('href',u.href);
      }
      if(tag==='script'&&get('src')){
        const raw=get('src'), u=resolve(raw), p=localPath(u), isModule=el.type.toLowerCase()==='module';
        if(!online){
          if(isOffsiteScript(u)){blockScript(el,[u.href]);continue;}
          if(p!==null&&(isModule||transpiled.has(p))){
            const blocked=await offlineDependencies([virtual(p)],docBase);
            if(blocked.length){blockScript(el,blocked);continue;}
          }
        }
        if(p!==null){
          const local=modulePath(p)??p;
          if(isModule||transpiled.has(local)){
            if(transpiled.has(local))el.type='module';
            put('src',await makeModule(local));
          }
          else if(hasModules && isCode(local) && files.has(local))put('src',await makeModule(local));
          else put('src',normalizedResource(raw));
          el.removeAttribute('integrity');
        }else if(u&&/^https?:$/.test(u.protocol))put('src',u.href);
      }else if(get('src'))put('src',normalizedResource(get('src')));
      if(tag==='image'||tag==='use')for(const a of ['href','xlink:href'])if(get(a))put(a,normalizedResource(get(a)));
      for(const attr of ['poster'])if(get(attr))put(attr,normalizedResource(get(attr)));
      if(get('srcset')&&!get('srcset').trim().startsWith('data:'))put('srcset',get('srcset').split(',').map(s=>s.trim().replace(/^\S+/,x=>normalizedResource(x))).join(', '));
      if(get('style'))put('style',await cssText(get('style'),docBase,new Set()));
      if(tag==='style')el.textContent=(await cssText(el.textContent,docBase,new Set())).replace(/<\/style/gi,'<\\/style');
    }
    for(const el of parsed.querySelectorAll('script:not([src])')){
      if(el.closest('template'))continue;
      const type=el.type.toLowerCase();
      if(!online&&type==='module'){
        const blocked=await offlineDependencies(staticImports(el.textContent,docBase),docBase);
        if(blocked.length){blockScript(el,blocked);continue;}
      }
      if(!type || ['module','text/javascript','application/javascript'].includes(type))el.textContent=rewriteJS(el.textContent,docBase).replace(/<\/script/gi,'<\\/script');
    }
    for(const el of parsed.querySelectorAll('a[ping],area[ping]'))el.removeAttribute('ping');
    const attributeCopy = node => [...node.attributes].map(a=>' '+a.name+'="'+a.value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')+'"').join('');
    const csp = document.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content=policy;
    const utf = document.createElement('meta');utf.setAttribute('charset','UTF-8');
    const importMap = document.createElement('script');
    importMap.type='importmap';importMap.textContent=safeJSON({imports:{...moduleMap,...startingMap}});
    const standIn = document.createElement('script');standIn.textContent='globalThis.__zipstageInstall();';
    globalThis.__zipstageInstall = install;
    document.open();
    document.write(defaultDoctype+'<html'+attributeCopy(parsed.documentElement)+'><head'+attributeCopy(parsed.head)+'>'+utf.outerHTML+csp.outerHTML+importMap.outerHTML+standIn.outerHTML+parsed.head.innerHTML+'</head>'+parsed.body.outerHTML+'</html>');
    document.close();

    function install() {
      delete globalThis.__zipstageInstall;
      globalThis.__zipstageSpecifier=specifier;
      const navigate=(raw)=>{
        const u=resolve(raw),p=localPath(u);
        if(p===null){send('log',{level:'warn',message:'外部ページへの移動はプレビュー内では行いません。'});return;}
        const next=zipstageRoutes(p,files,rewrites);
        if(next)send('navigate',{page:next,hash:u.hash??'',query:u.search??'',request:p});
        else reportMissing(p);
      };
      document.addEventListener('click',e=>{
        const link=e.target?.closest?.('a[href],area[href]');
        if(!link||e.defaultPrevented)return;
        if(e.button!==0)return;
        const raw=link.getAttribute('href');
        if(trimHash(raw))return;
        if(!raw||/^javascript:/i.test(raw))return;
        e.preventDefault();navigate(raw);
      });
      addEventListener('DOMContentLoaded',()=>{
        for(const el of document.querySelectorAll('script[data-zipstage-offline="true"]'))el.dispatchEvent(new Event('error'));
        if(hash){try{history.replaceState(null,'',hash);}catch{}let id=hash.slice(1);try{id=decodeURIComponent(id);}catch{}document.getElementById(id)?.scrollIntoView();}
        send('rendered',{title:shorten(document.title,100),viewport:[innerWidth,innerHeight]});
      },{once:true});
      const onError=(e)=>{
        if(e instanceof ErrorEvent)send('log',{level:'error',message:shorten(e.message||'JavaScriptエラー')});
        else if(e.target?.getAttribute){const target=e.target.getAttribute('src')||e.target.getAttribute('href');if(target&&!target.startsWith('data:'))send('log',{level:'warn',message:'読み込み失敗 · '+(target.startsWith('blob:')?'ZIP内の'+e.target.localName:shorten(target,230))});}
      };
      addEventListener('error',onError,true);
      addEventListener('unhandledrejection',e=>send('log',{level:'error',message:shorten(e.reason?.message??e.reason??'未処理のエラー')}));
      const storageFor=(type)=>{
        const map=new Map(Object.entries(storage?.[type]??{}));
        const save=()=>send('storage',{type,entries:[...map]});
        const target={get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(String(k))??null,
          setItem(k,v){k=String(k);v=String(v);if(k.length<=1024&&v.length<=65536&&(map.has(k)||map.size<100)){map.set(k,v);save();}},
          removeItem(k){map.delete(String(k));save();},clear(){map.clear();save();}};
        return new Proxy(target,{get:(a,k)=>Reflect.has(a,k)?Reflect.get(a,k):map.get(k),set:(a,k,v)=>{a.setItem(k,v);return true;},deleteProperty:(a,k)=>{a.removeItem(k);return true;}});
      };
      for(const kind of ['localStorage','sessionStorage']){
        try{Object.defineProperty(window,kind,{configurable:true,value:storageFor(kind)});}catch{}
      }
      const NativeRequest=window.Request;
      if(NativeRequest)window.Request=new Proxy(NativeRequest,{construct(Target,[input,...rest],newTarget){
        // Native Request normally resolves against about:srcdoc's host URL.
        if(typeof input==='string'&&!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(input)){
          const candidate=resolve(input);
          if(localPath(candidate)!==null)input=candidate.href;
        }
        return Reflect.construct(Target,[input,...rest],newTarget);
      }});
      window.fetch=function(input,options){
        let raw;
        try{raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url;}catch{}
        const u=raw&&resolve(raw),p=localPath(u);
        if(p===null||!u)return native.fetch(input,options);
        const method=String(options?.method??input?.method??'GET').toUpperCase();
        if(!['GET','HEAD'].includes(method))return Promise.resolve(new Response(null,{status:405}));
        if(!files.has(p)){reportMissing(p);return Promise.resolve(new Response(null,{status:404}));}
        return Promise.resolve(new Response(method==='HEAD'?null:files.get(p),{headers:{'Content-Type':files.get(p).type}}));
      };
      const nativeOpen=XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open=function(method,url,...args){
        const u=resolve(String(url)),p=localPath(u);
        if(p!==null){const local=getResource(p);if(!local)reportMissing(p);url=local??'data:,';}
        return nativeOpen.call(this,method,url,...args);
      };
      function runtimeValue(el,attr,value){
        if(value==null || value==='')return value;
        const tag=el.localName, raw=String(value);
        if(attr==='src' && ['img','audio','video','source','track','input','script'].includes(tag) || attr==='poster' && tag==='video'){
          if(tag==='script'&&el.type?.toLowerCase()==='module'){
            const m=modulePath(localPath(resolve(raw))??'');
            if(m&&modules.has(m))return modules.get(m);
          }
          return normalizedResource(raw);
        }
        if(attr==='href'&&['link','image','use'].includes(tag)){
          const p=localPath(resolve(raw));return p!==null&&css.has(p)?css.get(p):normalizedResource(raw);
        }
        return value;
      }
      Element.prototype.setAttribute=function(name,value){return native.attr.call(this,name,runtimeValue(this,String(name).toLowerCase(),value));};
      for(const [ctor,attrs] of [[HTMLImageElement,['src']],[HTMLMediaElement,['src']],[HTMLSourceElement,['src']],[HTMLTrackElement,['src']],[HTMLInputElement,['src']],[HTMLScriptElement,['src']],[HTMLLinkElement,['href']],[HTMLVideoElement,['poster']]]){
        for(const attr of attrs){
          const d=Object.getOwnPropertyDescriptor(ctor.prototype,attr);
          if(d?.set&&d.configurable)Object.defineProperty(ctor.prototype,attr,{...d,set(value){d.set.call(this,runtimeValue(this,attr,value));}});
        }
      }
      if(typeof zipstageDev==='function')zipstageDev(send,token,{resolve,localPath,blobPaths,online,preblocked,route:'/'+(request||page)+(query||'')+(hash||'')});
      const NativeAudio=window.Audio;
      if(NativeAudio) window.Audio=new Proxy(NativeAudio,{construct(Target,args){
        const audio=new Target();if(args.length)audio.src=args[0];return audio;
      }});
      const NativeWorker=window.Worker;
      if(NativeWorker)window.Worker=class extends NativeWorker{
        constructor(url,opts){
          const raw=String(url),p=localPath(resolve(raw));
          super(p===null?url:getResource(p)??url,opts);
        }
      };
    }
  }
}
