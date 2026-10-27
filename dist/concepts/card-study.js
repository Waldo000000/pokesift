'use strict';
(() => {
  const $=id=>document.getElementById(id),card=$('card'),stage=document.querySelector('.stage');
  const samples={6:{name:'Charizard',set:'Base Set 2 · 4/130 · Holofoil',value:'A$284.00',foil:true},9:{name:'Blastoise',set:'Base Set · 2/102 · Holofoil',value:'A$152.00',foil:true},25:{name:'Pikachu',set:'Base Set · 58/102 · Non-holo',value:'A$12.50',foil:false}};
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const foilCanvas=$('foil-flecks'),foilContext=foilCanvas.getContext('2d');
  // Fixed flakes with different reflective orientations. Their brightness is a
  // function of tilt, never time: holding still keeps the foil still, too.
  let seed=719;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const flakes=Array.from({length:300},()=>({x:random()*560,y:random()*360,r:.6+Math.pow(random(),3)*3.2,nx:random()*2-1,ny:random()*2-1,hue:random()*360,angle:random()*Math.PI}));
  let pointer=null,rx=0,ry=0,tx=0,ty=0,frame=0,last=0;
  function paintFoil(){
    if(!foilContext||!card.classList.contains('has-foil'))return;
    const ctx=foilContext,nx=ry/24,ny=rx/18;ctx.clearRect(0,0,560,360);
    for(const f of flakes){
      const alignment=Math.exp(-((f.nx-nx*.9)**2+(f.ny+ny*.9)**2)*12);
      const pool=.3+.7*Math.exp(-((f.x/560-(.5+nx*.4))**2+(f.y/360-(.5-ny*.4))**2)*4);
      const glint=alignment*pool,alpha=.035+glint*.85,hue=(f.hue+nx*100+ny*70+360)%360;
      ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.angle);ctx.fillStyle=`hsla(${hue},85%,${65+glint*30}%,${alpha})`;
      ctx.beginPath();ctx.ellipse(0,0,f.r,f.r*.65,0,0,Math.PI*2);ctx.fill();
      if(glint>.55&&f.r>1.8){ctx.fillStyle=`rgba(255,255,245,${(glint-.55)*1.6})`;ctx.fillRect(-f.r*2,-.3,f.r*4,.6);ctx.fillRect(-.3,-f.r*2,.6,f.r*4);}
      ctx.restore();
    }
  }
  function paint(){card.style.setProperty('--rx',rx+'deg');card.style.setProperty('--ry',ry+'deg');card.style.setProperty('--lx',(50+ry*1.65)+'%');card.style.setProperty('--ly',(35-rx*2)+'%');card.style.setProperty('--shine',String(.08+(Math.abs(rx)+Math.abs(ry))*.005));card.style.setProperty('--foil-x',(50+ry*2.7)+'%');card.style.setProperty('--foil-y',(50-rx*3)+'%');card.style.setProperty('--foil-angle',(115+ry*.7-rx*.4)+'deg');card.style.setProperty('--foil-strength',String(.24+Math.min(1,(Math.abs(rx)+Math.abs(ry))/24)*.22));stage.style.setProperty('--shadow-x',ry*.8+'px');paintFoil();}
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
  $('foil-toggle').onchange=()=>{card.classList.toggle('has-foil',$('foil-toggle').checked&&!$('foil-toggle').disabled);paint();};
  function look(name){const chosen=name==='spotlight'?'spotlight':'hand';document.body.dataset.look=chosen;document.querySelectorAll('nav [data-look]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.look===chosen)));$('intro').textContent=chosen==='hand'?'A little closer.':'Just you and the card.';document.querySelector('meta[name=theme-color]').content=chosen==='hand'?'#e9e6dc':'#131e1b';}
  document.querySelectorAll('nav [data-look]').forEach(b=>b.onclick=()=>{history.replaceState(null,'','#'+b.dataset.look);look(b.dataset.look);});
  window.addEventListener('hashchange',()=>look(location.hash.slice(1)));motion.addEventListener('change',animate);
  for(const id of [25,9,1,94,133,149,151,6]){const image=new Image();image.src=window.CONCEPT_ART['card-'+id];image.alt='';document.querySelector('#background-cards').append(image);}
  look(location.hash.slice(1));choose(6);
})();
