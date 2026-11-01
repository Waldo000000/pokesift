'use strict';
(() => {
  const bridge=window.parent!==window?window.parent.PokeSiftRoomBridge:null;
  if(!bridge?.valid()){location.replace('/');return;}
  const data=bridge.open();
  window.POKESIFT_ROOM={...data,current:bridge.open,persist:bridge.saveLayout,openDetail:bridge.detail,focusRoom:bridge.focusRoom,notice:bridge.notice,ready:bridge.ready,retryArtwork:bridge.retryArtwork};
  document.body.dataset.theme=data.theme;document.body.classList.add('live-collection');
  document.body.classList.add('room-workspace');
  document.addEventListener('DOMContentLoaded',()=>{
    const $=id=>document.getElementById(id),zoo=data.theme==='zoo',binder=data.theme==='binder';
    const view=$(zoo?'dex-view':'cards-view'),toolbar=document.createElement('div');toolbar.className='room-toolbar';
    const search=$('room-search');search.placeholder=zoo?'Find a Pokémon…':'Find a card…';search.setAttribute('aria-label',zoo?'Search your Pokémon':'Search cards');
    if(binder){const title=document.createElement('span');title.textContent='Your binder';toolbar.append(title);search.hidden=true;}else toolbar.append(search);
    const toggle=document.createElement('button');toggle.id='room-options-toggle';toggle.type='button';toggle.textContent=binder?'Help & options':zoo?'Filter & arrange':'Sort & filter';toggle.setAttribute('aria-label','View options');toolbar.append(toggle);view.prepend(toolbar);
    const dialog=document.createElement('dialog');dialog.id='room-options';dialog.className='room-options';dialog.setAttribute('aria-labelledby','room-options-title');
    const heading=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.id='room-options-title';title.textContent='View options';close.id='close-room-options';close.type='button';close.textContent='Done';heading.append(title,close);dialog.append(heading);
    const group=(label,nodes)=>{const box=document.createElement('section'),h=document.createElement('h3');h.textContent=label;box.append(h,...nodes.filter(Boolean));dialog.append(box);};
    if(!zoo&&!binder)group('Order and card type',[$('sort').parentElement,$('shuffle'),$('card-filters')]);
    if(zoo){group('Pokémon type',[$('dex-filters')]);group('Arrange and share',[document.querySelector('.arrange-pokemon'),$('share-zoo'),$('unclassified-cards'),$('retry-artwork'),$('room-art-status')]);search.oninput=event=>{window.POKESIFT_ROOM.query=event.target.value.trim().toLowerCase();renderDex();};}
    const help=document.createElement('details'),label=document.createElement('summary');label.textContent=binder?'Arranging your binder':'How to browse';help.append(label);const instructions=document.querySelector(binder?'.pile-instructions':zoo?'.habitat-help':'.gesture-hint');if(instructions)help.append(instructions);dialog.append(help);
    const credits=document.querySelector('.shell>footer');credits.querySelector('span').textContent='Artwork credits';dialog.append(credits);document.body.append(dialog);
    toggle.onclick=()=>dialog.showModal();close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
    if(binder){
      const controls=document.createElement('nav');controls.className='binder-focus-controls';controls.setAttribute('aria-label','Binder controls');
      const button=(id,text,label,action)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.title=label;b.onclick=action;controls.append(b);return b;};
      button('binder-back','‹ All cards','Back to all cards',()=>bridge.leaveBinder());
      button('binder-add','＋','Add cards',()=>bridge.addCards());
      const aside=document.querySelector('.binder-aside');aside.id='binder-stacks';
      const stacks=button('binder-stacks-toggle','Stacks','Show card stacks',()=>setStacks(!document.body.classList.contains('binder-stacks-open')));stacks.setAttribute('aria-controls',aside.id);
      function setStacks(open){document.body.classList.toggle('binder-stacks-open',open);stacks.setAttribute('aria-expanded',String(open));stacks.setAttribute('aria-label',open?'Hide card stacks':'Show card stacks');aside.inert=bridge.binderPhone.matches&&!open;}
      function fit(){document.body.classList.toggle('binder-phone-focus',bridge.binderPhone.matches);toggle.textContent=bridge.binderPhone.matches?'⋯':'Help & options';setStacks(false);}
      bridge.binderPhone.addEventListener('change',fit);window.addEventListener('pagehide',()=>bridge.binderPhone.removeEventListener('change',fit),{once:true});
      document.body.append(controls);fit();
    }
    $('unclassified-list').addEventListener('click',event=>{if(event.target.closest('button'))dialog.close();},{capture:true});
    document.querySelector('.arrange-pokemon').addEventListener('click',()=>dialog.close());
    const cardDetail=$('detail');
    window.parent.PokeSiftWorkspace?.enableFlickToDismiss(cardDetail);
    cardDetail.addEventListener('click',event=>{if(event.target!==cardDetail)return;const r=cardDetail.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)cardDetail.close();});
  },{once:true});
})();
