function zipstageDev(send, token, {resolve, localPath, blobPaths, online, preblocked, route, testRuntime}) {
  let serial=0, active=0, picked=null, overlay=null, nextNode=0;
  const nodes=new Map(), ids=new WeakMap(), initialInline=new WeakMap();
  const n = value => Number.isFinite(value)?Math.max(0,Math.round(value)):null;
  const now=()=>performance.now();
  const short=(v,i=1500)=>String(v??'').slice(0,i);
  const sensitive=/^(?:token|access_token|id_token|auth|authorization|code|password|apikey|api_key|key|secret)$/i;
  function cleanURL(raw){
    try{
      const u=resolve(String(raw));if(!u)return short(raw,500);
      if(u.protocol==='blob:'||u.protocol==='data:')return blobPaths.has(u.href)?'/'+blobPaths.get(u.href):u.protocol+'（プレビュー内）';
      const local=localPath(u);
      if(local!==null)return '/'+local;
      u.username='';u.password='';u.hash='';
      for(const k of [...u.searchParams.keys()])if(sensitive.test(k))u.searchParams.set(k,'[redacted]');
      return short(u.href,1400);
    }catch{return short(raw,500);}
  }
  function network(type,url,details={}){
    if(++serial>4000)return;
    const item={id:details.id??serial,type,url:cleanURL(url),t:n(now()),...details};
    if(!item.url)return;
    send('network',item);
    if(item.phase==='blocked')send('lab-issue',{id:'csp'});
    else if(item.phase==='failed')send('lab-issue',{id:'request'});
    return item.id;
  }
  function representation(v){
    if(typeof v==='string')return short(v,3000);
    if(v instanceof Error)return short(v.stack||v.message,3000);
    if(v instanceof Element)return short(v.outerHTML,1500);
    if(typeof v==='function')return '[関数 '+(v.name||'anonymous')+']';
    if(v===undefined)return 'undefined';
    if(typeof v==='bigint')return String(v)+'n';
    if(typeof v==='symbol')return String(v);
    if(v===null||typeof v!=='object')return String(v);
    const seen=new WeakSet();
    try{
      const compact=(value,depth)=>{
        if(value===null||typeof value!=='object')return typeof value==='bigint'?String(value)+'n':typeof value==='function'?'[Function]':value;
        if(seen.has(value))return '[Circular]';
        if(depth>3)return Array.isArray(value)?'[Array]':'[Object]';
        seen.add(value);
        const out=Array.isArray(value)?[]:Object.create(null);
        for(const key of Object.keys(value).slice(0,30)){
          const d=Object.getOwnPropertyDescriptor(value,key);
          if(d)out[key]=('value' in d)?compact(d.value,depth+1):'[Getter/Setter]';
        }
        return out;
      };
      return short(JSON.stringify(compact(v,0),null,2),4500);
    }catch{return '[表示できない値]';}
  }
  for(const level of ['log','info','warn','error','debug','table','assert','clear']){
    const prev=console[level]?.bind(console);if(!prev)continue;
    console[level]=(...args)=>{
      const result=prev(...args);
      if(level==='assert'&&args.shift())return result;
      if(level==='clear')send('console-clear');
      else send('log',{level:level==='assert'?'error':level,message:args.map(representation).join(' ').slice(0,5000)});
      return result;
    };
  }
  const headers=source=>{
    const out=[];
    if(!source)return out;
    try{for(const [name,value] of new Headers(source)){
      if(!/^(?:authorization|proxy-authorization|set-cookie|cookie|x-.*(?:token|secret|key))$/i.test(name))out.push([short(name,70),short(value,360)]);
      if(out.length>=16)break;
    }}catch{}
    return out;
  };
  const baseFetch=window.fetch;
  window.fetch=async function(input,opts){
    let raw,method;
    try{raw=input?.url??(input instanceof URL?input.href:input);method=String(opts?.method??input?.method??'GET').slice(0,16).toUpperCase();}catch{}
    const t=now(),id=network('fetch',raw,{method,phase:'pending',sent:headers(opts?.headers??input?.headers)});
    try{
      const response=await baseFetch.call(this,input,opts);
      network('fetch',raw,{id,method,phase:response.ok||response.type==='opaque'?'complete':'failed',ms:n(now()-t),status:response.status||null,final:response.redirected?cleanURL(response.url):null,contentType:response.headers.get('content-type'),mock:response.headers.get('x-zipstage-mock')==='1',bytes:Number(response.headers.get('content-length'))||null,received:headers(response.headers)});
      return response;
    }catch(e){network('fetch',raw,{id,method,phase:'failed',ms:n(now()-t),error:short(e?.message,240)});throw e;}
  };
  const xhrOpen=XMLHttpRequest.prototype.open,xhrSend=XMLHttpRequest.prototype.send,xhrHeader=XMLHttpRequest.prototype.setRequestHeader,xhr=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...args){
    const result=xhrOpen.call(this,method,url,...args);xhr.set(this,{url,method:short(method,16).toUpperCase(),headers:[]});return result;
  };
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){
    const result=xhrHeader.call(this,name,value);
    const info=xhr.get(this);if(info?.headers.length<16)info.headers.push([name,value]);return result;
  };
  XMLHttpRequest.prototype.send=function(...args){
    const info=xhr.get(this);
    if(!info)return xhrSend.apply(this,args);
    const t=now(),id=network('XHR',info.url,{method:info.method,phase:'pending',sent:headers(info.headers)});
    const complete=()=>{
      let type=null,received=[];try{
        type=this.getResponseHeader('Content-Type');
        received=headers(this.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).map(line=>[line.split(':',1)[0],line.slice(line.indexOf(':')+1).trim()]));
      }catch{}
      network('XHR',info.url,{id,method:info.method,phase:(this.status>=200&&this.status<400)?'complete':'failed',status:this.status||null,ms:n(now()-t),contentType:type,received});
    };
    this.addEventListener('loadend',complete,{once:true});
    try{return xhrSend.apply(this,args);}catch(e){this.removeEventListener('loadend',complete);network('XHR',info.url,{id,method:info.method,phase:'failed',ms:n(now()-t),error:short(e?.message,240)});throw e;}
  };
  const nativeSocket=window.WebSocket;
  if(nativeSocket)window.WebSocket=new Proxy(nativeSocket,{construct(Target,[url,...args]){
    const t=now(),id=network('WebSocket',url,{phase:'pending'});let socket;
    try{socket=new Target(url,...args);}catch(e){network('WebSocket',url,{id,phase:'failed',error:short(e?.message,240)});throw e;}
    const nativeSend=socket.send.bind(socket);
    let tx=0,rx=0,last=0;
    const update=(phase,more={})=>network('WebSocket',url,{id,phase,ms:n(now()-t),upload:tx,download:rx,...more});
    const traffic=()=>{if(now()-last>250){last=now();update('complete');}};
    socket.send=(data)=>{const result=nativeSend(data);tx++;traffic();return result;};
    socket.addEventListener('message',()=>{rx++;traffic();});
    socket.addEventListener('open',()=>update('complete'));
    socket.addEventListener('error',()=>update('failed',{error:'WebSocket 接続エラー'}));
    socket.addEventListener('close',e=>update('closed',{status:e.code}));
    return socket;
  }});
  if(navigator.sendBeacon){
    const beacon=navigator.sendBeacon.bind(navigator);
    try{navigator.sendBeacon=(url,...args)=>{
      const ok=beacon(url,...args);network('Beacon',url,{phase:ok?'queued':'failed',method:'POST'});return ok;
    };}catch{}
  }
  const denied=new Set(), notedHosts=new Set();
  function blocked(raw,directive){
    const url=cleanURL(raw),key=directive+' '+url;
    if(!url||denied.has(key)||denied.size>=160)return;
    denied.add(key);
    network('CSP',raw,{phase:'blocked',error:short(directive,80)});
    if(!online){
      const u=resolve(raw);
      if(u&&/^https?:$|^wss?:$/.test(u.protocol)&&!notedHosts.has(u.host)){
        notedHosts.add(u.host);
        send('log',{level:'info',message:'外部通信オフ · '+u.host+' をブロックしました。URLは「通信」で確認できます。'});
      }
    }
  }
  for(const [url,directive] of preblocked??[])blocked(url,directive);
  document.addEventListener('securitypolicyviolation',e=>{
    if(e.blockedURI)blocked(e.blockedURI,e.effectiveDirective);
  });
  addEventListener('error',e=>{
    if(e.target?.getAttribute){const raw=e.target.getAttribute('src')??e.target.getAttribute('href');if(raw)network(e.target.localName,raw,{phase:'failed'});}
  },true);
  let count=0,transfer=0,requestMs=0;
  try{
    const entries=new PerformanceObserver(list=>{
      for(const e of list.getEntries()){
        count++;transfer+=e.transferSize||0;requestMs+=e.duration||0;
        if(!['fetch','xmlhttprequest','beacon'].includes(e.initiatorType))network(e.initiatorType||'resource',e.name,{phase:e.responseStatus>=400?'failed':'observed',status:e.responseStatus||null,ms:n(e.duration),bytes:e.transferSize||null,mime:short(e.contentType,100),protocol:short(e.nextHopProtocol,30)});
      }
    });
    entries.observe({type:'resource',buffered:true});
  }catch{}
  function previewMetrics(){
    const nav=performance.getEntriesByType('navigation')?.[0];
    send('metrics',{nodes:document.getElementsByTagName('*').length,viewport:[innerWidth,innerHeight],paint:performance.getEntriesByType('paint').map(x=>[x.name,n(x.startTime)]),since:n(now()),count,transfer,requestMs:n(requestMs),dcl:n(nav?.domContentLoadedEventEnd),route,online});
  }
  const getId=el=>{
    if(!ids.has(el)){if(nodes.size>1600)nodes.clear();ids.set(el,++nextNode);}
    const id=ids.get(el);nodes.set(id,el);return id;
  };
  const label=el=>{
    const id=el.getAttribute('id'),cl=el.getAttribute('class');
    return '<'+el.localName+(id?' #'+short(id,80):'')+(cl?' .'+short(cl.trim().split(/\s+/).slice(0,3).join('.'),100):'')+'>';
  };
  function elementScan(query){
    nodes.clear();
    const all=[...document.getElementsByTagName('*')].filter(el=>el!==overlay);
    const q=short(query,160).trim();let list=all,kind='DOM';
    if(q){
      let match=[];try{match=[...document.querySelectorAll(q)].filter(el=>el!==overlay);}catch{}
      if(match.length){list=match;kind='CSS セレクター';}
      else{kind='テキスト・属性';const lower=q.toLowerCase();list=all.filter(el=>label(el).toLowerCase().includes(lower)||short([...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.nodeValue).join(' '),500).toLowerCase().includes(lower));}
    }
    const rows=list.slice(0,420).map(el=>{
      let d=0,p=el;while((p=p.parentElement)&&d<10)d++;
      return {id:getId(el),label:label(el),depth:q?0:d};
    });
    send('elements',{rows,total:list.length,kind,query:q});
  }
  function clearOverlay(){overlay?.remove();overlay=null;clearTimeout(active);}
  function selectElement(id){
    const e=nodes.get(id);
    if(!e||!e.isConnected){send('element-info',{error:'要素が変更されました。要素一覧を更新してください。'});return;}
    const rect=e.getBoundingClientRect(),computed=getComputedStyle(e);
    const styles=['display','position','color','background-color','font-family','font-size','font-weight','line-height','visibility','overflow','margin','padding','width','height','box-sizing','z-index'].map(k=>[k,computed.getPropertyValue(k)]);
    send('element-info',{id,label:label(e),bounds:[n(rect.width),n(rect.height),Math.round(rect.x),Math.round(rect.y)],styles,html:short(e.outerHTML,13000),inline:short(e.getAttribute('style'),4000)});
    clearOverlay();
    if(rect.width&&rect.height&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight){
      overlay=document.createElement('div');overlay.setAttribute('aria-hidden','true');
      overlay.style.cssText='position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;z-index:2147483647;pointer-events:none;border:2px solid #0ab79d;background:#2adbbb36;box-sizing:border-box;';
      document.documentElement.append(overlay);active=setTimeout(clearOverlay,1600);
    }
  }
  function pick(e){
    if(!picked)return;
    e.preventDefault();e.stopImmediatePropagation();picked=null;document.documentElement.style.removeProperty('cursor');
    if(e.target instanceof Element)selectElement(getId(e.target));
  }
  document.addEventListener('click',pick,true);
  window.addEventListener('message',async e=>{
    if(e.source!==parent||e.data?.zipstage!==token||e.data.type!=='dev')return;
    const {action,value}=e.data.value??{};
    if(action==='elements')elementScan(value);
    else if(action==='select'&&Number.isInteger(value))selectElement(value);
    else if(action==='style'&&Number.isInteger(value?.id)){
      const element=nodes.get(value.id);
      if(!element?.isConnected)return;
      if(value.reset && initialInline.has(element)){
        const old=initialInline.get(element);
        if(old===null)element.removeAttribute('style');else element.setAttribute('style',old);
        initialInline.delete(element);
      }else if(typeof value.css==='string'&&value.css.length<=4000){
        if(!initialInline.has(element))initialInline.set(element,element.getAttribute('style'));
        element.setAttribute('style',value.css);
      }
      selectElement(value.id);
    }
    else if(action==='pick'){
      picked=value?true:null;
      if(picked)document.documentElement.style.setProperty('cursor','crosshair');
      else document.documentElement.style.removeProperty('cursor');
    }
    else if(action==='metrics')previewMetrics();
    else if(action==='lab-audit')send('lab-audit',testRuntime.audit());
    else if(action==='lab-check'&&typeof value?.selector==='string'&&value.selector.length<=240&&Number.isInteger(value.id))send('lab-check',{id:value.id,pass:testRuntime.check(value.selector)});
    else if(action==='lab-frames')testRuntime.performance(result=>send('lab-frames',result));
    else if(action==='lab-scroll')send('lab-scroll',Math.round(window.scrollY));
    else if(action==='command'&&typeof value==='string'&&value.length<=4000){
      try{const result=await (0,eval)(value);send('log',{level:'result',message:representation(result)});}
      catch(e){send('log',{level:'error',message:representation(e)});}
    }
  });
  addEventListener('load',previewMetrics,{once:true});
}
