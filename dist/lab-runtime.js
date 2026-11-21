function zipstageLabRuntime(send,{resolve,localPath,lab,routeFor}){
  const opt=lab??{},delay=Math.min(3000,Math.max(0,Number(opt.delay)||0));
  const rules=Array.isArray(opt.rules)?opt.rules.slice(0,24):[];
  const routes=rules.flatMap(r=>{
    if(typeof r.path!=='string'||r.path.length>300||!/^\/(?!\/)/.test(r.path)||!/^([A-Z]{3,7})$/.test(r.method))return [];
    const pattern='^'+r.path.split(/(\{[^/{}]+\})/).map((part,i)=>i%2?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$';
    return [[new RegExp(pattern),r]];
  });
  const hit=(input,method)=>{
    if(typeof input!=='string'||input.length>4000)return null;
    try{
      const u=resolve(input),p=localPath(u);
      if(p===null)return null;
      return routes.find(([re,r])=>r.method===method&&re.test('/'+p))?.[1]??null;
    }catch{return null;}
  };
  if(opt.offline){try{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});}catch{}}
  if(opt.epoch!==null&&opt.epoch!==''&&Number.isFinite(opt.epoch)){
    const D=window.Date,t0=D.now(),now=()=>opt.epoch+(D.now()-t0);
    window.Date=new Proxy(D,{apply:()=>new D(now()).toString(),construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[now()],newTarget),get:(target,prop,receiver)=>prop==='now'?now:Reflect.get(target,prop,receiver)});
  }
  if(opt.timeZone||opt.locale){
    function proxy(ctor,date){
      if(!ctor)return ctor;
      const amend=args=>[args[0]??opt.locale,date?{...args[1],...(opt.timeZone&&!args[1]?.timeZone?{timeZone:opt.timeZone}:{})}:args[1]];
      return new Proxy(ctor,{apply:(target,self,args)=>Reflect.apply(target,self,amend(args)),construct:(target,args,newTarget)=>Reflect.construct(target,amend(args),newTarget)});
    }
    for(const name of ['DateTimeFormat','NumberFormat','RelativeTimeFormat','ListFormat','Collator','PluralRules']){
      try{Intl[name]=proxy(Intl[name],name==='DateTimeFormat');}catch{}
    }
  }
  if(opt.timeZone||opt.locale){
    for(const name of ['toLocaleString','toLocaleDateString','toLocaleTimeString']){
      const original=Date.prototype[name];
      try{Object.defineProperty(Date.prototype,name,{configurable:true,writable:true,value:function(locale,options){
        return original.call(this,locale??opt.locale,{...options,...(opt.timeZone&&!options?.timeZone?{timeZone:opt.timeZone}:{})});
      }});}catch{}
    }
  }
  if(delay||rules.length||opt.offline){
    const fetch=window.fetch;
    window.fetch=async function(input,opts){
      const method=String(opts?.method??input?.method??'GET').toUpperCase(),raw=input?.url??(input instanceof URL?input.href:input);
      const rule=hit(raw,method),signal=opts?.signal??input?.signal;
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(delay)await new Promise((ok,fail)=>{
        const cancel=()=>{clearTimeout(wait);fail(new DOMException('Aborted','AbortError'));};
        const wait=setTimeout(()=>{signal?.removeEventListener('abort',cancel);ok();},delay);
        signal?.addEventListener('abort',cancel,{once:true});
      });
      if(rule){
        const status=Number(rule.status);
        if(!Number.isInteger(status)||status<200||status>599)throw new TypeError('Fildexa mock status');
        return new Response(method==='HEAD'||[204,205,304].includes(status)?null:String(rule.body).slice(0,30000),{status,headers:{'Content-Type':'application/json','X-ZipStage-Mock':'1'}});
      }
      if(opt.offline){
        const p=typeof raw==='string'?localPath(resolve(raw)):null;
        if(p===null&&!/^(?:blob:|data:)/i.test(raw??''))throw new TypeError('Fildexa オフライン');
      }
      return fetch.call(this,input,opts);
    };
  }
  return {check(selector){
    try{
      const item=document.querySelector(selector),rect=item?.getBoundingClientRect(),style=item&&getComputedStyle(item);
      return !!(rect?.width&&rect?.height&&style?.visibility==='visible'&&style?.opacity!=='0');
    }catch{return null;}
  },audit(){
    const nodes=Array.from(document.querySelectorAll('a,button,input:not([type=hidden]),select,textarea,[role=button],img')).slice(0,600);
    const result={overflow:document.documentElement.scrollWidth>innerWidth+2,small:0,notab:0,alt:0,brokenImages:0,hash:0,missingLabel:0,lowContrast:0,localLinks:0,missingLang:!document.documentElement.lang,missingTitle:!document.title};
    function rgb(value){const bits=value.match(/[\d.]+/g)?.map(Number);return bits?.length===3||bits?.length===4&&bits[3]===1?bits.slice(0,3):null;}
    function luminance(values){return values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
    for(const n of nodes){
      if(n.localName==='img'){if(!n.hasAttribute('alt'))result.alt++;if(n.complete&&n.currentSrc&&n.naturalWidth===0)result.brokenImages++;continue;}
      if(n.matches('a[href^="#"]')&&n.hash.length>1){try{if(!document.getElementById(decodeURIComponent(n.hash.slice(1))))result.hash++;}catch{}}
      if(n.matches('a[href]:not([href^="#"])')&&!n.hasAttribute('download')){try{const u=resolve(n.getAttribute('href')),p=localPath(u);if(p!==null&&!routeFor(p))result.localLinks++;}catch{}}
      if(n.disabled)continue;
      const rect=n.getBoundingClientRect(),style=getComputedStyle(n);
      if(rect.width&&rect.height&&style.visibility==='visible'){
        if(Math.min(rect.width,rect.height)<24)result.small++;
        if(n.tabIndex<0&&n.getAttribute('role')==='button')result.notab++;
        if(!n.textContent.trim()&&!n.labels?.length&&!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&!n.title&&!n.matches('input[type=submit],input[type=button]')&&!n.querySelector('img[alt]'))result.missingLabel++;
        const foreground=rgb(style.color),background=rgb(style.backgroundColor);
        if(foreground&&background&&n.textContent.trim()){
          const a=luminance(foreground),b=luminance(background),large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700);
          if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)<(large?3:4.5))result.lowContrast++;
        }
      }
    }
    return result;
  },performance(callback){
    let first,last,n=0,slow=0,max=0;
    function frame(t){
      if(first===undefined)first=t;
      if(last!==undefined){const ms=t-last;n++;max=Math.max(max,ms);if(ms>=34)slow++;}
      last=t;
      if(t-first<1100&&n<220)requestAnimationFrame(frame);
      else callback({fps:Math.round(n*1000/Math.max(1,t-first)),slow,max:Math.round(max)});
    }
    requestAnimationFrame(frame);
  }};
}
