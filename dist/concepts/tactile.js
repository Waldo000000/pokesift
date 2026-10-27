'use strict';
// Interaction studies only. No collection data or provider endpoints are used.
(() => {
  const STORE='pokesift.prototype.physical.v1';
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layout={slots:[],pile:[],positions:{}},mainFan=null,detailFan=null,drag=null;
  try {const saved=JSON.parse(localStorage.getItem(STORE));if(saved&&Array.isArray(saved.slots)&&Array.isArray(saved.pile)&&saved.positions&&typeof saved.positions==='object')layout=saved;}catch{}
  function reconcile() {
    const keys=new Set(cards.map(c=>c.key)),seen=new Set();
    if(!layout.slots.length){layout.slots=cards.slice(0,9).map(c=>c.key);layout.pile=cards.slice(9).map(c=>c.key);}
    layout.slots=layout.slots.slice(0,90).map(key=>{if(keys.has(key)&&!seen.has(key)){seen.add(key);return key;}return null;});
    while(layout.slots.length%9 || layout.slots.length<18)layout.slots.push(null);
    layout.pile=layout.pile.filter(key=>{if(keys.has(key)&&!seen.has(key)){seen.add(key);return true;}return false;});
    for(const c of cards)if(!seen.has(c.key))layout.pile.push(c.key);
  }
  function persist(){try{localStorage.setItem(STORE,JSON.stringify(layout));}catch{note('This demo arrangement could not be saved.');}}
  function locate(key){const slot=layout.slots.indexOf(key);return slot>=0?{slot}:{pile:layout.pile.indexOf(key)};}
  function place(key,slot=null) {
    const origin=locate(key);if(slot===origin.slot)return;
    if(origin.slot!==undefined)layout.slots[origin.slot]=null;else layout.pile=layout.pile.filter(k=>k!==key);
    if(slot===null)layout.pile.push(key);
    else {const occupant=layout.slots[slot];layout.slots[slot]=key;if(occupant){if(origin.slot!==undefined)layout.slots[origin.slot]=occupant;else layout.pile.splice(Math.max(0,origin.pile),0,occupant);}}
    persist();renderCards();
  }
  function freeSleeve(key){let slot=layout.slots.findIndex((k,i)=>!k&&Math.floor(i/9)===page);if(slot<0)slot=layout.slots.indexOf(null);if(slot<0){slot=layout.slots.length;layout.slots.push(...Array(9).fill(null));}page=Math.floor(slot/9);place(key,slot);}

  // One pointer-driven fan is shared by the full browser and Pokémon details.
  function makeFan(host,list,{initialIndex=0,onChange=()=>{},onOpen=cardDetail}={}) {
    const controller=new AbortController(),signal=controller.signal;
    let position=Math.min(initialIndex,Math.max(0,list.length-1)),target=position,velocity=0,frame=0,gesture=null,lastLabel=-1;
    host.classList.add('tactile-fan');host.replaceChildren();
    const buttons=list.map((c,i)=>{const b=document.createElement('button');b.className='fan-card';b.dataset.fanIndex=i;b.setAttribute('aria-label',c.name+', '+money(c.value));b.innerHTML=`<img src="${img(c)}" alt="${c.name} ${c.edition}" draggable="false"><span class="fan-price">${money(c.value)}</span>`;b.onclick=e=>{if(e.detail===0){if(Math.round(position)===i)onOpen(c);else go(i);}};host.append(b);return b;});
    const step=()=>host.clientWidth<500?105:145;
    function paint(){
      const mobile=host.clientWidth<500,selected=Math.max(0,Math.min(list.length-1,Math.round(position)));
      buttons.forEach((b,i)=>{const d=i-position,a=Math.abs(d),scale=Math.max(.64,1-a*.09),opacity=Math.max(0,1-a*.23);b.style.transform=`translateX(calc(-50% + ${d*(mobile?67:118)}px)) translateY(${Math.min(a,5)*18}px) rotate(${d*9}deg) scale(${scale})`;b.style.opacity=a>3.6?'0':String(opacity);b.style.zIndex=String(100-Math.round(a*10));b.style.pointerEvents=a>3.6?'none':'auto';b.classList.toggle('selected',i===selected);b.tabIndex=i===selected?0:-1;b.setAttribute('aria-pressed',String(i===selected));b.querySelector('.fan-price').style.opacity=String(Math.max(0,1-a*2));});
      host.dataset.position=position.toFixed(3);
      if(selected!==lastLabel){lastLabel=selected;onChange(selected,list[selected]);}
    }
    function go(next){target=Math.max(0,Math.min(list.length-1,next));cancelAnimationFrame(frame);if(reduced()){position=target;velocity=0;paint();return;}let previous=performance.now();
      function spring(now){const dt=Math.min(.025,(now-previous)/1000);previous=now;velocity+=(target-position)*240*dt;velocity*=Math.exp(-25*dt);position+=velocity*dt;paint();if(Math.abs(target-position)<.001&&Math.abs(velocity)<.01){position=target;velocity=0;paint();frame=0;}else frame=requestAnimationFrame(spring);}
      frame=requestAnimationFrame(spring);
    }
    host.addEventListener('pointerdown',e=>{if(e.button!==0||!list.length)return;cancelAnimationFrame(frame);velocity=0;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,position,lastX:e.clientX,lastTime:performance.now(),speed:0,moved:false,card:Number(e.target.closest('[data-fan-index]')?.dataset.fanIndex??-1)};host.setPointerCapture(e.pointerId);host.classList.add('is-dragging');},{signal});
    host.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.x,now=performance.now();if(Math.abs(dx)>4)gesture.moved=true;const dt=Math.max(8,now-gesture.lastTime);gesture.speed=.6*gesture.speed+.4*(e.clientX-gesture.lastX)/dt;gesture.lastX=e.clientX;gesture.lastTime=now;const raw=gesture.position-dx/step(),max=Math.max(0,list.length-1);position=raw<0?raw*.2:raw>max?max+(raw-max)*.2:raw;paint();},{signal});
    function release(e,cancelled=false){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;gesture=null;host.classList.remove('is-dragging');if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(cancelled){go(Math.round(g.position));return;}if(g.moved){const speed=performance.now()-g.lastTime>120?0:g.speed;velocity=-speed/step()*1000;go(Math.round(position+Math.max(-1.5,Math.min(1.5,velocity*.09))));}else {go(Math.round(position));if(g.card>=0){if(g.card===Math.round(position))onOpen(list[g.card]);else go(g.card);}}e.preventDefault();}
    host.addEventListener('pointerup',e=>release(e),{signal});host.addEventListener('pointercancel',e=>release(e,true),{signal});host.addEventListener('lostpointercapture',e=>{if(gesture)release(e,true);},{signal});
    host.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(target+(e.key==='ArrowRight'?1:-1));}},{signal});
    const observer=new ResizeObserver(paint);observer.observe(host);paint();
    return {go,step:delta=>go(target+delta),destroy(){cancelAnimationFrame(frame);controller.abort();observer.disconnect();},get selected(){return Math.round(position);}};
  }

  const aside=$('binder-layout').querySelector('.binder-aside');
  aside.innerHTML='<p class="eyebrow">BESIDE YOUR BINDER</p><h3>The pile<span id="pile-count"></span></h3><div id="card-pile" class="card-pile" data-pile-drop="true" role="region" aria-label="Pile of loose cards"></div><p class="pile-instructions">Pull a card from its sleeve.<br>Lay it here, or hold it up.</p><p id="physical-count" class="physical-count" role="status"></p>';
  $('binder-layout').classList.add('physical-table');
  $('card-fan').onpointerdown=$('card-fan').onpointerup=$('card-fan').onpointercancel=$('card-fan').onkeydown=null;
  renderCards=function(){
    if(theme==='desk'){
      const list=filtered();$('no-cards').hidden=!!list.length;mainFan?.destroy();
      mainFan=makeFan($('card-fan'),list,{initialIndex:Math.min(index,Math.max(0,list.length-1)),onChange:(i,c)=>{index=i;$('fan-name').textContent=c?.name||'No cards here yet';$('fan-meta').textContent=c?[c.type,c.set,c.edition].join(' · '):'';$('fan-position').textContent=c?`${i+1} / ${list.length} CARDS`:'';$('fan-prev').disabled=i<=0;$('fan-next').disabled=i>=list.length-1;[...$('thumbnail-rail').children].forEach((b,n)=>b.classList.toggle('active',n===i));}});
      $('thumbnail-rail').replaceChildren();list.forEach((c,i)=>{const b=document.createElement('button');b.className=i===index?'active':'';b.setAttribute('aria-label','Jump to '+c.name);b.innerHTML=`<img src="${img(c)}" alt="" draggable="false">`;b.onclick=()=>mainFan.go(i);$('thumbnail-rail').append(b);});return;
    }
    reconcile();page=Math.max(0,Math.min(page,layout.slots.length/9-1));$('no-cards').hidden=true;
    const grid=$('pocket-grid');grid.replaceChildren();
    layout.slots.slice(page*9,page*9+9).forEach((key,i)=>{const slot=page*9+i,c=cards.find(c=>c.key===key),pocket=document.createElement('div');pocket.className='physical-pocket'+(!c?' vacant':'');pocket.dataset.slot=slot;
      if(c){const b=document.createElement('button');b.className='sleeved-card';b.dataset.cardKey=c.key;b.setAttribute('aria-label',c.name+'. Pull out to hold, or tap for details.');b.innerHTML=`<img src="${img(c)}" alt="${c.name} card" draggable="false">`;b.onclick=e=>{if(e.detail===0)cardDetail(c);};pocket.append(b);}else{const label=document.createElement('span');label.className='sleeve-number';label.textContent=String(slot+1).padStart(2,'0');pocket.append(label);}
      const sleeve=document.createElement('div');sleeve.className='sleeve-front';sleeve.setAttribute('aria-hidden','true');pocket.append(sleeve);grid.append(pocket);
    });
    const pile=$('card-pile');pile.replaceChildren();pile.classList.toggle('empty',!layout.pile.length);
    layout.pile.forEach((key,i)=>{const c=cards.find(c=>c.key===key),b=document.createElement('button');b.className='piled-card';b.dataset.cardKey=key;b.setAttribute('aria-label',c.name+' in the pile. Drag into a sleeve or tap to hold.');b.style.setProperty('--pile-angle',((i*7)%13-6)+'deg');b.style.setProperty('--pile-x',((i*3)%9-4)+'px');b.style.setProperty('--pile-y',Math.min(i,14)*2+'px');b.style.zIndex=i+1;b.innerHTML=`<img src="${img(c)}" alt="${c.name}" draggable="false">`;b.onclick=e=>{if(e.detail===0)cardDetail(c);};pile.append(b);});
    $('pile-count').textContent=layout.pile.length;$('physical-count').textContent=`${layout.slots.filter(Boolean).length} sleeved · ${layout.pile.length} in the pile`;
    $('page-label').textContent=`PAGE ${page+1} / ${layout.slots.length/9}`;$('prev-page').disabled=page===0;$('next-page').disabled=(page+1)*9>=layout.slots.length;
  };
  $('fan-prev').onclick=()=>mainFan?.step(-1);$('fan-next').onclick=()=>mainFan?.step(1);

  function dropInto(c,from,slot=null){
    place(c.key,slot);
    const node=document.querySelector('[data-card-key="'+CSS.escape(c.key)+'"]');
    if(node&&from&&!reduced()){const to=node.getBoundingClientRect();node.animate([{translate:`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`,scale:String(from.width/to.width)},{translate:'0px 0px',scale:'1'}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});}
  }
  function clearDrag(){if(!drag)return;drag.source.classList.remove('lifted-out');drag.ghost?.remove();drag.glass?.remove();document.querySelectorAll('.drop-ready').forEach(n=>n.classList.remove('drop-ready'));document.body.classList.remove('holding-card');drag=null;}
  const table=$('binder-layout');
  table.addEventListener('pointerdown',e=>{const source=e.target.closest('[data-card-key]');if(!source||e.button!==0)return;const rect=source.getBoundingClientRect();drag={id:e.pointerId,key:source.dataset.cardKey,source,rect,x:e.clientX,y:e.clientY,moved:false};table.setPointerCapture(e.pointerId);});
  table.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y,distance=Math.hypot(dx,dy);
    if(!drag.moved&&distance<5)return;
    if(!drag.moved){drag.moved=true;drag.source.classList.add('lifted-out');document.body.classList.add('holding-card');const ghost=document.createElement('img');ghost.className='held-card';ghost.src=drag.source.querySelector('img').src;ghost.alt='';Object.assign(ghost.style,{left:drag.rect.left+'px',top:drag.rect.top+'px',width:drag.rect.width+'px',height:drag.rect.height+'px'});document.body.append(ghost);drag.ghost=ghost;
      if(drag.source.closest('.physical-pocket')){const glass=document.createElement('div');glass.className='extraction-glass';Object.assign(glass.style,{left:drag.rect.left-4+'px',top:drag.rect.top+7+'px',width:drag.rect.width+8+'px',height:drag.rect.height-3+'px'});document.body.append(glass);drag.glass=glass;}
    }
    const lift=Math.min(14,distance*.18),turn=Math.max(-8,Math.min(8,dx*.025));drag.ghost.style.transform=`translate3d(${dx}px,${dy-lift}px,0) rotate(${turn}deg) scale(1.025)`;
    const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]');document.querySelectorAll('.drop-ready').forEach(n=>n.classList.remove('drop-ready'));if(hit)hit.classList.add('drop-ready');
  });
  table.addEventListener('pointerup',e=>{
    if(!drag||e.pointerId!==drag.id)return;const current=drag,c=cards.find(c=>c.key===current.key),hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]'),from=current.ghost?.getBoundingClientRect();
    clearDrag();if(table.hasPointerCapture(e.pointerId))table.releasePointerCapture(e.pointerId);if(!c)return;
    if(current.moved&&hit?.hasAttribute('data-pile-drop'))dropInto(c,from);
    else if(current.moved&&hit?.hasAttribute('data-slot')&&Number(hit.dataset.slot)!==locate(c.key).slot)dropInto(c,from,Number(hit.dataset.slot));
    else cardDetail(c,{from,holding:current.moved});e.preventDefault();
  });
  table.addEventListener('pointercancel',clearDrag);table.addEventListener('lostpointercapture',()=>{if(drag)clearDrag();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();clearDrag();}});

  const oldShowDetail=showDetail;
  showDetail=function(html){detailFan?.destroy();detailFan=null;$('detail').classList.remove('pokemon-fan-detail');oldShowDetail(html);};
  cardDetail=function(c,{from=null,holding=false}={}){
    const origin=locate(c.key),inBinder=origin.slot!==undefined,physical=theme==='binder';
    showDetail(`<div class="detail-grid holding-detail"><img class="detail-card" src="${img(c)}" alt="${c.name} card"><div><p class="eyebrow">${holding?'IN YOUR HANDS':'A LITTLE CLOSER'}</p><h2>${c.name}</h2><p>${c.set} · ${c.edition}<br>${c.type} type</p><strong class="detail-value">${money(c.value)}</strong><p>Sample value · AUD</p><div class="detail-actions">${physical?`<button id="put-back">${inBinder?'Slide back into its sleeve':'Put back on the pile'}</button><button id="change-place">${inBinder?'Lay on the pile':'Slide into an empty sleeve'}</button>`:''}<button id="meet-pokemon">Fan out my ${c.name} cards ↗</button></div></div></div>`);
    if(physical){$('put-back').onclick=()=>$('detail').close();$('change-place').onclick=()=>{if(inBinder)place(c.key);else freeSleeve(c.key);$('detail').close();};}
    $('meet-pokemon').onclick=()=>speciesDetail(c);
    if(from&&!reduced())requestAnimationFrame(()=>{const image=$('detail-content').querySelector('.detail-card'),to=image.getBoundingClientRect();image.animate([{transformOrigin:'top left',transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`},{transformOrigin:'top left',transform:'none'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});});
  };
  speciesDetail=function(p){const copies=cards.filter(c=>c.id===p.id);
    showDetail(`<div class="pokemon-fan-heading"><img src="${art['pokemon-'+p.id]}" alt="${p.name}"><div><p class="eyebrow">#${String(p.id).padStart(3,'0')} · YOUR POKÉMON</p><h2>${p.name}</h2><p>${copies.length} ${copies.length===1?'card':'cards'} · ${p.type}</p></div></div><div id="species-fan" class="card-fan" tabindex="0" role="region" aria-label="Fan of your ${p.name} cards"></div><div class="sift-controls"><button id="species-prev" class="circle-button" aria-label="Previous printing">←</button><div><strong id="species-printing"></strong><span id="species-position"></span></div><button id="species-next" class="circle-button" aria-label="Next printing">→</button></div><p class="gesture-hint">${copies.length?'Hold and slide through your printings. Tap a card to look closer.':'A little space for a future friend.'}</p>`);
    $('detail').classList.add('pokemon-fan-detail');detailFan=makeFan($('species-fan'),copies,{onChange:(i,c)=>{$('species-printing').textContent=c?.edition||'No cards yet';$('species-position').textContent=c?`${c.set} · ${i+1} of ${copies.length}`:'';$('species-prev').disabled=i<=0;$('species-next').disabled=i>=copies.length-1;}});$('species-prev').onclick=()=>detailFan.step(-1);$('species-next').onclick=()=>detailFan.step(1);
  };
  $('detail').addEventListener('close',()=>{detailFan?.destroy();detailFan=null;if(theme==='binder')renderCards();});

  const defaults={25:[18,22],26:[30,18],4:[51,37],5:[61,41],6:[61,23],1:[20,48],2:[31,48],7:[78,64],9:[86,58],94:[48,73],93:[60,75],133:[16,75],143:[30,79],149:[84,18],151:[43,15],129:[85,83]};
  renderHabitat=function(list){const scene=$('habitat-creatures');if(!scene)return;scene.replaceChildren();list.forEach(p=>{let point=layout.positions[p.id];if(!Array.isArray(point)||point.length!==2||!point.every(n=>Number.isFinite(n)&&n>=5&&n<=95))point=defaults[p.id]||[50,50];const b=document.createElement('button');b.className='habitat-pokemon';b.dataset.pokemon=p.id;b.setAttribute('aria-label',p.name+', '+count(p.id)+' cards. Drag to move; tap to browse cards.');b.style.left=point[0]+'%';b.style.top=point[1]+'%';b.style.zIndex=Math.round(point[1]);b.innerHTML=`<img src="${art['pokemon-'+p.id]}" alt="${p.name}" draggable="false"><span>${p.name}<small>${count(p.id)} ${count(p.id)===1?'card':'cards'}</small></span>`;
      let gesture=null;
      b.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=scene.getBoundingClientRect();gesture={id:e.pointerId,x:e.clientX,y:e.clientY,point:[...point],rect:r,moved:false};b.setPointerCapture(e.pointerId);});
      b.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(!gesture.moved&&Math.hypot(dx,dy)<5)return;gesture.moved=true;b.classList.add('being-moved');const marginX=Math.max(5,60/gesture.rect.width*100),marginY=Math.max(5,65/gesture.rect.height*100);point=[Math.max(marginX,Math.min(100-marginX,gesture.point[0]+dx/gesture.rect.width*100)),Math.max(marginY,Math.min(100-marginY,gesture.point[1]+dy/gesture.rect.height*100))];b.style.left=point[0]+'%';b.style.top=point[1]+'%';b.style.zIndex='100';});
      function finish(e,cancelled=false){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;gesture=null;b.classList.remove('being-moved');if(b.hasPointerCapture(e.pointerId))b.releasePointerCapture(e.pointerId);if(cancelled){point=g.point;b.style.left=point[0]+'%';b.style.top=point[1]+'%';}else if(g.moved){layout.positions[p.id]=point;persist();}else speciesDetail(p);b.style.zIndex=Math.round(point[1]);e.preventDefault();}
      b.addEventListener('pointerup',e=>finish(e));b.addEventListener('pointercancel',e=>finish(e,true));b.addEventListener('lostpointercapture',e=>{if(gesture)finish(e,true);});b.onclick=e=>{if(e.detail===0)speciesDetail(p);};
      b.addEventListener('keydown',e=>{if(!e.shiftKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();point=[Math.max(7,Math.min(93,point[0]+(e.key==='ArrowRight'?2:e.key==='ArrowLeft'?-2:0))),Math.max(9,Math.min(91,point[1]+(e.key==='ArrowDown'?2:e.key==='ArrowUp'?-2:0)))];layout.positions[p.id]=point;persist();b.style.left=point[0]+'%';b.style.top=point[1]+'%';});scene.append(b);
    });};
  $('reset-demo').onclick=()=>{clearDrag();cards=initial();layout={slots:[],pile:[],positions:{}};page=0;index=0;filter='All';dexFilter='All';sort='recent';missing=false;newFriend=null;$('sort').value=sort;reconcile();persist();render();note('Demo arrangement reset.');};
  labels.desk='B · The Fan';labels.zoo='C · Your Pokémon';
  document.querySelectorAll('[data-surface]').forEach(a=>{if(a.dataset.surface===theme)a.setAttribute('aria-current','page');});
  const baseRender=render;render=function(){baseRender();$('hero-copy').textContent=theme==='binder'?'Pull up a card. Find it a home. Every sleeve is yours.':theme==='desk'?'Hold, slide, sift. The cards move with you.':'Your Pokémon. A little room to be themselves.';if(theme==='binder'){$('card-heading').textContent='Your binder. Your pile. Your own way.';}if(theme==='zoo'){$('hero-title').innerHTML='All your favourites.<br><em>Room to be themselves.</em>';$('eyebrow').textContent='YOUR POKÉMON';}};
  reconcile();render();
})();
