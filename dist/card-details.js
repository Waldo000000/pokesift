'use strict';
(() => {
  const F=window.PokeSiftFoil;
  let renderer=null,fingerprint='';
  const settings=document.createElement('details');settings.className='foil-settings';
  settings.innerHTML='<summary>Card finish & light</summary><label for="visual-finish">Visual finish</label><select id="visual-finish"></select><label for="visual-region">Foil area</label><select id="visual-region"></select><label for="visual-layout">Card layout</label><select id="visual-layout"></select><p id="visual-status" role="status"></p><button id="visual-mask" type="button" aria-pressed="false">Show foil area</button>';
  $('detail-meta').after(settings);
  const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
  $('visual-finish').append(option('auto','Use saved card information'),...Object.values(F.profiles).map(p=>option(p.id,p.label)));
  for(const [key,label] of Object.entries(F.regions))$('visual-region').append(option(key,label));
  for(const [key,layout] of Object.entries(F.layouts))$('visual-layout').append(option(key,layout.label));
  function describe(e){
    const c=cardOf(e)||{},read=readOf(e),identity=identityOf(e),selected=chosenPrice(e);
    // The automatic lowest price is NOT evidence of the physical finish.
    const notes=[c.notes,c.note,read.notes,read.note,e.result?.data?.notes,e.result?.data?.note].flat().filter(n=>typeof n==='string').join(' ').slice(0,2000);
    return {name:identity.name,set:identity.set,number:identity.number,language:languageOf(e),game:read.game||'pokemon',stamp:read.stamp||'',finish:selected?.printing||read.finish||c.suggested_printing||'',suggestedFinish:c.suggested_printing||'',rarity:c.rarity||'',supertype:c.supertype||'',notes,canonical:!!e.canonicalImage,appearance:F.cleanAppearance(e.visualFinish)};
  }
  function render(e){
    const data=describe(e);data.canonical=data.canonical&&!showCapturedPhoto;
    const resolved=F.resolve(data),key=JSON.stringify([e.id,data,$('detail-photo').src]);
    if(!renderer)renderer=F.mount($('detail-tilt'),$('detail-photo'),resolved);
    else if(key!==fingerprint){renderer.update(resolved);renderer.reset();renderer.inspect(false);}
    fingerprint=key;
    $('detail-tilt').classList.toggle('captured-photo',!data.canonical);
    const appearance=F.cleanAppearance(e.visualFinish);
    const automatic=F.resolve({...data,appearance:null});
    $('visual-finish').querySelector('[value="auto"]').textContent='Use saved card information · '+F.profiles[automatic.profile].label;
    $('visual-region').querySelector('[value="auto"]').textContent=appearance?'Use finish default':'Finish default · '+F.regions[resolved.region];
    $('visual-finish').value=appearance?.profile||'auto';$('visual-region').value=appearance?.region||'auto';$('visual-layout').value=appearance?.layout||resolved.layout;
    $('visual-finish').disabled=readOnlyStorage||!data.canonical;
    $('visual-region').disabled=$('visual-layout').disabled=readOnlyStorage||!data.canonical||!appearance;
    $('visual-mask').disabled=!renderer.hasMask;$('visual-mask').setAttribute('aria-pressed',String($('detail-tilt').classList.contains('inspect-foil')));
    $('visual-status').textContent=resolved.note+(resolved.profile!=='matte'&&!renderer.hasMask?' This area needs a mapped printing or a layout with an artwork window.':'');
  }
  function saveAppearance(){
    const e=entries.find(e=>e.id===focusedId);if(!e||readOnlyStorage||!e.canonicalImage||showCapturedPhoto)return;
    if($('visual-finish').value==='auto')delete e.visualFinish;
    else e.visualFinish=F.cleanAppearance({version:1,profile:$('visual-finish').value,region:$('visual-region').value,layout:$('visual-layout').value});
    save();window.PokeSiftViews?.refresh();render(e);
  }
  for(const id of ['visual-finish','visual-region','visual-layout'])$(id).onchange=saveAppearance;
  $('visual-mask').onclick=()=>{const on=$('visual-mask').getAttribute('aria-pressed')!=='true';renderer?.inspect(on);$('visual-mask').setAttribute('aria-pressed',String(on));};
  $('detail-view').addEventListener('close',()=>{renderer?.destroy();renderer=null;fingerprint='';});
  window.PokeSiftCardDetails={render,describe};
})();
