import {mime} from './zip.mjs';
const count = (root, files) => files.filter(p=>p.startsWith(root)&&/\.html?$/i.test(p));
const configs = /^firebase\.json$/i;
export async function scan(archive) {
  const files=[...archive.files.keys()];
  const stripped = files.length && files.every(p=>p.includes('/') && p.split('/')[0]===files[0].split('/')[0]) ? files[0].split('/')[0]+'/' : '';
  const rootConfigs=files.filter(f=>configs.test(f.slice(stripped.length)) || (!stripped&&configs.test(f)));
  const results=new Map();
  const add=(root,kind,priority,rewrites=[])=>{
    const pages=count(root,files);
    if(!pages.length||results.has(root))return;
    const paths=pages.map(p=>p.slice(root.length));
    const home=paths.includes('index.html')?'index.html':paths.sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b))[0];
    results.set(root,{root,kind,home,pages:paths.sort((a,b)=>a===home?-1:b===home?1:a.localeCompare(b)),priority,rewrites});
  };
  for(const f of rootConfigs) {
    if(archive.files.get(f)?.length>2**20)continue;
    try{
      const c=JSON.parse((await (await archive.blob(f,'application/json')).text()).replace(/^\uFEFF/,''));
      for(const h of Array.isArray(c.hosting)?c.hosting:[c.hosting]){
        if(typeof h?.public!=='string')continue;
        const path=h.public.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/+$/,'');
        if(path.startsWith('/')||path.split('/').includes('..'))continue;
        const root=f.slice(0,-'firebase.json'.length)+(path&&path!=='.'?path+'/':'');
        add(root,'Firebase Hosting',100,Array.isArray(h.rewrites)?h.rewrites.filter(r=>typeof r.source==='string'&&typeof r.destination==='string'):[]);
      }
    }catch{}
  }
  for(const name of ['dist','build','out','public','dist/client','www']){
    const dir=stripped+name+'/';
    if(files.includes(dir+'index.html'))add(dir,'公開フォルダ',name==='dist'?90:80);
  }
  const moduleRoots=files.filter(f=>/(^|\/)package\.json$/.test(f) && archive.files.get(f)?.length<2**20);
  let build=false;
  for(const f of moduleRoots.slice(0,20)){
    if(f!==stripped+'package.json')continue;
    try{
      const p=JSON.parse(await (await archive.blob(f,'application/json')).text());
      const deps={...p.dependencies,...p.devDependencies};
      build=!!(p.scripts?.build&&(deps.vite||deps.next||deps.astro||deps.webpack||deps['react-scripts']||deps['@sveltejs/kit']));
    }catch{}
  }
  if(files.includes(stripped+'index.html')||(!results.size && count(stripped,files).some(x=>x.slice(stripped.length).split('/').length===1)))add(stripped,'ZIPの直下',50);
  for(const f of files.filter(p=>/(^|\/)index\.html?$/i.test(p)).slice(0,25)){
    if([...results.values()].some(r=>r.priority>=80&&f.startsWith(r.root))||f===stripped+'index.html')continue;
    const dir=f.slice(0,f.lastIndexOf('/')+1);if(dir!==stripped)add(dir,'HTMLを含むフォルダ',40);
  }
  if(!results.size&&count(stripped,files).length)add(stripped,'HTMLを検出',20);
  return {candidates:[...results.values()].sort((a,b)=>b.priority-a.priority),build,sourceRoot:stripped};
}
const omit = /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|firebase\.json|[^/]*\.rules(?:\.json)?|[^/]*\.map)$/i;
export async function expand(archive,project,progress=()=>{},cancel=()=>false) {
  const items=[...archive.files.keys()].filter(f=>f.startsWith(project.root)&&!omit.test(f));
  const output=[];
  for(let i=0;i<items.length;i++){
    if(cancel())return null;
    const full=items[i], path=full.slice(project.root.length);
    if(!path)continue;
    output.push([path,await archive.blob(full,mime(path))]);
    if(i%24===0){progress(i+1,items.length);await new Promise(r=>setTimeout(r,0));}
  }
  return output;
}
