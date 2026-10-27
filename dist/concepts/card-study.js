'use strict';
(() => {
  const $=id=>document.getElementById(id),card=$('card'),F=window.PokeSiftFoil;
  const samples={6:{name:'Charizard',set:'Base Set 2',number:'4/130',value:'A$284.00',finish:'Holofoil'},9:{name:'Blastoise',set:'Base Set',number:'2/102',value:'A$152.00',finish:'Holofoil'},25:{name:'Pikachu',set:'Base Set',number:'58/102',value:'A$12.50',finish:'Non-holo'}};
  let current=6,renderer=null,config=null;
  const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
  $('study-finish').append(option('auto','Printing default'),...Object.values(F.profiles).map(p=>option(p.id,p.label)));
  for(const [value,label] of Object.entries(F.regions))$('study-region').append(option(value,label));
  for(const [value,layout] of Object.entries(F.layouts))$('study-layout').append(option(value,layout.label));
  function update(){
    const c=samples[current],appearance=$('study-finish').value==='auto'?null:{version:1,profile:$('study-finish').value,region:$('study-region').value,layout:$('study-layout').value};
    config=F.resolve({...c,language:'en',game:'pokemon',canonical:true,appearance});
    if(renderer)renderer.update(config);else renderer=F.mount(card,$('card-art'),config);
    renderer.setEnabled($('foil-toggle').checked);renderer.inspect(false);$('mask-preview').setAttribute('aria-pressed','false');
    $('mask-preview').disabled=!renderer.hasMask;$('foil-toggle').disabled=!renderer.hasMask;
    $('study-region').disabled=$('study-layout').disabled=!appearance;
    $('study-status').textContent=appearance?'Finish experiment on this sample artwork; not a claim about this card’s physical finish. '+(renderer.hasMask?'':'This area needs a printing-specific mask or a layout with an artwork window.'):config.note;
  }
  function choose(id){current=id;const c=samples[id];$('card-art').src=window.CONCEPT_ART['card-'+id];$('card-art').alt=c.name+' Pokémon card';$('card-name').textContent=c.name;$('card-set').textContent=[c.set,c.number,c.finish].join(' · ');$('card-value').textContent=c.value;$('finish').textContent=c.finish;document.querySelectorAll('[data-card]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.card===String(id))));$('study-finish').value='auto';$('study-region').value='auto';$('study-layout').value='classic';update();renderer.reset();}
  document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>choose(b.dataset.card));
  for(const id of ['study-finish','study-region','study-layout'])$(id).onchange=update;
  $('foil-toggle').onchange=()=>renderer.setEnabled($('foil-toggle').checked);
  $('mask-preview').onclick=()=>{const enabled=$('mask-preview').getAttribute('aria-pressed')!=='true';renderer.inspect(enabled);$('mask-preview').setAttribute('aria-pressed',String(enabled));};
  function look(name){const chosen=name==='spotlight'?'spotlight':'hand';document.body.dataset.look=chosen;document.querySelectorAll('nav [data-look]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.look===chosen)));$('intro').textContent=chosen==='hand'?'A little closer.':'Just you and the card.';document.querySelector('meta[name=theme-color]').content=chosen==='hand'?'#e9e6dc':'#131e1b';}
  document.querySelectorAll('nav [data-look]').forEach(b=>b.onclick=()=>{history.replaceState(null,'','#'+b.dataset.look);look(b.dataset.look);});
  window.addEventListener('hashchange',()=>look(location.hash.slice(1)));
  for(const id of [25,9,1,94,133,149,151,6]){const image=new Image();image.src=window.CONCEPT_ART['card-'+id];image.alt='';$('background-cards').append(image);}
  look(location.hash.slice(1));choose(6);
})();
