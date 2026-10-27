'use strict';
(() => {
  const $=id=>document.getElementById(id),card=$('card'),stage=document.querySelector('.stage');
  const samples={6:{name:'Charizard',set:'Base Set 2 · 4/130 · Holofoil',value:'A$284.00',foil:true},9:{name:'Blastoise',set:'Base Set · 2/102 · Holofoil',value:'A$152.00',foil:true},25:{name:'Pikachu',set:'Base Set · 58/102 · Non-holo',value:'A$12.50',foil:false}};
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let pointer=null,rx=0,ry=0,tx=0,ty=0,frame=0,last=0;
  function paint(){card.style.setProperty('--rx',rx+'deg');card.style.setProperty('--ry',ry+'deg');card.style.setProperty('--lx',(50+ry*1.65)+'%');card.style.setProperty('--ly',(35-rx*2)+'%');card.style.setProperty('--shine',String(.10+(Math.abs(rx)+Math.abs(ry))*.007));stage.style.setProperty('--shadow-x',ry*.8+'px');}
  function tick(now){const dt=Math.min(40,Math.max(0,now-last));last=now;const blend=1-Math.exp(-dt/(pointer?32:125));rx+=(tx-rx)*blend;ry+=(ty-ry)*blend;paint();if(Math.abs(tx-rx)+Math.abs(ty-ry)>.015)frame=requestAnimationFrame(tick);else{rx=tx;ry=ty;paint();frame=0;}}
  function animate(){if(motion.matches){cancelAnimationFrame(frame);frame=0;rx=tx;ry=ty;paint();return;}if(!frame){last=performance.now();frame=requestAnimationFrame(tick);}}
  function reset(){tx=ty=0;animate();}
  card.addEventListener('pointerdown',e=>{if(e.button!==0||pointer)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,rx,ry};card.setPointerCapture(e.pointerId);});
  card.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;const scale=card.offsetWidth;ty=Math.max(-24,Math.min(24,pointer.ry+(e.clientX-pointer.x)/scale*48));tx=Math.max(-18,Math.min(18,pointer.rx-(e.clientY-pointer.y)/scale*40));animate();});
  function release(e){if(!pointer||pointer.id!==e.pointerId)return;pointer=null;if(card.hasPointerCapture(e.pointerId))card.releasePointerCapture(e.pointerId);reset();}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])card.addEventListener(type,release);
  card.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Home'||e.key==='Escape')reset();else{ty=Math.max(-24,Math.min(24,ty+({'ArrowLeft':-6,'ArrowRight':6}[e.key]||0)));tx=Math.max(-18,Math.min(18,tx+({'ArrowUp':6,'ArrowDown':-6}[e.key]||0)));animate();}});
  card.addEventListener('blur',()=>{if(!pointer)reset();});
  function choose(id){const c=samples[id];$('card-art').src=window.CONCEPT_ART['card-'+id];$('card-art').alt=c.name+' Pokémon card';$('card-name').textContent=c.name;$('card-set').textContent=c.set;$('card-value').textContent=c.value;$('finish').textContent=c.foil?'Holofoil':'Non-holo';card.setAttribute('aria-label',`Tilt ${c.name}. Drag, or use the arrow keys. Press Home to reset.`);$('foil-toggle').disabled=!c.foil;$('foil-toggle').closest('label').title=c.foil?'Simulated foil effect':'This sample is non-holo';card.classList.toggle('has-foil',c.foil&&$('foil-toggle').checked);document.querySelectorAll('[data-card]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.card===String(id))));reset();}
  document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>choose(b.dataset.card));
  $('foil-toggle').onchange=()=>card.classList.toggle('has-foil',$('foil-toggle').checked&&!$('foil-toggle').disabled);
  function look(name){const chosen=name==='spotlight'?'spotlight':'hand';document.body.dataset.look=chosen;document.querySelectorAll('nav [data-look]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.look===chosen)));$('intro').textContent=chosen==='hand'?'A little closer.':'Just you and the card.';document.querySelector('meta[name=theme-color]').content=chosen==='hand'?'#e9e6dc':'#131e1b';}
  document.querySelectorAll('nav [data-look]').forEach(b=>b.onclick=()=>{history.replaceState(null,'','#'+b.dataset.look);look(b.dataset.look);});
  window.addEventListener('hashchange',()=>look(location.hash.slice(1)));motion.addEventListener('change',animate);
  for(const id of [25,9,1,94,133,149,151,6]){const image=new Image();image.src=window.CONCEPT_ART['card-'+id];image.alt='';document.querySelector('#background-cards').append(image);}
  look(location.hash.slice(1));choose(6);
})();
