'use strict';
// Device photo cache. Cloud mode scopes keys to an account and validates the
// current content hash before returning a cached image after a remote retake.
window.PokeSiftPhotos = (() => {
  let connection,scope='',remote=null,resolveHash=null;
  const key=id=>scope?scope+':'+id:id;
  const hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
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
    setScope(id,fetcher,resolver){scope=id||'';remote=fetcher||null;resolveHash=resolver||null;},
    digest:hash,
    async put(id,blob) {
      const k=key(id);transient.set(k,blob);
      try{
        if(scope){const sha=await hash(blob);await transaction('readwrite',store=>store.put(blob,key('hash:'+sha)));await transaction('readwrite',store=>store.put({sha256:sha},k));}
        else await transaction('readwrite',store=>store.put(blob,k));
        transient.delete(k);return true;
      }catch{return false;}
    },
    async getLocal(id,sha) {
      const k=key(id),memory=transient.get(k);if(memory&&(!sha||await hash(memory)===sha))return memory;
      try{
        const value=await transaction('readonly',store=>store.get(sha?key('hash:'+sha):k));
        if(value instanceof Blob)return value;
        if(value?.sha256)return await transaction('readonly',store=>store.get(key('hash:'+value.sha256)))||null;
        return null;
      }catch{return null;}
    },
    async getLegacy(id){if(transient.has(id))return transient.get(id);try{const value=await transaction('readonly',store=>store.get(id));return value instanceof Blob?value:null;}catch{return null;}},
    async get(id) {const sha=resolveHash?.(id),local=await this.getLocal(id,sha);if(local||!remote)return local;const blob=await remote(id,sha);if(blob)await this.put(id,blob);return blob;},
    async remove(id) {transient.delete(key(id));try{await transaction('readwrite',store=>store.delete(key(id)));}catch{}},
    async clearScope(){
      if(!scope)return;const prefix=scope+':';for(const k of transient.keys())if(k.startsWith(prefix))transient.delete(k);
      const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('scan-images','readwrite'),r=tx.objectStore('scan-images').openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(String(c.key).startsWith(prefix))c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    },
    async dataURL(blob) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});},
    decode(value) {
      if(typeof value!=='string' || value.length>12*1024*1024 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))throw new Error('Invalid scan image in backup.');
      const comma=value.indexOf(','), bytes=atob(value.slice(comma+1));
      if(bytes.length>8*1024*1024)throw new Error('Backup scan image exceeds 8 MB.');
      return new Blob([Uint8Array.from(bytes,c=>c.charCodeAt(0))],{type:value.slice(5,value.indexOf(';'))});
    }
  };
})();
