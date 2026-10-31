'use strict';
// Product layout only. Existing controls keep their handlers, IDs and data.
window.PokeSiftWorkspace=(()=>{
  const $=id=>document.getElementById(id);
  function header(title,close){const h=document.createElement('header');h.className='dialog-toolbar';const t=document.createElement('h2');t.textContent=title;h.append(t,close);return h;}
  function group(title,nodes){const section=document.createElement('section');section.className='tool-group';const h=document.createElement('h3');h.textContent=title;section.append(h,...nodes.filter(Boolean));return section;}
  function closeTools(){if($('workspace-tools')?.open)$('workspace-tools').close();}
  function renderDetail(e){if(!$('detail-value-summary'))return;$('detail-value-summary').textContent=valueLabel(e);$('detail-value-basis').textContent=mainPrice(e)?priceBasis(e)||'Catalog estimate · AUD':'No verified price';}
  function boot(){
    document.body.classList.add('workspace-app');
    const top=document.querySelector('.topbar'),actions=document.createElement('div');actions.className='workspace-header-actions';
    const more=document.createElement('button');more.id='workspace-tools-toggle';more.className='workspace-icon-button';more.type='button';more.textContent='•••';more.setAttribute('aria-label','Collection tools');more.title='Collection tools';
    actions.append($('open-camera'));const account=$('account-button');if(account){account.className='workspace-icon-button';account.title='Account';account.setAttribute('aria-label','Account');account.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>';actions.append(account);}actions.append(more);top.append(actions);
    const tools=document.createElement('dialog');tools.id='workspace-tools';tools.className='workspace-tools';tools.setAttribute('aria-labelledby','workspace-tools-title');
    const close=document.createElement('button');close.type='button';close.id='close-workspace-tools';close.className='round-button';close.setAttribute('aria-label','Close collection tools');close.textContent='×';const bar=header('Collection tools',close);bar.querySelector('h2').id='workspace-tools-title';tools.append(bar);
    const content=document.createElement('div');content.className='tools-content';const footer=document.querySelector('.collection-footer');
    const repairs=document.createElement('details');repairs.id='workspace-repairs';repairs.className='tool-group';const repairTitle=document.createElement('summary');repairTitle.textContent='Repair and update';repairs.append(repairTitle,$('bulk-pricing'));
    content.append(group('Collection status',[$('sync-status'),$('saved-note'),document.querySelector('.local-pill')]),group('Backups and devices',[$('export'),$('import-backup'),$('backup-file'),$('add-device'),$('sign-out')]),repairs,group('Preferences',[document.querySelector('.motion-preference'),$('fx-refresh')]));
    const playground=document.createElement('details');playground.className='tool-playground';const summary=document.createElement('summary');summary.textContent='Design playground · sample cards';playground.append(summary,document.querySelector('.prototype-links'));content.append(playground);tools.append(content,footer);document.body.append(tools);more.onclick=()=>tools.showModal();close.onclick=closeTools;
    const backup=$('export').onclick;$('export').onclick=async event=>{await backup(event);closeTools();};
    for(const id of ['import-backup','add-device','sign-out'])$(id).addEventListener('click',closeTools,{capture:true});
    const recovery=document.createElement('button');recovery.id='storage-backup';recovery.type='button';recovery.className='primary';recovery.textContent='Back up now';recovery.onclick=()=>$('export').click();$('storage-warning').after(recovery);
    const zoo=document.querySelector('[data-collection-view="zoo"]');zoo.textContent='Zoo';zoo.setAttribute('aria-label','Pokémon Zoo');
    const detail=$('detail-view'),title=document.createElement('div');title.className='detail-title-group';title.append($('detail-title'),$('detail-set'));
    const detailBar=document.createElement('header');detailBar.className='dialog-toolbar detail-toolbar';detailBar.append(title,$('close-detail'));detail.prepend(detailBar);
    const hero=detail.querySelector('.detail-image'),summaryBox=document.createElement('div');summaryBox.className='detail-summary';
    const value=document.createElement('strong');value.id='detail-value-summary';const basis=document.createElement('small');basis.id='detail-value-basis';summaryBox.append($('detail-badge'),value,basis,$('detail-meta'),$('detail-image-note'),$('toggle-photo'));hero.append(summaryBox);
    const pricing=document.createElement('details');pricing.className='detail-price-breakdown';const priceTitle=document.createElement('summary');priceTitle.textContent='Value and price details';pricing.append(priceTitle,$('valuation-choice-group'),$('detail-prices'),$('valuation-note'));detail.querySelector('.detail-copy').append(pricing);
    const cardActions=document.createElement('details');cardActions.className='detail-card-actions';const actionTitle=document.createElement('summary');actionTitle.textContent='Card actions';cardActions.append(actionTitle,$('remove-card'),$('remove-confirmation'));detail.querySelector('.detail-copy').append(cardActions);
    const copy=detail.querySelector('.detail-copy');copy.append(...[$('detail-message'),$('detail-warnings'),$('identification-review'),$('retry-catalog-image'),$('catalog-image-status'),$('retry-scan'),$('retry-scan-note'),$('retake-card'),$('catalog-enrichment'),pricing,copy.querySelector('.foil-settings'),copy.querySelector('.species-correction'),$('raw-details'),cardActions].filter(Boolean));
    const camera=$('camera-view');camera.querySelector('.camera-header .eyebrow').remove();$('camera-title').textContent='Add cards';camera.querySelector('.camera-header').classList.add('dialog-toolbar');camera.querySelector('.session-title h3').firstChild.textContent='Recent scans ';$('camera-done').lastChild.textContent='Done';
    const accountDialog=$('account-view');if(accountDialog){const accountBar=header('Account',$('close-account'));accountDialog.prepend(accountBar);accountDialog.querySelector('.eyebrow')?.remove();accountDialog.querySelector('details[open]')?.removeAttribute('open');}
    const invite=$('invite-view');invite.prepend(header('Pair another device',$('close-invite')));invite.querySelector('.eyebrow')?.remove();
    for(const dialog of [tools,detail,camera,accountDialog,invite].filter(Boolean)){dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});dialog.addEventListener('close',()=>{const toast=$('toast');if(!toast.hidden&&dialog.contains(toast))document.body.append(toast);});}
  }
  window.addEventListener('DOMContentLoaded',boot,{once:true});
  return {renderDetail,closeTools};
})();
