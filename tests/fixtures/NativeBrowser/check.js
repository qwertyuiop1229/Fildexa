// A local smoke test. No remote provider or real login data.
const mark=document.getElementById('test-status');
const readonly=()=>new Promise((resolve,reject)=>{
  const r=indexedDB.open('zipstage-test',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('items');
  r.onerror=()=>reject(r.error);r.onsuccess=()=>{
    const db=r.result,tx=db.transaction('items','readwrite');
    tx.objectStore('items').put('fixture','item');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  };
});
(async()=>{
  try{
    localStorage.setItem('test','ready');
    await readonly();
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    mark.textContent='Storage and worker passed';
  }catch(e){mark.textContent='Browser check failed: '+e.message;}
})();
document.getElementById('popup').onclick=()=>{
  const test=window.open('/popup.html','zipstage-fixture','width=480,height=320');
  if(!test)document.body.dataset.popup='blocked';
};
window.addEventListener('message',e=>{
  if(e.origin===location.origin&&e.data==='zipstage-popup-ready')document.body.dataset.popup='passed';
});
