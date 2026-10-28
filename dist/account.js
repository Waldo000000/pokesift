'use strict';
// Cloud account UI is opt-in; the existing device-only app stays intact until rollout.
window.PokeSiftAccount=(()=>{
  let user=null,join='',started=false;
  const $=id=>document.getElementById(id),button=(text,handler)=>{const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=text;b.onclick=handler;return b;};
  async function request(path,data){const r=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error?.message||'Unable to connect. Please try again.');return value;}
  function message(text){$('account-status').textContent=text;}
  function signedOut(text){document.body.dataset.auth='signed-out';$('pairing-status').textContent=text||'Sign in to keep your cards together across devices.';}
  async function refresh(){const r=await request('/api/session');user=r.account;$('account-name').textContent=user.name;$('account-email').textContent=user.email;$('scan-remaining').textContent=`${user.scansRemaining} scans remaining`;$('owner-tools').hidden=user.role!=='owner';return user;}
  function setup(){
    $('pairing-view').querySelector('.fineprint').textContent='Your own collection, on your phone, tablet and computer. Start with a few trial scans, or join with an invitation from a friend.';
    $('check-session').hidden=true;
    const login=document.createElement('button');login.id='google-sign-in';login.className='primary';login.textContent='Continue with Google';
    login.onclick=async()=>{login.disabled=true;$('pairing-status').textContent='Opening Google…';try{const r=await request('/api/account/sign-in',{});location.assign(r.url);}catch(e){signedOut(e.message);login.disabled=false;}};
    $('pairing-view').append(login);
    $('add-device').hidden=true;$('sign-out').hidden=true;
    const footer=document.querySelector('.collection-footer');const account=button('Account',()=>show());account.id='account-button';footer.append(account);
    const sync=document.createElement('span');sync.id='sync-status';sync.setAttribute('role','status');footer.prepend(sync);
    const conflict=document.createElement('section');conflict.id='sync-conflicts';conflict.className='cloud-notice';conflict.hidden=true;$('collection-view').insertBefore(conflict,$('collection-view').children[1]);
    const migration=document.createElement('section');migration.id='cloud-migration';migration.className='cloud-notice';migration.hidden=true;
    const title=document.createElement('h2');title.textContent='Bring your cards with you.';const text=document.createElement('p');text.id='migration-copy';migration.append(title,text);
    migration.append(button('Back up this device first',async()=>{try{await PokeSiftCloud.backupLegacy();}catch(e){$('migration-copy').textContent=e.message;}}));
    const move=button('Bring these cards into my account',async()=>{move.disabled=true;try{const r=await PokeSiftCloud.migrateLegacy();$('migration-copy').textContent=r?.missingPhotos.length?`Added to the sync queue. ${r.missingPhotos.length} older photos were missing; their saved details remain. Your original collection is still on this device.`:'Added to the sync queue. Your original device collection is retained.';move.hidden=true;}catch(e){$('migration-copy').textContent=e.message;}finally{move.disabled=false;}});move.id='migrate-device';migration.append(move);$('collection-view').insertBefore(migration,conflict);
    const dialog=document.createElement('dialog');dialog.id='account-view';dialog.className='account-dialog';
    dialog.innerHTML=`<button id="close-account" class="round-button account-close" aria-label="Close account">×</button><p class="eyebrow">YOUR POKÉSIFT ACCOUNT</p><h2 id="account-name"></h2><p id="account-email"></p><strong id="scan-remaining"></strong><p id="account-status" role="status"></p><div class="account-actions"><button id="sync-now" class="text-button">Sync now</button><button id="cloud-backup" class="text-button">Back up collection</button></div><details open><summary>Have an invitation?</summary><p>A friend’s code gives your account a larger scan allowance.</p><label>Invitation code<input id="join-code" autocomplete="off" maxlength="100"></label><button id="redeem-code" class="text-button">Use invitation</button></details><details><summary>Need more scans?</summary><label>Optional note<textarea id="scan-request-note" maxlength="500" rows="2"></textarea></label><button id="request-scans" class="text-button">Request more scans</button></details><details id="owner-tools" hidden><summary>Owner tools</summary><button id="create-friend-invite" class="text-button">Create a seven-day invitation</button><p>Up to five people · 50 scans each · codes do not stack</p><label id="created-invite-label" hidden>Share this invitation<input id="created-invite" readonly></label><button id="copy-friend-invite" class="text-button" hidden>Copy link</button><button id="load-admin" class="text-button">Manage allowances and invitations</button><div id="admin-content"></div></details><details><summary>Signed-in devices</summary><button id="load-sessions" class="text-button">Refresh devices</button><div id="sessions-content"></div></details><details><summary>Recently removed cards</summary><p>Restore cards removed within the last 30 days.</p><button id="load-deleted" class="text-button">Show removed cards</button><div id="deleted-content"></div></details><details><summary>Sign out of this device</summary><p>Your synced collection stays in your account. This removes the account’s cached cards and photos from this browser. The original pre-migration collection stays intact.</p><button id="account-sign-out" class="text-button">Sign out</button><div id="signout-pending" hidden><p>Some changes haven’t reached the cloud. Sync them or download a backup before removing this device’s copy.</p><button id="signout-backup" class="text-button">Download backup</button><button id="signout-discard" class="text-button">I have a backup — sign out and remove this copy</button></div></details><p class="fineprint"><a href="/privacy.html" target="_blank" rel="noopener">Privacy and storage</a></p>`;
    document.body.append(dialog);
    $('close-account').onclick=()=>dialog.close();$('sync-now').onclick=()=>PokeSiftCloud.sync();$('cloud-backup').onclick=()=> $('export').click();
    $('redeem-code').onclick=async()=>{try{await PokeSiftCloud.api('redeem',{code:$('join-code').value.trim()});join='';sessionStorage.removeItem('pokesift.join');$('join-code').value='';await refresh();message('Invitation applied. Welcome aboard.');}catch(e){message(e.message);}};
    $('request-scans').onclick=async()=>{try{await PokeSiftCloud.api('request-scans',{note:$('scan-request-note').value});message('Request saved for the owner to review.');}catch(e){message(e.message);}};
    $('create-friend-invite').onclick=async()=>{try{const r=await PokeSiftCloud.api('invite',{});$('created-invite').value=r.url;$('created-invite-label').hidden=false;$('copy-friend-invite').hidden=false;message('Valid for seven days or until five people join.');}catch(e){message(e.message);}};
    $('copy-friend-invite').onclick=async()=>{try{await navigator.clipboard.writeText($('created-invite').value);message('Invitation copied.');}catch{$('created-invite').select();message('Select and copy the invitation link.');}};
    $('load-admin').onclick=admin;
    $('load-sessions').onclick=async()=>{try{const data=await PokeSiftCloud.api('sessions');$('sessions-content').replaceChildren();for(const s of data.sessions){const row=document.createElement('p');row.textContent=(s.id===data.current?'This device · ':'')+s.label;if(s.id!==data.current)row.append(button('Revoke',async()=>{try{await PokeSiftCloud.api('revoke-session',{id:s.id});if(s.id===data.current)location.reload();else $('load-sessions').click();}catch(e){message(e.message);}}));$('sessions-content').append(row);}}catch(e){message(e.message);}};
    $('load-deleted').onclick=()=>{const host=$('deleted-content');host.replaceChildren();const list=PokeSiftCloud.deleted();if(!list.length)host.textContent='No removed cards.';for(const item of list){const row=document.createElement('p');row.textContent=titleOf(item.document);row.append(button('Restore',async()=>{try{await PokeSiftCloud.recover(item.id);$('load-deleted').click();message('Card restored.');}catch(e){message(e.message);}}));host.append(row);}};
    async function signOut(force=false){try{if(active||jobs.length||pendingPreparation||priceBatch.running)throw Error('Let current scans and price updates finish before signing out.');if(!force&&PokeSiftCloud.pending()){$('signout-pending').hidden=false;return;}await PokeSiftCloud.clear(force,()=>request('/api/logout',{}));location.reload();}catch(e){message(e.message);}}
    $('account-sign-out').onclick=()=>signOut();$('signout-backup').onclick=()=> $('export').click();$('signout-discard').onclick=()=>signOut(true);
  }
  async function admin(){
    try{const data=await PokeSiftCloud.api('admin'),host=$('admin-content');host.replaceChildren();
      const note=document.createElement('p');note.textContent='Budgets count submitted calls, including uncertain outcomes. Zero pauses new calls. Public trial scans also share their daily pool.';host.append(note);
      for(const [name,amount] of Object.entries(data.budgets)){
        const row=document.createElement('label');row.textContent={tcgapi_monthly:'All accounts: scan calls per calendar month',pikaqian_monthly:'All accounts: catalog calls per calendar month',public_daily:'Public trial scans per day'}[name];const input=document.createElement('input');input.type='number';input.min='0';input.max='100000';input.value=amount;row.append(input,button('Save',async()=>{try{await PokeSiftCloud.api('admin',{action:'budget',id:name,amount:Number(input.value)});message('Budget updated.');}catch(e){message(e.message);}}));host.append(row);
      }
      const usage=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Reserved usage';pre.textContent=JSON.stringify(data.usage,null,2);usage.append(summary,pre);host.append(usage);
      for(const a of data.accounts){
        const section=document.createElement('section'),label=document.createElement('p');label.textContent=`${a.name} · ${a.email} · ${a.spent} of ${a.allowance} scans used${a.disabled?' · disabled':''}`;section.append(label);
        const request=data.requests.find(r=>r.owner_id===a.id);if(request){const p=document.createElement('p');p.textContent='Request: '+(request.note||'More scans');section.append(p);}
        const input=document.createElement('input');input.type='number';input.min='0';input.max='100000';input.value=a.allowance;input.setAttribute('aria-label','Total scan allowance for '+a.name);section.append(input,button('Set total allowance',async()=>{try{await PokeSiftCloud.api('admin',{action:'allowance',id:a.id,amount:Number(input.value)});message('Allowance updated.');await admin();}catch(e){message(e.message);}}));
        if(a.id!==user.id)section.append(button(a.disabled?'Enable account':'Disable account',async()=>{try{await PokeSiftCloud.api('admin',{action:'disable',id:a.id,disabled:!a.disabled});await admin();}catch(e){message(e.message);}}));host.append(section);
      }
      for(const i of data.invites){const row=document.createElement('p');row.textContent=`Invitation: ${i.uses}/${i.max_uses} places used · expires ${new Date(i.expires_at*1000).toLocaleDateString()}${i.revoked?' · revoked':''}`;if(!i.revoked)row.append(button('Revoke invitation',async()=>{try{await PokeSiftCloud.api('admin',{action:'revoke_invite',id:i.id});await admin();}catch(e){message(e.message);}}));host.append(row);}
    }catch(e){message(e.message);}
  }
  async function show(){try{await refresh();}catch(e){message(e.message);}$('account-view').showModal();}
  async function boot(){
    if(!window.POKESIFT_RUNTIME?.cloud||started)return;started=true;
    const parameters=new URLSearchParams(location.hash.slice(1));const incoming=parameters.get('join');
    if(incoming!==null){history.replaceState(null,'',location.pathname);if(/^[A-Za-z0-9_-]{20,100}$/.test(incoming)){join=incoming;try{sessionStorage.setItem('pokesift.join',join);}catch{}}}
    try{join=join||sessionStorage.getItem('pokesift.join')||'';}catch{}
    setup();
    try{
      await refresh();await PokeSiftCloud.open(user);document.body.dataset.auth='signed-in';window.dispatchEvent(new Event('pokesift:authenticated'));
      if(PokeSiftCloud.hasLegacy()){$('cloud-migration').hidden=false;$('migration-copy').textContent=`This browser has ${PokeSiftCloud.legacy().entries.length} card${PokeSiftCloud.legacy().entries.length===1?'':'s'} from before cloud accounts. Back them up, then bring them into this account. No scans will be used.`;}
      PokeSiftCloud.start();
      if(join){$('join-code').value=join;await show();$('redeem-code').click();}
    }catch(e){signedOut(e.message);}
  }
  window.addEventListener('DOMContentLoaded',boot,{once:true});
  window.addEventListener('pokesift:unauthorized',()=>{if(window.POKESIFT_RUNTIME?.cloud){PokeSiftCloud.stop();signedOut('Your session ended. Sign in again to continue. Local pending changes are retained for this account.');}});
  return {get user(){return user;},refresh,show};
})();
