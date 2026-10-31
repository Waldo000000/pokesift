'use strict';
// Keep private cards and sign-in controls out of the first paint until the
// session has been checked. Connection errors are distinct from signing out.
window.PokeSiftStartup=(()=>{
  const $=id=>document.getElementById(id);
  function show(state){document.body.dataset.auth=state;$('startup-view').hidden=!['pending','error'].includes(state);$('startup-view').setAttribute('aria-busy',String(state==='pending'));$('pairing-view').hidden=state!=='signed-out';$('collection-view').hidden=state!=='signed-in';}
  function pending(text='Opening your collection…'){show('pending');$('startup-status').textContent=text;$('retry-startup').hidden=true;}
  function error(text,retry){show('error');$('startup-status').textContent=text;$('retry-startup').hidden=false;$('retry-startup').onclick=retry;}
  return {show,pending,error};
})();
(() => {
  if(typeof window.POKESIFT_RUNTIME?.cloud!=='boolean'){PokeSiftStartup.error('PokéSift could not finish loading. Please try again.',()=>location.reload());return;}
  if(window.POKESIFT_RUNTIME?.cloud)return;
  const $ = id => document.getElementById(id);
  // Strip the fragment before any asynchronous work; never store invites locally.
  let invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invite !== null) history.replaceState(null,'',location.pathname + location.search);
  let pairingURL = '', expiry = 0, interval,checking=false;
  function signedOut(message) { $('pairing-status').textContent = message;PokeSiftStartup.show('signed-out'); }
  async function request(path, data) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
    const response = await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result?.error?.message || 'Please try again.'),{status:response.status});
    return result;
    }finally{clearTimeout(timeout);}
  }
  async function start() {
    if(checking)return;checking=true;
    $('check-session').disabled = true;
    PokeSiftStartup.pending();
    try {
      if (invite !== null) {
        const token = invite; invite = null;
        $('pairing-status').textContent = 'Pairing this device…';
        await request('/api/pair',{invite:token});
      } else await request('/api/session');
      window.dispatchEvent(new Event('pokesift:authenticated'));
      PokeSiftStartup.show('signed-in');
    } catch(error) {if(error.status===401)signedOut(error.message);else PokeSiftStartup.error('Could not open PokéSift. Check your connection and try again.',start);}
    finally {checking=false; $('check-session').disabled = false; }
  }
  $('check-session').onclick = start;
  window.addEventListener('pokesift:unauthorized',() => signedOut('Pair this device again using a fresh QR code.'));
  $('sign-out').onclick = async() => {
    if (!$('activity').hidden && !confirm('Scans are still running. Sign out anyway? Submitted scans may still use credits.')) return;
    try { await request('/api/logout',{}); location.reload(); }
    catch { signedOut('Could not sign out. Check your connection and try again.'); }
  };
  function tick() {
    const remaining = Math.max(0,expiry-Math.floor(Date.now()/1000));
    $('invite-status').textContent = remaining ? `Valid for ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}` : 'This invite has expired. Close and reopen to create another.';
    if (!remaining) { clearInterval(interval); pairingURL = ''; $('invite-qr').hidden = true; $('invite-qr').removeAttribute('src'); $('copy-invite').disabled = true; }
  }
  $('add-device').onclick = async() => {
    $('invite-view').showModal(); $('invite-status').textContent = 'Creating your invite…'; $('invite-qr').hidden = true; $('copy-invite').disabled = true;
    try {
      const result = await request('/api/invites',{});
      if (!$('invite-view').open) return;
      pairingURL = result.url; expiry = result.expiresAt;
      $('invite-qr').src = result.qr; $('invite-qr').hidden = false; $('copy-invite').disabled = false;
      tick(); interval = setInterval(tick,1000);
    } catch(error) { $('invite-status').textContent = error.message; }
  };
  $('copy-invite').onclick = async() => {
    try { await navigator.clipboard.writeText(pairingURL); $('copy-invite').textContent = 'Copied'; }
    catch { $('invite-status').textContent = 'Copy unavailable. Scan the QR instead.'; }
  };
  $('close-invite').onclick = () => $('invite-view').close();
  $('invite-view').addEventListener('close',() => { clearInterval(interval); pairingURL=''; $('invite-qr').removeAttribute('src'); $('copy-invite').textContent='Copy pairing link'; });
  window.addEventListener('DOMContentLoaded',start,{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)start();});
  window.addEventListener('pagehide',()=>PokeSiftStartup.pending());
})();
