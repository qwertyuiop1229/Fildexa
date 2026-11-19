function zipstageBootstrap(token, online) {
  const send = (type, value) => parent.postMessage({zipstage:token,type,value}, '*');
  const shorten = (value,max=500) => String(value ?? '').slice(0,max);
  const origin = 'https://zipstage.invalid';
  const remote = online ? ' https:' : '';
  const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:" + remote +
    "; style-src 'unsafe-inline' blob: data:" + remote + "; img-src blob: data:" + remote +
    "; font-src blob: data:" + remote + "; media-src blob: data:" + remote +
    "; connect-src blob: data:" + (online?' https: wss:':'') +
    "; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src blob: data:; block-all-mixed-content";
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
  async function render({items,page,rewrites,storage,hash}) {
    const files=new Map(items), pageURL=virtual(page);
    const assets=new Map(), css=new Map(), modules=new Map(), moduleMap=Object.create(null), missing=new Set();
    let docBase=pageURL;
    const reportMissing = p => {
      if(!p||missing.has(p)||missing.size>=60)return;
      missing.add(p);send('log',{level:'warn',message:'ZIPに見つかりません · '+shorten(p,260)});
    };
    const getResource = (p, sha='') => {
      if(!files.has(p))return null;
      if(!assets.has(p))assets.set(p,URL.createObjectURL(files.get(p)));
      return assets.get(p)+sha;
    };
    const optionsFor = input => [input,input.endsWith('/')?input+'index.html':input+'/index.html',input+'.html'];
    function lookupPage(p) {
      for(const c of optionsFor(p))if(/\.html?$/i.test(c)&&files.has(c))return c;
      for(const {source,destination} of rewrites??[]) {
        if(source==='**'||source==='/**'||source==='/'+p) {
          const d=localPath(makeURL(destination,origin));
          if(d&&/\.html?$/i.test(d)&&files.has(d))return d;
        }
      }
      return null;
    }
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
      const url=URL.createObjectURL(new Blob([txt],{type:'text/css'}));
      css.set(path,url);return url;
    }
    const modulePath = p => {
      for(const x of [p,p+'.js',p+'.mjs',p+'/index.js'])if(files.has(x))return x;
      return null;
    };
    const looksResolved = s => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(s);
    function specifier(s,b) {
      if(!looksResolved(s))return s;
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
          const m=/^\s*\.\s*url\b/.exec(code.slice(it.e));
          if(m)changes.push([it.s,it.e+m[0].length,safeJSON(base)]);
        }else if(it.n!==undefined){
          const next=specifier(it.n,base);
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
      if(!/\.[cm]?js$/i.test(path)){url=getResource(path);}
      else{const src=rewriteJS(await files.get(path).text(),virtual(path));url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));}
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
    const startingMap = Object.create(null);
    for(const el of parsed.querySelectorAll('script[type="importmap"]')){
      try{
        const map=JSON.parse(el.textContent);
        for(const [name,url] of Object.entries(map.imports??{}))if(typeof url==='string'){
          const u=resolve(url,docBase);
          const n=looksResolved(name)?specifier(name,docBase):name;
          const p=modulePath(localPath(u)??'');
          startingMap[n]=u?.origin===origin&&p?await makeModule(p):u?.href??url;
        }
      }catch{}
      el.remove();
    }
    const hasModules=parsed.querySelector('script[type="module"]') || [...parsed.querySelectorAll('script:not([src])')].some(e=>/\bimport\s*\(/.test(e.textContent));
    if(hasModules){
      for(const p of files.keys())if(/\.[cm]?js$/i.test(p))await makeModule(p);
      for(const p of files.keys())if(/\.css$/i.test(p))await cssFile(p);
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
        if(p!==null){
          if(/\.(?:tsx?|jsx)$/i.test(p)){el.remove();send('log',{level:'error',message:'ビルド前のソースです。公開用のフォルダ（distなど）をZIPにしてください。'});continue;}
          const local=modulePath(p)??p;
          if(isModule)put('src',await makeModule(local));
          else if(hasModules && /\.[cm]?js$/i.test(local) && files.has(local))put('src',await makeModule(local));
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
      if(!el.type || ['module','text/javascript','application/javascript'].includes(el.type.toLowerCase()))el.textContent=rewriteJS(el.textContent,docBase).replace(/<\/script/gi,'<\\/script');
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
        const next=lookupPage(p);
        if(next)send('navigate',{page:next,hash:u.hash??''});
        else reportMissing(p);
      };
      document.addEventListener('click',e=>{
        const link=e.target?.closest?.('a[href],area[href]');
        if(!link||e.defaultPrevented)return;
        const raw=link.getAttribute('href');
        if(trimHash(raw))return;
        if(!raw||/^javascript:/i.test(raw))return;
        e.preventDefault();navigate(raw);
      });
      addEventListener('DOMContentLoaded',()=>{
        if(hash){try{history.replaceState(null,'',hash);}catch{}let id=hash.slice(1);try{id=decodeURIComponent(id);}catch{}document.getElementById(id)?.scrollIntoView();}
        send('rendered',shorten(document.title,100));
      },{once:true});
      const onError=(e)=>{
        if(e instanceof ErrorEvent)send('log',{level:'error',message:shorten(e.message||'JavaScriptエラー')});
        else if(e.target?.getAttribute){const target=e.target.getAttribute('src')||e.target.getAttribute('href');if(target&&!target.startsWith('data:'))send('log',{level:'warn',message:'読み込み失敗 · '+(target.startsWith('blob:')?'ZIP内の'+e.target.localName:shorten(target,230))});}
      };
      addEventListener('error',onError,true);
      addEventListener('unhandledrejection',e=>send('log',{level:'error',message:shorten(e.reason?.message??e.reason??'未処理のエラー')}));
      document.addEventListener('securitypolicyviolation',e=>{
        if(['connect-src','script-src-elem','style-src-elem','img-src','media-src','font-src'].includes(e.effectiveDirective)&&/^https?:/.test(e.blockedURI)&&!online)send('log',{level:'info',message:'外部通信をブロック · '+shorten(e.blockedURI,230)});
      });
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
