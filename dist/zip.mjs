export const limits = { zip: 120 * 2**20, total: 300 * 2**20, entry: 96 * 2**20, count: 12000 };
const crcTable = Uint32Array.from({length:256}, (_, n) => {
  for(let i=0;i<8;i++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : n >>> 1;
  return n;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for(const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const fail = (message='ZIPが壊れているか、対応していない形式です。') => { throw new Error(message); };
export function clean(name) {
  name = name.replaceAll('\\','/');
  if(name.startsWith('/') || /^[a-z]:/i.test(name) || /[\u0000-\u001f\u007f]/.test(name) || name.split('/').includes('..')) return null;
  const path=name.split('/').filter(x=>x && x!=='.').join('/');
  if(!path || path.length>1500 || path.split('/').some(x=>x!=='.output'&&/^\.|^__MACOSX$|^node_modules$/i.test(x))) return null;
  if(/(?:^|\/)(?:[^/]*service[-_]?account[^/]*\.json|client_secret[^/]*\.json|credentials[^/]*\.json|id_(rsa|ed25519|ecdsa)|[^/]+\.(?:pem|key|p8|p12|pfx|jwk|jks|keystore))$/i.test(path)) return null;
  return path;
}
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';
const dec = new TextDecoder('utf-8',{fatal:true});
function readName(raw, extra, flags) {
  const v=new DataView(extra.buffer,extra.byteOffset,extra.byteLength);
  for(let i=0;i+4<=extra.length;){
    const type=v.getUint16(i,true), length=v.getUint16(i+2,true);
    if(i+4+length>extra.length)break;
    if(type===0x7075 && length>5 && extra[i+4]===1 && v.getUint32(i+5,true)===crc32(raw))return dec.decode(extra.subarray(i+9,i+4+length));
    i+=4+length;
  }
  try{return dec.decode(raw)}catch{if(flags&2048)fail('ZIPのファイル名を読み取れません。');return Array.from(raw,b=>b<128?String.fromCharCode(b):CP437[b-128]).join('');}
}
export function readZip(bytes, { packageRelationships = false } = {}) {
  if(bytes.byteLength>limits.zip)fail('ZIPは120 MB以下にしてください。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), L=bytes.length;
  const u16=i=>v.getUint16(i,true), u32=i=>v.getUint32(i,true);
  let t=L-22;
  for(;t>=Math.max(0,L-65557);t--)if(u32(t)===0x06054b50&&t+22+u16(t+20)===L)break;
  if(t<0 || t<Math.max(0,L-65557))fail();
  const count=u16(t+10), size=u32(t+12), offset=u32(t+16);
  if(u16(t+4)||u16(t+6)||u16(t+8)!==count || count===65535 || size===0xffffffff || offset===0xffffffff)fail('分割ZIPとZIP64には対応していません。');
  if(count>limits.count)fail('ZIP内の項目は12,000個以下にしてください。');
  if(offset+size>t)fail();
  let i=offset, total=0;
  const files=new Map();
  for(let n=0;n<count;n++){
    if(i+46>offset+size||u32(i)!==0x02014b50)fail();
    const flags=u16(i+8), method=u16(i+10), crc=u32(i+16), compressed=u32(i+20), length=u32(i+24), ns=u16(i+28), es=u16(i+30), cs=u16(i+32), disk=u16(i+34), attrs=u32(i+38), local=u32(i+42);
    const end=i+46+ns+es+cs;
    if(end>offset+size||disk)fail();
    const raw=readName(bytes.subarray(i+46,i+46+ns),bytes.subarray(i+46+ns,i+46+ns+es),flags);
    i=end;
    // OOXML packages store their root relationships in this otherwise hidden part.
    const path=packageRelationships && raw==='_rels/.rels' ? raw : clean(raw);
    if(!path || /[\\/]$/.test(raw) || (attrs>>>28)===10)continue;
    if(files.has(path))fail('同じ名前のファイルがZIP内に複数あります。');
    total+=length;
    if(length>limits.entry||total>limits.total)fail('展開後のサイズは合計300 MB、1ファイル96 MB以下にしてください。');
    if(local+30>offset||u32(local)!==0x04034b50||u16(local+8)!==method)fail();
    const from=local+30+u16(local+26)+u16(local+28);
    if(from+compressed>offset)fail();
    files.set(path,{method,length,crc,flags,from,compressed});
  }
  async function blob(path,type='application/octet-stream'){
    const m=files.get(path);
    if(!m)fail('ZIPにファイルがありません。');
    if(m.flags&1)fail('パスワード付きZIPには対応していません。');
    const data=bytes.subarray(m.from,m.from+m.compressed);
    if(m.method===0){
      if(data.length!==m.length||crc32(data)!==m.crc)fail();
      return new Blob([data],{type});
    }
    if(m.method!==8)fail('ZIPの圧縮方式に対応していません。');
    let pipe;
    try{pipe=new DecompressionStream('deflate-raw');}
    catch{fail('このブラウザではZIPを展開できません。最新版のChrome、Safari、Firefoxなどでお試しください。');}
    const reader=new Blob([data]).stream().pipeThrough(pipe).getReader();
    const chunks=[];let loaded=0, sum=0xffffffff;
    try {
      while(true){
        const {done,value}=await reader.read();if(done)break;
        loaded+=value.length;
        if(loaded>m.length){await reader.cancel();fail();}
        for(const b of value)sum=crcTable[(sum^b)&255]^(sum>>>8);
        chunks.push(value);
      }
    }catch{fail('ZIP内のファイルを展開できませんでした。');}
    if(loaded!==m.length || ((sum^0xffffffff)>>>0)!==m.crc)fail();
    return new Blob(chunks,{type});
  }
  return {files,blob};
}
const types={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',cjs:'text/javascript',json:'application/json',webmanifest:'application/manifest+json',txt:'text/plain',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',gif:'image/gif',ico:'image/x-icon',bmp:'image/bmp',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/ogg',aac:'audio/aac',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',wasm:'application/wasm',glb:'model/gltf-binary',gltf:'model/gltf+json',pdf:'application/pdf'};
export const mime = p => types[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
