'use strict';
// Account-scoped durable local cache + optimistic, resumable cloud synchronization.
// No provider operations are performed by this module.
window.PokeSiftCloud=(()=>{
  const copy=v=>structuredClone(v);
  const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  const equal=(a,b)=>stable(a)===stable(b);
  let persistedFingerprint='',syncFinished=Promise.resolve();
  const legacyKey='pokesift.collection.v1';
  let db,user,state,localRevision=0,writes=Promise.resolve(),pendingWrites=0,writingFailed=false,running=false,again=false,timer,stopped=false,blocked=false,channel;
  const blank=()=>({version:1,snapshot:{version:1,entries:[],collectionViews:null},base:{cards:{},layout:{revision:0,document:null}},pending:{},conflicts:{},uploaded:[],migrations:[],legacyImported:false,layoutHistory:[]});
  function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pokesift-cloud-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Cloud cache is blocked by another tab. Close it and try again.'));});}
  function read(){return new Promise((resolve,reject)=>{const tx=db.transaction('accounts'),r=tx.objectStore('accounts').get(user.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function persist(){
    pendingWrites++;status();
    const task=writes.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
      const fingerprint=stable({...state,localRevision:undefined});if(fingerprint===persistedFingerprint){resolve();return;}
      const tx=db.transaction('accounts','readwrite'),store=tx.objectStore('accounts'),r=store.get(user.id);let next;
      r.onsuccess=()=>{if((r.result?.localRevision||0)!==localRevision){blocked=true;tx.abort();return;}next=copy(state);next.localRevision=localRevision+1;store.put(next,user.id);};
      tx.oncomplete=()=>{localRevision=next.localRevision;persistedFingerprint=fingerprint;writingFailed=false;channel?.postMessage({revision:localRevision});resolve();};
      tx.onerror=tx.onabort=()=>{writingFailed=true;reject(Error(blocked?'Another tab updated this account. Reload this tab before editing.':'Could not save changes on this device. Keep this page open and back up your collection.'));};
    }));
    writes=task;
    try{await task;}catch(e){if(typeof storageWarning==='function')storageWarning(e.message);throw e;}
    finally{pendingWrites--;status();}
  }
  async function api(path,body,options={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const r=await fetch('/api/cloud/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),...options});
      const value=await r.json();
      if(!r.ok){const e=Error(value.error?.message||'Cloud sync is unavailable. Your local copy is retained.');e.status=r.status;e.detail=value.error||{};if(r.status===401){stopped=true;window.dispatchEvent(new Event('pokesift:unauthorized'));}throw e;}return value;
    }finally{clearTimeout(timeout);}
  }
  function dirty(){if(!state)return false;const now=new Map(state.snapshot.entries.map(e=>[e.id,e]));return Object.keys(state.pending).length>0||state.snapshot.entries.some(e=>!equal(e,state.base.cards[e.id]?.document)||state.base.cards[e.id]?.deletedAt)||Object.entries(state.base.cards).some(([id,b])=>!b.deletedAt&&!now.has(id))||!equal(state.snapshot.collectionViews,state.base.layout.document)||state.migrations.some(m=>m.state==='pending');}
  function status(message){
    const target=document.getElementById('sync-status');if(!target||!user)return;
    const conflicts=Object.keys(state?.conflicts||{}).length;
    target.textContent=message||(blocked?'Changed in another tab — reload':writingFailed?'Not saved — back up now':pendingWrites?'Saving on this device…':conflicts?`${conflicts} sync conflict${conflicts===1?'':'s'} to review`:running?'Syncing…':dirty()?'Saved on this device · waiting to sync':'Synced');
    const pill=document.querySelector('.local-pill');if(pill)pill.textContent=dirty()||running?'● SAVING YOUR COLLECTION':'● CLOUD COLLECTION';
    renderConflicts();
  }
  function schedule(ms=800){if(stopped||blocked)return;clearTimeout(timer);timer=setTimeout(()=>sync(),ms);}
  function save(snapshot){if(!user||blocked||stopped)return false;state.snapshot=copy(snapshot);persist().then(()=>schedule()).catch(()=>{});return true;}
  function display(){if(typeof entries==='undefined'||!initialized)return;entries=copy(state.snapshot.entries);collectionViews=copy(state.snapshot.collectionViews);render();}
  function busy(){return typeof active!=='undefined'&&(active||pendingPreparation||jobs.length||priceBatch.running||document.querySelector('.held-card,.turning-sheet,.is-dragging,.being-moved')||document.querySelector('#collection-room')?.contentDocument?.querySelector('.held-card,.turning-sheet,.is-dragging,.being-moved'));}
  const records=doc=>[doc,...(doc.scanHistory||[])];
  async function prepare(doc){
    const next=copy(doc);
    for(const record of records(next)){
      if(!record.scanPhoto)continue;
      let sha=record.scanPhoto.sha256;
      if(sha&&state.uploaded.includes(sha))continue;
      const blob=await PokeSiftPhotos.getLocal(record.id,sha);
      if(!blob){if(sha)throw Error('An archived photo has not reached the cloud yet. Retry on the device that captured it.');continue;}
      sha=await PokeSiftPhotos.digest(blob);record.scanPhoto.sha256=sha;
      if(!state.uploaded.includes(sha)){
        const r=await api('media',null,{headers:{'Content-Type':blob.type,'X-Content-SHA256':sha},body:blob});
        if(!r.verified||r.sha256!==sha||r.bytes!==blob.size)throw Error('Photo upload could not be verified.');
        state.uploaded.push(sha);await persist();
      }
    }
    return next;
  }
  function rememberMedia(doc){for(const r of records(doc))if(r.scanPhoto?.sha256&&!state.uploaded.includes(r.scanPhoto.sha256))state.uploaded.push(r.scanPhoto.sha256);}
  function replaceLocal(id,doc){const index=state.snapshot.entries.findIndex(e=>e.id===id);if(doc){if(index<0)state.snapshot.entries.unshift(copy(doc));else state.snapshot.entries[index]=copy(doc);}else if(index>=0)state.snapshot.entries.splice(index,1);}
  // Three-way merge only disjoint top-level changes. Observations/history may append.
  function merge(base,local,remote){
    if(equal(local,remote))return copy(local);
    if(!base||!local||!remote)return null;
    const result=Object.create(null);
    for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
      const b=base[key],l=local[key],r=remote[key];let value;
      if(equal(l,r)||equal(r,b))value=l;
      else if(equal(l,b))value=r;
      else if(['providerObservations','scanHistory'].includes(key)&&Array.isArray(l)&&Array.isArray(r)&&Array.isArray(b||[])&&(b||[]).every((x,i)=>equal(x,l[i])&&equal(x,r[i]))){
        value=copy(r);for(const item of l.slice((b||[]).length)){const existing=item.id&&value.find(v=>v.id===item.id);if(existing&&!equal(existing,item))return null;if(!value.some(v=>equal(v,item)))value.push(copy(item));}
      }else return null;
      if(value!==undefined)result[key]=copy(value);
    }
    return result;
  }
  async function sendPending(key){
    const op=copy(state.pending[key]);if(!op)return;
    try{
      const r=await api(key==='$layout'?'layout':'card',op);
      if(key==='$layout'){
        state.base.layout={revision:r.revision,document:r.document};
        if(equal(state.snapshot.collectionViews,op.document))state.snapshot.collectionViews=copy(r.document);
      }else{
        state.base.cards[key]={id:key,revision:r.revision,document:copy(op.document||state.base.cards[key]?.document),deletedAt:r.deletedAt};
      }
      delete state.pending[key];delete state.conflicts[key];await persist();
    }catch(e){
      if(e.status===409&&e.detail.code==='photo_pending'&&op.document){
        // An old, unreferenced upload may have been cleaned up while this device
        // was offline. Re-upload its retained bytes before retrying the write.
        const hashes=records(op.document).map(r=>r.scanPhoto?.sha256).filter(Boolean);
        state.uploaded=state.uploaded.filter(sha=>!hashes.includes(sha));
        await prepare(op.document);again=true;return;
      }
      if(e.status!==409||!('current' in e.detail))throw e;
      const remote=e.detail.current,base=key==='$layout'?state.base.layout:state.base.cards[key];
      const local=key==='$layout'?state.snapshot.collectionViews:state.snapshot.entries.find(x=>x.id===key)||null;
      const merged=key==='$layout'?null:merge(base?.document,local,remote?.deletedAt?null:remote?.document);
      if(merged&&!remote?.deletedAt){state.base.cards[key]=remote;replaceLocal(key,merged);delete state.pending[key];await persist();again=true;return;}
      state.conflicts[key]={local:copy(local),remote:copy(remote),base:copy(base||null)};delete state.pending[key];await persist();
    }
  }
  async function pull(){
    const inventory=await api('inventory');
    for(const row of inventory.cards){
      const b=state.base.cards[row.id];if(b?.revision===row.revision||state.pending[row.id]||state.conflicts[row.id])continue;
      const remote=await api('card?id='+encodeURIComponent(row.id));rememberMedia(remote.document);
      // A user can edit while a download is in flight. Re-read the live snapshot.
      const local=state.snapshot.entries.find(e=>e.id===row.id);
      if(local&&(!b||!equal(local,b.document)))continue;
      if(b&&!b.deletedAt&&!local)continue;
      state.base.cards[row.id]=remote;replaceLocal(row.id,remote.deletedAt?null:remote.document);
    }
    if(inventory.layout.revision!==state.base.layout.revision&&!state.pending['$layout']&&!state.conflicts['$layout']&&equal(state.snapshot.collectionViews,state.base.layout.document)){
      state.base.layout=inventory.layout;state.snapshot.collectionViews=copy(inventory.layout.document);
    }
  }
  async function loadInitial(){
    await writes;
    if(stopped||blocked||!user)throw Error('Your collection is not ready. Please try again.');
    // A new device must know whether the server collection is empty before
    // showing an empty-state screen. This only pulls data; it never scans.
    const load=async()=>{await pull();await persist();};
    if(navigator.locks)await navigator.locks.request('pokesift-cloud-network:'+user.id,load);else await load();
    return copy(state.snapshot);
  }
  async function work(){
    await writes;if(writingFailed||blocked||stopped||busy())return;
    // Always settle an uncertain idempotent write before generating a later one.
    for(const key of Object.keys(state.pending))await sendPending(key);
    await pull();await persist();
    for(const original of [...state.snapshot.entries]){
      if(stopped||blocked)break;
      if(state.conflicts[original.id]||state.pending[original.id])continue;
      const b=state.base.cards[original.id];if(b&&!b.deletedAt&&equal(original,b.document))continue;
      const doc=await prepare(original);
      const live=state.snapshot.entries.find(e=>e.id===doc.id);
      if(!equal(live,original)){again=true;continue;}
      replaceLocal(doc.id,doc);
      state.pending[doc.id]={id:doc.id,baseRevision:b?.revision||0,operationId:crypto.randomUUID(),action:'put',document:doc};
      await persist();await sendPending(doc.id);
    }
    for(const [id,b] of Object.entries(state.base.cards))if(!b.deletedAt&&!state.snapshot.entries.some(e=>e.id===id)&&!state.conflicts[id]&&!state.pending[id]){
      state.pending[id]={id,baseRevision:b.revision,operationId:crypto.randomUUID(),action:'delete'};await persist();await sendPending(id);
    }
    if(state.snapshot.collectionViews&&!equal(state.snapshot.collectionViews,state.base.layout.document)&&!state.conflicts['$layout']){
      state.pending['$layout']={baseRevision:state.base.layout.revision,operationId:crypto.randomUUID(),document:copy(state.snapshot.collectionViews)};await persist();await sendPending('$layout');
    }
    for(const m of state.migrations)if(m.state==='pending'){
      if(Object.keys(state.conflicts).length)break;
      const r=await api('migration',{id:m.id,manifest:m.manifest});m.state=r.state;m.result=r;
    }
    await persist();if(!busy())display();
  }
  async function sync(){
    if(stopped||blocked||!user||!navigator.onLine||document.hidden)return status();
    if(running){again=true;return;}running=true;again=false;status();
    let finish;syncFinished=new Promise(resolve=>{finish=resolve;});
    let error;
    try{if(navigator.locks)await navigator.locks.request('pokesift-cloud-network:'+user.id,{ifAvailable:true},async lock=>{if(lock)await work();});else await work();}
    catch(e){error=e;}
    finally{running=false;status(error?.message);schedule(error?30000:again?1000:30000);finish();}
  }
  async function resolve(key,choice){
    if(running)throw Error('Wait for the current sync to finish.');
    const conflict=state.conflicts[key];if(!conflict)return;
    const {remote,local}=conflict;
    if(key==='$layout'){
      state.layoutHistory.push(copy(conflict));state.layoutHistory=state.layoutHistory.slice(-20);
      state.base.layout=remote;state.snapshot.collectionViews=copy(choice==='cloud'?remote.document:local);
    }else{
      if(choice==='both'&&local){const duplicate=copy(local);duplicate.id=crypto.randomUUID();duplicate.conflictCopyOf=key;replaceLocal(duplicate.id,duplicate);}
      if(remote)state.base.cards[key]=remote;else delete state.base.cards[key];
      if(choice==='cloud'||choice==='both')replaceLocal(key,remote?.deletedAt?null:remote?.document||null);
      else if(remote?.deletedAt){
        const result=await api('card',{id:key,baseRevision:remote.revision,operationId:crypto.randomUUID(),action:'restore'});
        state.base.cards[key]={...remote,revision:result.revision,deletedAt:null};replaceLocal(key,local);
      }else replaceLocal(key,local);
    }
    delete state.conflicts[key];await persist();display();schedule();status();
  }
  function renderConflicts(){
    const host=document.getElementById('sync-conflicts');if(!host)return;
    host.hidden=!Object.keys(state?.conflicts||{}).length;
    const signature=JSON.stringify(state?.conflicts||{});if(host.dataset.signature===signature)return;host.dataset.signature=signature;host.replaceChildren();
    for(const [key,c] of Object.entries(state.conflicts)){
      const row=document.createElement('div'),text=document.createElement('p');
      text.textContent=key==='$layout'?'Your Binder or Zoo arrangement changed on another device. Choose which arrangement to keep.':`${c.local?.result?.data?.read?.name||c.remote?.document?.result?.data?.read?.name||'A card'} changed on another device. Both versions have been kept for you to review.`;
      row.append(text);
      const inspect=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Compare saved versions';pre.textContent=JSON.stringify({thisDevice:c.local,cloud:c.remote?.document||null,deletedInCloud:Boolean(c.remote?.deletedAt)},null,2);inspect.append(summary,pre);row.append(inspect);
      for(const [choice,label] of [['local',c.remote?.deletedAt?'Restore this device’s card':'Use this device'],['cloud','Use cloud'],...(key==='$layout'||!c.local?[]:[['both','Keep both versions']])]){
        const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await resolve(key,choice);}catch(e){status(e.message);}finally{b.disabled=false;}};row.append(b);
      }
      host.append(row);
    }
  }
  function legacy(){try{const value=JSON.parse(localStorage.getItem(legacyKey)||'null');return value?.version===1&&Array.isArray(value.entries)?value:null;}catch{return null;}}
  async function migrateLegacy(){
    if(running||busy())throw Error('Let current syncing and scans finish before migrating.');
    const source=legacy();if(!source?.entries.length)return;
    // Validate without modifying the original localStorage or IndexedDB archive.
    validateBackup(source);const incoming=copy(source),missing=[],hashes=[];
    for(const e of incoming.entries){retainHistoricalEvidence(e);e.result=normalizeResult(e.result);if(['preparing','queued','scanning'].includes(e.status)){e.status='interrupted';e.message='This earlier scan was unfinished. It has not been resubmitted.';}}
    for(const e of incoming.entries)for(const record of records(e)){
      const blob=await PokeSiftPhotos.getLegacy(record.id);
      if(blob){const sha=await PokeSiftPhotos.digest(blob);const saved=await PokeSiftPhotos.put(record.id,blob);if(!saved)throw Error('Not enough local storage to stage this migration. Back up your collection before continuing.');record.scanPhoto={...(record.scanPhoto||{}),id:record.id,mime:blob.type,bytes:blob.size,quality:'exact_upload',persisted:true,sha256:sha};hashes.push(sha);}
      else if(record.scanPhoto)missing.push(record.id);
    }
    let originalRates=null;try{originalRates=JSON.parse(localStorage.getItem('pokesift.fx.v1'));}catch{}
    const id=crypto.randomUUID(),manifest={cards:incoming.entries.map(e=>e.id),photos:[...new Set(hashes)],missingPhotos:missing,exchangeRates:originalRates};
    for(const e of incoming.entries){
      const old=state.snapshot.entries.find(x=>x.id===e.id);
      if(old&&!equal(old,e))state.conflicts[e.id]={local:e,remote:state.base.cards[e.id]||{revision:0,document:old,deletedAt:null},base:null};
      else if(!old)state.snapshot.entries.push(e);
    }
    if(!state.snapshot.collectionViews)state.snapshot.collectionViews=incoming.collectionViews||null;
    else if(incoming.collectionViews){
      const current=copy(state.snapshot.collectionViews);current.piles=current.piles||[[],[]];
      const placed=new Set([...(current.slots||[]),...current.piles.flat()]);for(const e of incoming.entries)if(!placed.has(e.id))current.piles[0].push(e.id);
      current.positions={...(incoming.collectionViews.positions||{}),...(current.positions||{})};state.snapshot.collectionViews=current;
    }
    state.migrations.push({id,manifest,state:'pending'});state.legacyImported=true;await persist();display();schedule();status(missing.length?`Migration queued. ${missing.length} older photos are missing; saved thumbnails are preserved.`:'Migration queued. Original device collection retained.');return manifest;
  }
  async function backupLegacy(){
    const snapshot=legacy();if(!snapshot)return;
    const images={},missing=[];for(const e of snapshot.entries)for(const r of records(e)){const blob=await PokeSiftPhotos.getLegacy(r.id);if(blob)images[r.id]=await PokeSiftPhotos.dataURL(blob);else if(r.scanPhoto)missing.push(r.id);}
    let rates=null;try{rates=JSON.parse(localStorage.getItem('pokesift.fx.v1'));}catch{}
    const backup={format:'pokesift-backup',backupVersion:4,...snapshot,exportedAt:new Date().toISOString(),scanImages:images,missingScanImages:missing,exchangeRates:rates};
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='pokesift-device-before-cloud.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function open(account){
    channel?.close();channel=null;db?.close();
    user=account;db=await openDB();state=await read()||blank();localRevision=state.localRevision||0;persistedFingerprint=stable({...state,localRevision:undefined});stopped=false;blocked=false;
    for(const e of state.snapshot.entries)if(['preparing','queued','scanning'].includes(e.status)){e.status='interrupted';e.message='This page closed before the scan completed. A scan may have been used. No retry was made.';}
    const photoHash=id=>{for(const e of state.snapshot.entries){const record=records(e).find(r=>r.id===id);if(record)return record.scanPhoto?.sha256;}return null;};
    PokeSiftPhotos.setScope(user.id,async(id,sha)=>{
      let hash=sha;
      if(!hash)hash=photoHash(id);
      if(!hash)return null;
      const response=await fetch('/api/cloud/media?hash='+encodeURIComponent(hash),{credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error('An archived photo could not be downloaded. Retry before relying on this backup.');
      const blob=await response.blob();if(await PokeSiftPhotos.digest(blob)!==hash)throw Error('Archived photo checksum mismatch.');return blob;
    },photoHash);
    if('BroadcastChannel'in window){channel=new BroadcastChannel('pokesift-account-'+user.id);channel.onmessage=e=>{if(e.data.revision>localRevision){blocked=true;readOnlyStorage=true;storageWarning('This account changed in another tab. Back up any unsaved work, then reload this tab.');status();}};}
    return copy(state.snapshot);
  }
  function start(){status();schedule(100);window.addEventListener('online',()=>schedule(100));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(100);});}
  async function clear(force=false,beforeRemove){
    stopped=true;clearTimeout(timer);await syncFinished;try{await writes;}catch(e){if(!force){stopped=false;throw e;}}
    if(!force&&(dirty()||pendingWrites||writingFailed)){stopped=false;schedule();throw Error('Sync or back up pending changes before signing out.');}
    try{if(beforeRemove)await beforeRemove();}catch(e){stopped=false;schedule();throw e;}
    await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').delete(user.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    await PokeSiftPhotos.clearScope();channel?.close();
  }
  async function recover(id){const row=state.base.cards[id]||await api('card?id='+encodeURIComponent(id));const result=await api('card',{id,baseRevision:row.revision,operationId:crypto.randomUUID(),action:'restore'});state.base.cards[id]={...row,revision:result.revision,deletedAt:null};replaceLocal(id,row.document);await persist();display();schedule();}
  return {open,loadInitial,start,save,sync,migrateLegacy,backupLegacy,clear,recover,api,merge,
    snapshot:()=>copy(state?.snapshot),legacy,hasLegacy:()=>Boolean(legacy()?.entries.length&&!state?.legacyImported),
    pending:()=>pendingWrites>0||writingFailed||dirty(),durable:()=>pendingWrites===0&&!writingFailed,
    deleted:()=>Object.values(state?.base.cards||{}).filter(c=>c.deletedAt&&c.deletedAt>Date.now()/1000-30*86400&&!c.document?.purged),
    recovery:()=>copy({conflicts:state?.conflicts||{},layoutHistory:state?.layoutHistory||[],migrations:state?.migrations||[],importedRecovery:state?.importedRecovery||[]}),
    stop:()=>{stopped=true;clearTimeout(timer);},resume:()=>{stopped=false;schedule(100);},
    importRecovery:async value=>{if(value&&typeof value==='object'){state.importedRecovery=[...(state.importedRecovery||[]),copy(value)];await persist();}}
  };
})();
