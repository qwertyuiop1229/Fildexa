import {relativeAsset} from './lab-core.mjs';
const cap=24*2**20, units={5121:1,5123:2,5125:4,5126:4};
const read=(v,type,i)=>type===5121?v.getUint8(i):type===5123?v.getUint16(i,true):type===5125?v.getUint32(i,true):v.getFloat32(i,true);
export async function modelTriangles(path,file,reader,same=()=>true){
  if(file.size>cap)throw Error('3Dプレビューは24 MBまでです。');
  const buf=await file.arrayBuffer(),head=new DataView(buf),chunks=[];let doc;
  if(/\.glb$/i.test(path)){
    if(buf.byteLength<20||head.getUint32(0,true)!==0x46546c67||head.getUint32(4,true)!==2||head.getUint32(8,true)!==buf.byteLength)throw Error('GLB 2.0として読み込めません。');
    for(let i=12;i+8<=buf.byteLength;){
      const size=head.getUint32(i,true),type=head.getUint32(i+4,true);i+=8;if(i+size>buf.byteLength)throw Error('モデルのデータが途中で切れています。');
      if(type===0x4e4f534a)doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,i,size)));
      if(type===0x004e4942)chunks.push(new DataView(buf,i,size));
      i+=size;
    }
  }else doc=JSON.parse(new TextDecoder().decode(buf));
  if(!doc||!String(doc.asset?.version).startsWith('2'))throw Error('glTF 2.0に対応しています。');
  let total=buf.byteLength;
  for(const [i,entry] of (doc.buffers??[]).slice(0,12).entries()){
    if(!same())return null;if(!entry.uri)continue;
    const name=relativeAsset(path,entry.uri);let asset;
    if(name)asset=await reader(name);
    else if(/^data:application\/(?:octet-stream|gltf-buffer);base64,/i.test(entry.uri)&&entry.uri.length<32*2**20){
      const txt=atob(entry.uri.split(',')[1]);asset=new Blob([Uint8Array.from(txt,c=>c.charCodeAt(0))]);
    }else throw Error('同じフォルダ内のモデル素材だけ読み込めます。');
    total+=asset.size;if(total>cap)throw Error('モデル素材は合計24 MBまでです。');
    chunks[i]=new DataView(await asset.arrayBuffer());
  }
  function get(index,w){
    const a=doc.accessors?.[index],b=doc.bufferViews?.[a?.bufferView],v=chunks[b?.buffer],u=units[a?.componentType],step=b?.byteStride??w*u,o=(b?.byteOffset??0)+(a?.byteOffset??0);
    if(!u||!v||!Number.isInteger(a.count)||a.count<1||a.count>600000||step<w*u||o<0||o+(a.count-1)*step+w*u>v.byteLength)return null;
    return {length:a.count,at:(i,j=0)=>i>=0&&i<a.count?read(v,a.componentType,o+i*step+j*u):NaN};
  }
  const all=[];let points=0;
  for(const mesh of (doc.meshes??[]).slice(0,60)){
    for(const primitive of (mesh.primitives??[]).slice(0,60)){
      if(primitive.mode!=null&&primitive.mode!==4||points>=5500)continue;
      const p=get(primitive.attributes?.POSITION,3),ind=primitive.indices==null?null:get(primitive.indices,1);if(!p||primitive.indices!=null&&!ind)continue;
      const len=ind?.length??p.length,stride=Math.max(1,Math.ceil(len/Math.max(3,(5500-points)*3)));
      for(let i=0;i+2<len&&points<5500;i+=stride*3){
        const t=[];
        for(let j=0;j<3;j++){const idx=ind?ind.at(i+j):i+j;t.push([p.at(idx),p.at(idx,1),p.at(idx,2)]);}
        if(t.every(x=>x.every(Number.isFinite))){all.push(t);points++;}
      }
    }
  }
  if(!all.length)throw Error('対応する三角形がありません。圧縮メッシュや特殊な描画は元アプリで開いてください。');
  return all;
}
export async function viewModel(path,blob,host,reader,same){
  const ts=await modelTriangles(path,blob,reader,same);if(!ts||!same())return;
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const t of ts)for(const p of t)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  const scale=Math.max(...hi.map((x,i)=>x-lo[i]))||1;
  for(const t of ts)for(const p of t)for(let i=0;i<3;i++)p[i]=(p[i]-(lo[i]+hi[i])/2)/scale;
  const canvas=document.createElement('canvas'),note=document.createElement('p');
  canvas.className='asset-model';canvas.width=720;canvas.height=480;canvas.tabIndex=0;canvas.setAttribute('aria-label','3D形状。ドラッグまたは矢印キーで回転');
  note.className='quiet';note.textContent='ドラッグまたは矢印キーで回転。形状の確認用です。色・テクスチャ・ボーン・アニメーションは反映しません。';
  host.append(canvas,note);const g=canvas.getContext('2d');if(!g)throw Error('この端末では3D形状を描画できません。');
  let rx=.38,ry=.55,raf=0,drag=null;
  function draw(){
    raf=0;g.clearRect(0,0,720,480);
    const transform=([x,y,z])=>{const a=x*Math.cos(ry)+z*Math.sin(ry),b=z*Math.cos(ry)-x*Math.sin(ry),c=y*Math.cos(rx)-b*Math.sin(rx),d=y*Math.sin(rx)+b*Math.cos(rx);return [360+a*300,240-c*300,d];};
    const items=ts.map(t=>{const v=t.map(transform);return [v,(v[0][2]+v[1][2]+v[2][2])/3];}).sort((a,b)=>a[1]-b[1]);
    g.lineWidth=.45;
    for(const [v,z] of items){g.beginPath();g.moveTo(v[0][0],v[0][1]);g.lineTo(v[1][0],v[1][1]);g.lineTo(v[2][0],v[2][1]);g.closePath();g.fillStyle='hsl(163 51% '+(42+z*30)+'%)';g.fill();g.strokeStyle='#064a41';g.stroke();}
  }
  function queue(){if(!raf)raf=requestAnimationFrame(draw);}
  canvas.onpointerdown=e=>{if(!e.isPrimary||e.button!==0)return;drag=[e.pointerId,e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(drag?.[0]!==e.pointerId)return;ry+=(e.clientX-drag[1])*.012;rx+=(e.clientY-drag[2])*.012;drag=[e.pointerId,e.clientX,e.clientY];queue();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{if(drag?.[0]===e.pointerId)drag=null;};
  canvas.onkeydown=e=>{const d={ArrowUp:[-.1,0],ArrowDown:[.1,0],ArrowLeft:[0,-.1],ArrowRight:[0,.1]}[e.key];if(d){e.preventDefault();rx+=d[0];ry+=d[1];queue();}};
  draw();return ()=>{if(raf)cancelAnimationFrame(raf);};
}
