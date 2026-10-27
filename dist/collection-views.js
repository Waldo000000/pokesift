'use strict';
// Collection browsing owns no scan requests. The main app remains the sole
// writer of entries, valuations, photos, and the arrangement saved with them.
(() => {
  const species=window.POKESIFT_SPECIES,byId=new Map(species.map(p=>[p.id,p]));
  const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/♀/g,' female ').replace(/♂/g,' male ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const aliases=new Map();for(const p of species)for(const name of [p.name,...p.aliases])aliases.set(normalize(name),p.id);
  const known=[...aliases].sort((a,b)=>b[0].length-a[0].length);
  let mode='grid',engine=null,lastSnapshot='',artLoading=false;
  const artwork=new Map(),failedArt=new Set();
  const placeholder='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="65" fill="#dce5d2" stroke="#8b9d7b" stroke-width="3"/><path d="M63 128h130" stroke="#8b9d7b" stroke-width="3"/><circle cx="128" cy="128" r="23" fill="#eff2e9" stroke="#8b9d7b" stroke-width="3"/></svg>');
  function detect(name){const text=normalize(name);if(aliases.has(text))return [aliases.get(text)];let remaining=' '+text+' ',found=[];for(const [alias,id] of known){if(alias.length<2)continue;const latin=/^[a-z0-9 ]+$/.test(alias),needle=latin?' '+alias+' ':alias;if(remaining.includes(needle)){found.push(id);remaining=remaining.split(needle).join(' ');}}return [...new Set(found)].slice(0,6);}
  function speciesOf(e){if(Array.isArray(e.pokemonSpeciesIds))return e.pokemonSpeciesIds.filter(id=>byId.has(id));const card=cardOf(e)||{},read=readOf(e);if(/trainer|energy/i.test(card.supertype||''))return [];if(read.game&&String(read.game).toLowerCase()!=='pokemon')return [];const dex=card.nationalPokedexNumbers||card.national_pokedex_numbers;if(Array.isArray(dex)){const valid=dex.map(Number).filter(id=>byId.has(id));if(valid.length)return [...new Set(valid)];}return detect(identityOf(e).name);}
  function sanitizeLayout(value,ids=entries.map(e=>e.id)){
    const valid=new Set(ids),seen=new Set(),source=value&&typeof value==='object'?value:{};
    const slots=(Array.isArray(source.slots)?source.slots:[]).slice(0,10080).map(k=>{if(valid.has(k)&&!seen.has(k)){seen.add(k);return k;}return null;});while(slots.length<180||slots.length%18)slots.push(null);
    const piles=[0,1].map(i=>(Array.isArray(source.piles?.[i])?source.piles[i]:[]).filter(k=>{if(valid.has(k)&&!seen.has(k)){seen.add(k);return true;}return false;}));for(const id of ids)if(!seen.has(id))piles[0].push(id);
    const positions=Object.create(null);for(const [key,p] of Object.entries(source.positions||{}))if(byId.has(Number(key))&&Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100))positions[key]=[...p];
    return {version:1,slots,piles,positions};
  }
  function snapshot(){
    const cards=entries.map(e=>{const ids=speciesOf(e),p=byId.get(ids[0]),card=cardOf(e)||{},price=mainPrice(e);return {key:e.id,id:ids[0]||0,speciesIds:ids,name:String(titleOf(e)),set:String(identityOf(e).set||statusOf(e)),edition:[identityOf(e).number,card.suggested_printing||readOf(e).finish].filter(Boolean).join(' · '),type:p?.types[0]||'Unclassified',value:price?audAmount(price):null,valueLabel:valueLabel(e),image:e.canonicalImage||e.thumbnail||placeholder,status:statusOf(e),foilData:window.PokeSiftCardDetails?.describe(e),source:e.catalogMatch?'PikaQian':e.canonicalImage?'TCGPlayer':'Your photo',createdAt:e.createdAt||''};});
    const owned=new Set(cards.flatMap(c=>c.speciesIds)),pokemon=species.filter(p=>owned.has(p.id)).map(p=>({...p,type:p.types[0]||'Unclassified',value:null})),art={};for(const p of pokemon)art['pokemon-'+p.id]=artwork.get(p.id)||placeholder;
    collectionViews=sanitizeLayout(collectionViews);
    return {cards,pokemon,art,layout:structuredClone(collectionViews),readOnly:readOnlyStorage,unclassified:cards.filter(c=>!c.speciesIds.length).map(c=>({key:c.key,name:c.name})),fx:fxLabel(),artUnavailable:pokemon.filter(p=>failedArt.has(p.id)).length};
  }
  function refresh(){if(mode==='grid'||!engine)return;const data=snapshot(),fingerprint=JSON.stringify(data);if(fingerprint!==lastSnapshot){lastSnapshot=fingerprint;engine.update(data);}if(mode==='zoo')ensureArtwork(data.pokemon.map(p=>p.id));}
  async function ensureArtwork(ids){if(artLoading)return;const queue=ids.filter(id=>!artwork.has(id)&&!failedArt.has(id));if(!queue.length)return;artLoading=true;try{while(queue.length&&mode==='zoo'){await Promise.all(queue.splice(0,2).map(async id=>{try{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),16000);let response;try{response=await fetch('/api/pokemon-art?id='+id,{credentials:'same-origin',signal:controller.signal,cache:'force-cache'});}finally{clearTimeout(timeout);}if(!response.ok)throw Error();const blob=await response.blob();if(blob.size>2*1024*1024||blob.type!=='image/png')throw Error();const data=await PokeSiftPhotos.dataURL(blob);artwork.set(id,data);}catch{failedArt.add(id);}}));if(mode==='zoo'&&engine){lastSnapshot='';refresh();}}}finally{artLoading=false;if(mode==='zoo'&&engine)refresh();}}
  function select(next){if(!['grid','binder','desk','zoo'].includes(next))return;mode=next;engine=null;lastSnapshot='';for(const b of document.querySelectorAll('[data-collection-view]')){b.classList.toggle('active',b.dataset.collectionView===mode);b.setAttribute('aria-pressed',String(b.dataset.collectionView===mode));}
    $('grid-browsing').hidden=mode!=='grid';$('immersive-browsing').hidden=mode==='grid';document.body.dataset.collectionView=mode;
    const previous=$('collection-room'),frame=previous.cloneNode();frame.removeAttribute('src');previous.replaceWith(frame);if(mode==='grid')return;frame.title={binder:'Your card binder',desk:'Your card fan',zoo:'Your Pokémon Zoo'}[mode];frame.src='/collection-room.html#'+mode;
  }
  window.PokeSiftRoomBridge={
    open:()=>({theme:mode,...snapshot()}),
    ready(api){engine=api;lastSnapshot='';refresh();},
    saveLayout(value){if(readOnlyStorage)return false;collectionViews=sanitizeLayout(value);save();return true;},
    detail(id){if(entries.some(e=>e.id===id))openDetail(id);},
    focusRoom(){ $('collection-room').scrollIntoView({block:'center',behavior:'instant'}); },
    notice:notify,
    retryArtwork(){failedArt.clear();refresh();},
    valid:()=>document.body.dataset.auth==='signed-in'&&mode!=='grid'
  };
  window.PokeSiftViews={refresh,sanitizeLayout,speciesOf,detect,select};
  for(const button of document.querySelectorAll('[data-collection-view]'))button.onclick=()=>select(button.dataset.collectionView);
  window.addEventListener('pokesift:unauthorized',()=>select('grid'));
  // Species corrections are explicit user metadata and travel with the entry.
  const names=$('pokemon-species-list');for(const p of species){const option=document.createElement('option');option.value=p.name;names.append(option);}
  $('save-pokemon-species').onclick=()=>{const e=entries.find(e=>e.id===focusedId);if(!e||readOnlyStorage)return;const tokens=$('pokemon-species').value.split(',').map(s=>s.trim()).filter(Boolean),ids=[];for(const name of tokens){const id=aliases.get(normalize(name));if(!id){$('pokemon-species-status').textContent='Choose a species name from the suggestions. Separate multiple Pokémon with commas.';return;}ids.push(id);}e.pokemonSpeciesIds=[...new Set(ids)];save();render();$('pokemon-species-status').textContent='Saved for your Zoo. No scan used.';};
  $('reset-pokemon-species').onclick=()=>{const e=entries.find(e=>e.id===focusedId);if(!e||readOnlyStorage)return;delete e.pokemonSpeciesIds;save();render();};
  window.PokeSiftViews.renderSpecies=e=>{const ids=speciesOf(e);$('pokemon-species').value=ids.map(id=>byId.get(id)?.name).filter(Boolean).join(', ');$('pokemon-species-status').textContent=Array.isArray(e.pokemonSpeciesIds)?'Your species selection. An empty selection excludes this card from the Zoo.':ids.length?'Detected from saved identification. Correct it here if needed.':'No species identified yet. Choose the Pokémon on this card to include it in your Zoo.';$('save-pokemon-species').disabled=$('reset-pokemon-species').disabled=readOnlyStorage;};
})();
