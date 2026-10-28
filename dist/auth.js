'use strict';
(() => {
  if(window.POKESIFT_RUNTIME?.cloud)return;
  const $ = id => document.getElementById(id);
  // Strip the fragment before any asynchronous work; never store invites locally.
  let invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invite !== null) history.replaceState(null,'',location.pathname + location.search);
  let pairingURL = '', expiry = 0, interval;
  function signedOut(message) { document.body.dataset.auth = 'signed-out'; $('pairing-status').textContent = message; }
  async function request(path, data) {
    const response = await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || 'Please try again.');
    return result;
  }
  async function start() {
    $('check-session').disabled = true;
    try {
      if (invite !== null) {
        const token = invite; invite = null;
        $('pairing-status').textContent = 'Pairing this device…';
        await request('/api/pair',{invite:token});
      } else await request('/api/session');
      document.body.dataset.auth = 'signed-in';
      window.dispatchEvent(new Event('pokesift:authenticated'));
    } catch(error) { signedOut(error.message || 'Could not connect. Please try again.'); }
    finally { $('check-session').disabled = false; }
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
  start();
})();
