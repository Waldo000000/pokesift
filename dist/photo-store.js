'use strict';
// Full scan images live in IndexedDB; small collection metadata stays in localStorage.
// This is device-local storage, not a server database or cloud upload.
window.PokeSiftPhotos = (() => {
  let connection;
  const transient = new Map();
  function open() {
    if (!connection) connection = new Promise((resolve,reject) => {
      let request, settled=false;
      const timer=setTimeout(()=>{settled=true;reject(new Error('Photo storage unavailable'));},4000);
      try { request=indexedDB.open('pokesift-media',1); } catch(error) { clearTimeout(timer);reject(error);return; }
      request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains('scan-images')) request.result.createObjectStore('scan-images'); };
      request.onerror=()=>{clearTimeout(timer);reject(request.error);};
      request.onblocked=()=>{clearTimeout(timer);settled=true;reject(new Error('Photo storage blocked'));};
      request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    }).catch(error=>{connection=null;throw error;});
    return connection;
  }
  async function transaction(mode, operation) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('scan-images',mode), request=operation(tx.objectStore('scan-images'));
      let result;request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error || new Error('Photo storage failed'));
    });
  }
  return {
    hasTransient() { return transient.size > 0; },
    async put(id,blob) { transient.set(id,blob);try{await transaction('readwrite',store=>store.put(blob,id));transient.delete(id);return true;}catch{return false;} },
    async get(id) { if(transient.has(id))return transient.get(id);try{return await transaction('readonly',store=>store.get(id)) || null;}catch{return null;} },
    async remove(id) {transient.delete(id);try{await transaction('readwrite',store=>store.delete(id));}catch{}},
    async dataURL(blob) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});},
    decode(value) {
      if(typeof value!=='string' || value.length>12*1024*1024 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))throw new Error('Invalid scan image in backup.');
      const comma=value.indexOf(','), bytes=atob(value.slice(comma+1));
      if(bytes.length>8*1024*1024)throw new Error('Backup scan image exceeds 8 MB.');
      return new Blob([Uint8Array.from(bytes,c=>c.charCodeAt(0))],{type:value.slice(5,value.indexOf(';'))});
    }
  };
})();
