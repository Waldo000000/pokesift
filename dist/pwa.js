'use strict';
// Installation is always requested by a tap. It does not change sign-in,
// upload queues, account permissions, collection storage or scan allowances.
(()=>{
  let prompt=null,installedHere=false,prompting=false,registrationFailed=false;
  const standalone=matchMedia('(display-mode: standalone)'),$=id=>document.getElementById(id);
  const installed=()=>installedHere||standalone.matches||navigator.standalone===true;
  const apple=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=()=>/Android/i.test(navigator.userAgent);
  function render(){
    if(!$('install-view'))return;
    const isInstalled=installed();
    $('install-app').textContent=isInstalled?'PokéSift is installed':'Install PokéSift';
    $('install-from-signin').hidden=isInstalled;
    $('install-app-note').textContent=isInstalled?'Open PokéSift from your home screen.':'Add an app icon to this device.';
    $('install-now').hidden=isInstalled||!prompt||apple();$('install-now').disabled=prompting;
    $('install-intro').textContent=isInstalled?'You’re ready. PokéSift opens in its own app window.':'Your cards, one tap from your home screen.';
    $('install-instructions').hidden=isInstalled;
    const steps=apple()?[
      'Open PokéSift in Safari, then tap Share (the square with an upward arrow).',
      'Choose Add to Home Screen. You may need More or View More to find it.',
      'Turn on Open as Web App if shown, then tap Add.'
    ]:android()?[
      'Tap Install below when it is available, or open Chrome’s ⋮ menu.',
      'Choose Add to Home screen or Install app, then confirm Install.',
      'Open PokéSift from the new icon on your home screen.'
    ]:[
      'Use Install below when it is available, or your browser’s install icon or menu.',
      'Choose Install PokéSift (or Install app) and confirm.',
      'On iPad, open this page in Safari and use Share → Add to Home Screen.'
    ];
    $('install-instructions').replaceChildren(...steps.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
    $('install-account-note').textContent=window.POKESIFT_RUNTIME?.cloud?'Sign in with your usual Google account in the installed app to sync your collection.':'Pair the installed app with a device invite. To move a device-only collection, export a backup in the original browser and import it in the app.';
    if(registrationFailed)$('install-status').textContent='Installation setup could not finish. Check your connection, reload PokéSift, and try again. You can keep using the browser.';
  }
  function open(){window.PokeSiftWorkspace?.closeTools();$('install-status').textContent='';render();if(!$('install-view').open)$('install-view').showModal();}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;render();});
  window.addEventListener('appinstalled',()=>{installedHere=true;prompt=null;render();if($('install-status'))$('install-status').textContent='PokéSift is installed. Look for its icon on your home screen or in your apps.';});
  standalone.addEventListener('change',render);
  window.addEventListener('DOMContentLoaded',()=>{
    const dialog=document.createElement('dialog');dialog.id='install-view';dialog.className='install-dialog';dialog.setAttribute('aria-labelledby','install-title');
    dialog.innerHTML='<header class="dialog-toolbar"><h2 id="install-title">Install PokéSift</h2><button id="close-install" class="round-button" aria-label="Close installation help">×</button></header><div class="install-content"><img class="install-icon" src="/icons/app-192.png" width="72" height="72" alt=""><p id="install-intro"></p><ol id="install-instructions"></ol><button id="install-now" class="primary" hidden>Install PokéSift</button><p id="install-status" role="status" aria-live="polite"></p><p id="install-account-note" class="fineprint"></p><p class="fineprint">Scanning and syncing need an internet connection.</p></div>';
    document.body.append(dialog);
    const section=document.createElement('section');section.className='tool-group install-tool';
    const heading=document.createElement('h3');heading.textContent='On this device';
    const button=document.createElement('button');button.id='install-app';button.className='text-button';button.type='button';button.onclick=open;
    const note=document.createElement('p');note.id='install-app-note';note.className='fineprint';section.append(heading,button,note);document.querySelector('#workspace-tools .tools-content').prepend(section);
    const signin=document.createElement('button');signin.id='install-from-signin';signin.type='button';signin.className='text-button';signin.textContent='Install PokéSift';signin.onclick=open;$('pairing-view').append(signin);
    $('close-install').onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
    $('install-now').onclick=async()=>{
      if(!prompt||prompting||installed())return;
      const choice=prompt;prompt=null;prompting=true;render();
      try{await choice.prompt();const result=await choice.userChoice;$('install-status').textContent=result.outcome==='accepted'?'Follow your browser’s confirmation to finish installing PokéSift.':'Installation was dismissed. You can install later from your browser menu.';}
      catch{$('install-status').textContent='Use your browser’s install menu, or follow the steps above.';}
      finally{prompting=false;render();}
    };
    render();
    if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{registrationFailed=true;render();});
  },{once:true});
})();
