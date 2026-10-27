'use strict';
(() => {
  const $=id=>document.getElementById(id),card=$('card'),stage=document.querySelector('.stage');
  const samples={6:{name:'Charizard',set:'Base Set 2 · 4/130 · Holofoil',value:'A$284.00',foil:true,mask:'base2-4-holo'},9:{name:'Blastoise',set:'Base Set · 2/102 · Holofoil',value:'A$152.00',foil:true,mask:'base1-2-holo'},25:{name:'Pikachu',set:'Base Set · 58/102 · Non-holo',value:'A$12.50',foil:false}};
  // Hand-traced prototype masks for these exact 240 × 330 sample artworks.
  // These are illustrative, not provider data or verified physical foil maps.
  // Key by printing + finish: another Charizard can have a different foil area.
  const silhouettes={
    'base2-4-holo':'M84 52 L99 63 L112 78 L125 86 L134 85 L143 87 L152 92 L160 80 L165 48 L162 41 L175 47 L188 56 L204 65 L211 84 L213 110 L204 99 L193 91 L181 92 L174 101 L178 110 L175 117 L183 130 L190 141 L187 151 L181 155 L185 164 L171 168 L164 161 L150 166 L133 160 L123 166 L113 166 L113 159 L102 154 L89 151 L82 145 L72 146 L69 139 L74 131 L72 123 L80 116 L85 116 L82 123 L86 116 L82 101 L90 96 L90 78 Z',
    'base1-2-holo':'M73 57 L77 51 L92 49 L103 54 L111 49 L116 53 L119 62 L131 73 L142 80 L147 62 L152 56 L160 56 L166 60 L165 69 L161 81 L164 92 L172 103 L170 115 L171 125 L166 141 L163 148 L173 157 L172 163 L161 164 L153 169 L143 168 L137 162 L126 162 L115 164 L105 170 L97 169 L97 164 L84 168 L76 168 L80 158 L89 150 L83 144 L80 131 L73 126 L67 115 L61 110 L61 103 L66 98 L66 92 L72 89 L78 91 L81 91 L78 86 L68 83 L65 74 L66 66 L74 63 Z'
  };
  const foilMasks=new Map();
  function maskFor(printing){
    if(!silhouettes[printing])return null;
    if(foilMasks.has(printing))return foilMasks.get(printing);
    const canvas=document.createElement('canvas');canvas.width=576;canvas.height=402;
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    ctx.scale(3,3);ctx.translate(-24,-39);ctx.fillStyle='#fff';ctx.fillRect(26,40,187,130);
    ctx.globalCompositeOperation='destination-out';
    const pokemon=new Path2D(silhouettes[printing]);ctx.fill(pokemon);
    // A small conservative margin keeps colour off the printed subject's edge.
    ctx.lineWidth=3;ctx.lineJoin='round';ctx.stroke(pokemon);
    ctx.fill(new Path2D('M24 39 L64 39 L44 53 L24 53 Z'));
    const url=canvas.toDataURL();foilMasks.set(printing,url);return url;
  }
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
  function choose(id){const c=samples[id],mask=maskFor(c.mask),hasMask=c.foil&&!!mask;card.style.setProperty('--foil-mask',mask?`url("${mask}")`:'linear-gradient(transparent,transparent)');card.dataset.foilMask=hasMask?c.mask:'';$('mask-preview').disabled=!hasMask;card.classList.remove('inspect-foil');$('mask-preview').setAttribute('aria-pressed','false');$('card-art').src=window.CONCEPT_ART['card-'+id];$('card-art').alt=c.name+' Pokémon card';$('card-name').textContent=c.name;$('card-set').textContent=c.set;$('card-value').textContent=c.value;$('finish').textContent=c.foil?'Holofoil':'Non-holo';card.setAttribute('aria-label',`Tilt ${c.name}. Drag, or use the arrow keys. Press Home to reset.`);$('foil-toggle').disabled=!hasMask;$('foil-toggle').closest('label').title=hasMask?'Simulated foil effect':c.foil?'No foil mask available':'This sample is non-holo';card.classList.toggle('has-foil',hasMask&&$('foil-toggle').checked);document.querySelectorAll('[data-card]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.card===String(id))));reset();}
  document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>choose(b.dataset.card));
  $('foil-toggle').onchange=()=>{card.classList.toggle('has-foil',$('foil-toggle').checked&&!$('foil-toggle').disabled);paint();};
  $('mask-preview').onclick=()=>{const enabled=card.classList.toggle('inspect-foil');$('mask-preview').setAttribute('aria-pressed',String(enabled));};
  function look(name){const chosen=name==='spotlight'?'spotlight':'hand';document.body.dataset.look=chosen;document.querySelectorAll('nav [data-look]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.look===chosen)));$('intro').textContent=chosen==='hand'?'A little closer.':'Just you and the card.';document.querySelector('meta[name=theme-color]').content=chosen==='hand'?'#e9e6dc':'#131e1b';}
  document.querySelectorAll('nav [data-look]').forEach(b=>b.onclick=()=>{history.replaceState(null,'','#'+b.dataset.look);look(b.dataset.look);});
  window.addEventListener('hashchange',()=>look(location.hash.slice(1)));motion.addEventListener('change',animate);
  for(const id of [25,9,1,94,133,149,151,6]){const image=new Image();image.src=window.CONCEPT_ART['card-'+id];image.alt='';document.querySelector('#background-cards').append(image);}
  look(location.hash.slice(1));choose(6);
})();
