import {plusOne} from './counter.js';
const data = await fetch(new URL('../data/info.json',import.meta.url)).then(r=>r.json());
document.getElementById('status').textContent=data.text;
let count=Number(localStorage.getItem('count')??0);
const label=document.getElementById('count');
label.textContent=count;
document.getElementById('plus').addEventListener('click',async()=>{
  const module=await import('./labels.js');
  count=plusOne(count);label.textContent=count;localStorage.setItem('count',count);
  document.getElementById('status').textContent=module.note;
});
