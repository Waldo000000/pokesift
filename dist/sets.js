'use strict';
// A read-only catalog. Saved entries and scans remain owned by app.js.
window.PokeSiftSets=(()=>{
  const $=id=>document.getElementById(id),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const number=s=>String(s||'').split('/')[0].trim().toUpperCase().replace(/\b0+(?=\d)/g,'').replace(/([A-Z])0+(?=\d)/g,'$1');
  const cardName=s=>norm(String(s||'').replace(/\s*[-–]\s*[A-Z]*\d+\s*\/\s*[A-Z]*\d+\s*$/i,''));
  let index=null,indexPromise=null,active=false,seriesId='',setId='',other=false,allCards=[],rows=[],selection='',revision=0,filter='all',query='',fingerprint='';
  const lists=new Map(),pending=new Map(),names=new Map(),byId=new Map(),art=new Map(),imageQueue=[];
  const ownership=new Map();
  let imageJobs=0,observer=null,detailGeneration=0,detailCard=null,highlightTimer=0;
  async function api(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetch(path,{credentials:'same-origin',signal:controller.signal});if(!r.ok)throw Error(r.status===401?'Sign in again to open the catalog.':'The catalog is temporarily unavailable. Try again.');return await r.json();}finally{clearTimeout(timer);}}
  const params=(s,c)=>'?set='+encodeURIComponent(s)+(c?'&card='+encodeURIComponent(c):'');
  async function ensureIndex(){
    if(index)return index;if(indexPromise)return indexPromise;
    indexPromise=api('/api/set-catalog').then(value=>{
      if(value?.version!==1||value.language!=='en'||!Array.isArray(value.sets)||!Array.isArray(value.series))throw Error('The catalog could not be opened.');
      index=value;
      for(const s of index.sets){byId.set(s.id,s);const variants=[s.name,s.id];for(const v of variants){const key=norm(v);names.set(key,names.has(key)&&names.get(key)!==s.id?null:s.id);}}
      return index;
    }).finally(()=>{indexPromise=null;});return indexPromise;
  }
  async function list(id){
    if(lists.has(id))return lists.get(id);if(pending.has(id))return pending.get(id);
    const p=api('/api/set-catalog'+params(id)).then(value=>{if(value.id!==id||!Array.isArray(value.cards))throw Error('The card list could not be opened.');lists.set(id,value);while(lists.size>24)lists.delete(lists.keys().next().value);return value;}).finally(()=>pending.delete(id));pending.set(id,p);return p;
  }
  function entrySet(e){
    if(!index||e.status!=='matched'||e.catalogMatch)return null;
    const c=cardOf(e)||{},r=readOf(e),language=norm(r.language||c.language);
    if(!['en','english'].includes(language)||r.game&&norm(r.game)!=='pokemon')return null;
    const source=c.set||{},explicit=source.tcgdex_id||c.tcgdex_set_id;
    if(explicit&&byId.has(explicit))return byId.get(explicit);
    const name=identityOf(e).set||'',variants=[name,...name.split(':').map((_,i,a)=>a.slice(i+1).join(':'))].filter(Boolean);
    const found=new Set(variants.map(v=>names.get(norm(v))).filter(Boolean));
    return found.size===1?byId.get([...found][0]):null;
  }
  function matches(e,s,c){
    if(entrySet(e)?.id!==s.id)return false;
    const saved=cardOf(e)||{};
    if(saved.provider==='tcgdex'&&saved.provider_id===c.id||saved.tcgdex_id===c.id)return true;
    // Reprint ordering IDs can differ from physical collector numbers.
    if(s.id==='30th-c')return false;
    return number(identityOf(e).number)===number(c.localId)&&cardName(identityOf(e).name)===cardName(c.name);
  }
  function indexOwnership(){ownership.clear();for(const e of entries){const s=entrySet(e);if(!s)continue;const c=cardOf(e)||{},keys=[];if(c.tcgdex_id||c.provider==='tcgdex'&&c.provider_id)keys.push(s.id+'|id|'+(c.tcgdex_id||c.provider_id));if(s.id!=='30th-c')keys.push(s.id+'|number|'+number(identityOf(e).number)+'|'+cardName(identityOf(e).name));for(const key of keys){if(!ownership.has(key))ownership.set(key,[]);ownership.get(key).push(e);}}}
  function owners(row){const found=new Set();for(const ref of row.refs){const keys=[ref.setId+'|id|'+ref.id];if(ref.setId!=='30th-c')keys.push(ref.setId+'|number|'+number(ref.localId)+'|'+cardName(ref.name));for(const key of keys)for(const e of ownership.get(key)||[])found.add(e);}return [...found];}
  function buildRows(){
    const byArtwork=new Map();rows=[];indexOwnership();
    for(const c of allCards){const key=(c.image||c.id)+'|'+number(c.localId)+'|'+cardName(c.name),existing=byArtwork.get(key);if(existing){existing.refs.push(c);continue;}const row={...c,refs:[c]};byArtwork.set(key,row);rows.push(row);}
    for(const row of rows)row.owned=owners(row);
  }
  function makeSelect(label,id){const wrapper=el('label','set-select-label'),s=el('select');s.id=id;s.setAttribute('aria-label',label);wrapper.append(el('span','sr-only',label),s);return [wrapper,s];}
  function status(text,error=false){$('sets-status').textContent=text;$('sets-status').classList.toggle('set-error',error);$('sets-retry').hidden=!error;}
  function renderSeries(){
    const s=$('sets-series');s.replaceChildren();for(const group of index.series){const o=el('option','',group.name+(group.kind==='Special releases'?' · special releases':''));o.value=group.id;s.append(o);}s.value=seriesId;
    $('sets-other').checked=other;renderRail();
  }
  function renderRail(){
    const rail=$('sets-rail');rail.replaceChildren();
    const sets=index.sets.filter(s=>s.seriesId===seriesId&&!s.parentId&&(other?s.kind!=='Expansion':s.kind==='Expansion'));
    for(const s of sets){const b=el('button','set-tile'+(s.id===setId?' active':''));b.type='button';b.dataset.setId=s.id;b.setAttribute('aria-pressed',String(s.id===setId));b.append(el('strong','',s.name),el('small','',s.kind==='Expansion'?`${s.total} catalog cards`:s.kind+` · ${s.total}`));b.onclick=()=>choose(s.id);rail.append(b);}
    if(!sets.length)rail.append(el('p','fineprint','No '+(other?'other releases':'expansions')+' in this group. Try '+(other?'Expansions':'Other releases')+'.'));
    rail.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function renderGroups(){
    const group=$('sets-groups');group.replaceChildren();const parent=byId.get(setId),children=index.sets.filter(s=>s.parentId===setId);
    if(!children.length){group.hidden=true;return;}group.hidden=false;
    for(const [id,name] of [['all','All cards'],[setId,parent.name],...children.map(c=>[c.id,c.name])]){const b=el('button','',name);b.type='button';b.dataset.setGroup=id;b.setAttribute('aria-pressed',String(selection===id));b.onclick=()=>{selection=id;filter='all';$('sets-filter').value=filter;renderGrid();$('sets-card-scroll').scrollTop=0;};group.append(b);}
  }
  function visibleRows(){return rows.filter(c=>(selection==='all'||c.refs.some(ref=>ref.setId===selection))&&(filter==='all'||(filter==='owned'?c.owned.length:!c.owned.length))&&(!query||norm(c.name+' '+c.localId).includes(norm(query))));}
  function renderGrid(){
    const grid=$('sets-grid'),focus=document.activeElement?.dataset.catalogCard;observer?.disconnect();imageQueue.length=0;grid.replaceChildren();
    const groupRows=rows.filter(c=>selection==='all'||c.refs.some(ref=>ref.setId===selection)),owned=groupRows.filter(c=>c.owned.length).length;
    $('sets-progress').textContent=`${owned} / ${groupRows.length} collected`;$('sets-meter').max=groupRows.length||1;$('sets-meter').value=owned;
    $('sets-filter').value=filter;
    for(const row of visibleRows()){
      const b=el('button','set-card'+(row.owned.length?' owned':' missing'));b.type='button';b.dataset.catalogCard=row.id;b.dataset.setId=row.setId;
      b.setAttribute('aria-label',`${row.name}, ${row.setName}, ${row.localId}, ${row.owned.length?row.owned.length+' saved '+(row.owned.length===1?'copy':'copies'):'not collected'}`);
      const artBox=el('span','set-art'),im=el('img');im.alt='';im.decoding='async';im.hidden=true;const placeholder=el('span','set-art-placeholder',row.hasImage?'Loading artwork…':'Artwork unavailable');artBox.append(placeholder,im);b.append(artBox,el('span','set-card-number',row.localId+(row.owned.length?' · ✓ '+row.owned.length:'')),el('span','set-card-name',row.name));
      b.onclick=()=>{if(row.owned.length)openDetail(row.owned[0].id);else openCatalog(row);};grid.append(b);
      const savedArt=row.owned.find(e=>/^data:image\/(?:jpeg|png|webp);base64,/.test(e.canonicalImage||''))?.canonicalImage;
      if(savedArt){im.src=savedArt;im.hidden=false;placeholder.hidden=true;}else if(row.hasImage)observeImage(b,im,placeholder,row);
    }
    $('sets-empty').hidden=grid.childElementCount!==0;
    $('sets-empty').textContent=query?'No cards match this search.':filter==='missing'?'You have every catalog card in this view.':filter==='owned'?'No confirmed English printings saved in this view yet.':'No cards in this view.';
    renderGroups();if(focus)grid.querySelector(`[data-catalog-card="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  function observeImage(button,im,placeholder,row){
    const job={im,placeholder,row,button};button.imageJob=job;
    if(!observer)observer=new IntersectionObserver(changes=>{for(const change of changes)if(change.isIntersecting){observer.unobserve(change.target);const job=change.target.imageJob;if(job)imageQueue.push(job);}pumpImages();},{root:$('sets-card-scroll'),rootMargin:'180px'});
    observer.observe(button);
  }
  async function artwork(row,quality='low'){
    const key=row.setId+'/'+row.id+'/'+quality;if(art.has(key)){const item=art.get(key);art.delete(key);art.set(key,item);return item;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const r=await fetch('/api/set-art'+params(row.setId,row.id)+'&quality='+quality,{credentials:'same-origin',signal:controller.signal,cache:'force-cache'});if(!r.ok)throw Error();const blob=await r.blob();if(blob.type!=='image/webp'||blob.size>2*1024*1024)throw Error();const url=URL.createObjectURL(blob);art.set(key,url);while(art.size>96){const first=art.keys().next().value;URL.revokeObjectURL(art.get(first));art.delete(first);}return url;}finally{clearTimeout(timer);}
  }
  function pumpImages(){while(imageJobs<3&&imageQueue.length&&active){const job=imageQueue.shift();if(!job.im.isConnected)continue;imageJobs++;artwork(job.row).then(url=>{if(!job.im.isConnected)return;job.im.src=url;job.im.hidden=false;job.placeholder.hidden=true;}).catch(()=>{if(job.placeholder.isConnected)job.placeholder.textContent='Artwork unavailable';}).finally(()=>{imageJobs--;pumpImages();});}}
  async function choose(id,targetEntry=null){
    const current=++revision;setId=id;selection='all';filter='all';query='';$('sets-search').value='';allCards=[];rows=[];fingerprint='';$('sets-grid').replaceChildren();$('sets-groups').hidden=true;$('sets-title').textContent=byId.get(id)?.name||'Sets';$('sets-progress').textContent='';$('sets-empty').hidden=true;$('sets-meter').value=0;$('sets-card-scroll').scrollTop=0;$('sets-card-scroll').setAttribute('aria-busy','true');status('Opening set…');renderRail();
    try{
      // Separate subset records are included once; shared artwork IDs deduplicate
      // subsets already embedded in a parent list.
      const main=await list(id),children=index.sets.filter(s=>s.parentId===id),parts=await Promise.allSettled(children.map(s=>list(s.id))),values=[main,...parts.filter(p=>p.status==='fulfilled').map(p=>p.value)],unavailable=parts.filter(p=>p.status==='rejected').length;if(current!==revision)return;
      allCards=values.flatMap(s=>s.cards.map(c=>({...c,setId:s.id,setName:s.name})));buildRows();fingerprint=entryFingerprint();renderGrid();
      status(unavailable?'Some subset cards are temporarily unavailable. The main set is shown.':values.some(s=>s.stale)?'Showing a cached catalog. No scans used.':'',Boolean(unavailable));$('sets-card-scroll').removeAttribute('aria-busy');
      if(targetEntry){const row=rows.find(c=>c.refs.some(ref=>matches(targetEntry,byId.get(ref.setId),ref)));if(row)highlight(row.id);else status('This set is open, but the saved printing could not be matched confidently.');}
    }catch(e){if(current!==revision)return;status(e.message,true);$('sets-card-scroll').removeAttribute('aria-busy');}
  }
  function highlight(id){const b=$('sets-grid').querySelector(`[data-catalog-card="${CSS.escape(id)}"]`);if(!b)return;clearTimeout(highlightTimer);for(const n of $('sets-grid').querySelectorAll('.in-context')){n.classList.remove('in-context');n.removeAttribute('aria-current');}b.classList.add('in-context');b.setAttribute('aria-current','true');b.scrollIntoView({block:'center',behavior:'instant'});b.focus({preventScroll:true});highlightTimer=setTimeout(()=>{b.classList.remove('in-context');b.removeAttribute('aria-current');},12000);}
  async function show(){active=true;try{status('Opening catalog…');await ensureIndex();if(!active)return;if(!seriesId){const savedSet=entrySet(entries.find(e=>entrySet(e))||{}),savedParent=byId.get(savedSet?.parentId)||savedSet;seriesId=savedParent?.seriesId||index.series[0].id;renderSeries();const first=savedParent||index.sets.find(s=>s.seriesId===seriesId&&!s.parentId&&s.kind==='Expansion')||index.sets.find(s=>s.seriesId===seriesId&&!s.parentId);other=first?.kind!=='Expansion';renderSeries();if(first)await choose(first.id);}else{renderSeries();refresh();status('');pumpImages();}}catch(e){status(e.message,true);}}
  function hide(){active=false;imageQueue.length=0;}
  const entryFingerprint=()=>JSON.stringify(entries.map(e=>[e.id,e.status,identityOf(e),readOf(e).language,Boolean(e.catalogMatch),cardOf(e)?.tcgdex_id]));
  function refresh(){if(!active||!rows.length)return;const next=entryFingerprint();if(next===fingerprint)return;fingerprint=next;indexOwnership();for(const row of rows)row.owned=owners(row);renderGrid();}
  async function fromEntry(e){
    try{await ensureIndex();const s=entrySet(e);if(!s)return;const parent=byId.get(s.parentId)||s;seriesId=parent.seriesId;other=parent.kind!=='Expansion';$('detail-view').close();PokeSiftViews.select('sets');renderSeries();await choose(parent.id,e);}catch(error){notify(error.message);}
  }
  async function updateDetail(e){
    const link=$('detail-view-set'),copies=$('detail-set-copies');if(!link)return;link.hidden=true;copies.hidden=true;
    try{await ensureIndex();if(focusedId!==e.id)return;const s=entrySet(e);if(!s)return;link.hidden=false;link.onclick=()=>fromEntry(e);
      const matchesHere=entries.filter(other=>entrySet(other)?.id===s.id&&number(identityOf(other).number)===number(identityOf(e).number)&&cardName(identityOf(other).name)===cardName(identityOf(e).name));
      if(matchesHere.length>1){copies.hidden=false;copies.replaceChildren();matchesHere.forEach((copy,i)=>{const o=el('option','',`Copy ${i+1} · ${cardOf(copy)?.suggested_printing||readOf(copy).finish||'finish unspecified'}`);o.value=copy.id;copies.append(o);});copies.value=e.id;copies.onchange=()=>openDetail(copies.value);}
    }catch{/* The saved card stays usable if the optional set catalog is offline. */}
  }
  function detailFields(card,row){
    const copy=$('set-catalog-copy');copy.replaceChildren(el('p','set-catalog-ownership','Not in your collection'),el('h3','',row.setName),el('p','fineprint',[card.rarity,card.category,card.hp?card.hp+' HP':'',...(Array.isArray(card.types)?card.types:[])].filter(Boolean).join(' · ')));
    if(byId.get(row.setId)?.id==='30th-c')copy.append(el('p','fineprint','Classic Collection · catalog position '+row.localId+'. The original printed collector number may differ.'));else copy.append(el('p','fineprint','Card '+row.localId+' · English'));
    for(const item of [...(Array.isArray(card.abilities)?card.abilities:[]),...(Array.isArray(card.attacks)?card.attacks:[])]){copy.append(el('h3','',item.name||''),el('p','',[item.effect,item.damage].filter(Boolean).join(' · ')));}
    if(card.description||card.effect)copy.append(el('p','',card.description||card.effect));
    if(card.illustrator)copy.append(el('p','fineprint','Illustrated by '+card.illustrator));
    if(card.stale)copy.append(el('p','notice','Full card information is temporarily unavailable. Showing saved catalog details.'),retryButton(()=>openCatalog(row),'Try card information again'));
    const actions=el('div','set-catalog-actions'),context=el('button','primary','Show in set');context.onclick=()=>{$('set-catalog-detail').close();highlight(row.id);};actions.append(context);copy.append(actions,el('p','fineprint','Catalog: TCGdex · one checklist place per catalog card. Foil variants are not counted separately.'));
  }
  function retryButton(run,label='Try again'){const b=el('button','text-button',label);b.type='button';b.onclick=run;return b;}
  async function openCatalog(row){
    const dialog=$('set-catalog-detail'),generation=++detailGeneration;detailCard=row;$('set-catalog-title').textContent=row.name;$('set-catalog-subtitle').textContent=row.setName+' · '+row.localId;$('set-catalog-image').hidden=true;$('set-catalog-art-status').hidden=false;$('set-catalog-art-status').textContent=row.hasImage?'Loading artwork…':'Catalog artwork is not yet available.';detailFields(row,row);
    if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
    if(row.hasImage)artwork(row,'high').then(url=>{if(generation!==detailGeneration||!dialog.open)return;$('set-catalog-image').src=url;$('set-catalog-image').hidden=false;$('set-catalog-art-status').hidden=true;}).catch(()=>{if(generation===detailGeneration)$('set-catalog-art-status').textContent='Artwork is temporarily unavailable.';});
    try{const card=await api('/api/set-card'+params(row.setId,row.id));if(generation===detailGeneration&&dialog.open)detailFields(card,row);}catch{if(generation===detailGeneration&&dialog.open)detailFields({...row,stale:true},row);}
  }
  function boot(){
    const section=$('sets-browsing');
    const toolbar=el('div','sets-series-row'),[label,select]=makeSelect('Series','sets-series');toolbar.append(label);const otherLabel=el('label','sets-other'),checkbox=el('input');checkbox.type='checkbox';checkbox.id='sets-other';otherLabel.append(checkbox,document.createTextNode('Other releases'));toolbar.append(otherLabel);
    select.onchange=()=>{seriesId=select.value;other=false;$('sets-other').checked=false;renderRail();const first=index.sets.find(s=>s.seriesId===seriesId&&!s.parentId&&s.kind==='Expansion');if(first)choose(first.id);else{other=true;$('sets-other').checked=true;renderRail();const release=index.sets.find(s=>s.seriesId===seriesId&&!s.parentId);if(release)choose(release.id);}};
    checkbox.onchange=()=>{other=checkbox.checked;renderRail();};
    const rail=el('div','sets-rail');rail.id='sets-rail';rail.setAttribute('aria-label','Choose a set');
    const summary=el('div','sets-summary'),title=el('h2');title.id='sets-title';title.textContent='Sets';const progress=el('p');progress.id='sets-progress';const meter=el('progress');meter.id='sets-meter';meter.setAttribute('aria-label','Set completion');summary.append(title,progress,meter);
    const controls=el('div','sets-controls'),search=el('input');search.type='search';search.id='sets-search';search.placeholder='Find a card…';search.setAttribute('aria-label','Find a card in this set');search.oninput=()=>{query=search.value;renderGrid();};const [filterLabel,filterSelect]=makeSelect('Cards shown','sets-filter');for(const [id,label] of [['all','All cards'],['missing','Missing'],['owned','Collected']]){const o=el('option','',label);o.value=id;filterSelect.append(o);}filterSelect.onchange=()=>{filter=filterSelect.value;renderGrid();};controls.append(search,filterLabel);
    const groups=el('div','sets-groups');groups.id='sets-groups';groups.hidden=true;groups.setAttribute('aria-label','Set sections');const notice=el('div','sets-notice'),statusNode=el('p');statusNode.id='sets-status';statusNode.setAttribute('role','status');const retry=retryButton(()=>{if(index&&setId)choose(setId);else show();});retry.id='sets-retry';retry.hidden=true;notice.append(statusNode,retry);
    const scroller=el('div','sets-card-scroll');scroller.id='sets-card-scroll';const grid=el('div','sets-grid');grid.id='sets-grid';grid.setAttribute('aria-label','Cards in this set');const empty=el('p','sets-empty');empty.id='sets-empty';empty.hidden=true;scroller.append(grid,empty);
    const note=el('p','sets-footnote','English catalog · confirmed printings only · finish variants share a checklist place.');section.append(toolbar,rail,summary,controls,groups,notice,scroller,note);
    const link=el('button','detail-view-set','View set →');link.id='detail-view-set';link.type='button';link.hidden=true;$('detail-set').after(link);const copies=el('select','detail-set-copies');copies.id='detail-set-copies';copies.setAttribute('aria-label','Choose your saved copy');copies.hidden=true;link.after(copies);
    const dialog=$('set-catalog-detail');$('close-set-catalog').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{detailGeneration++;if(detailCard)document.querySelector(`[data-catalog-card="${CSS.escape(detailCard.id)}"]`)?.focus({preventScroll:true});});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});PokeSiftWorkspace.enableFlickToDismiss(dialog);
    window.addEventListener('pokesift:unauthorized',()=>{dialog.close();for(const url of art.values())URL.revokeObjectURL(url);art.clear();hide();});
  }
  window.addEventListener('DOMContentLoaded',boot,{once:true});
  return {show,hide,refresh,updateDetail,entrySet,matches};
})();
