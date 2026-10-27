'use strict';
// Shared physical interactions. Demo pages are isolated; the live room persists
// through the parent collection bridge and never initiates a scan.
(() => {
  const STORE='pokesift.prototype.physical.v2';
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spreadMedia=matchMedia('(min-width: 900px) and (orientation: landscape)');
  let layout={slots:[],piles:[[],[]],positions:{}},mainFan=null,detailFan=null,drag=null,turn=null,floatFan=null,floatAnchor=null;
  if(runtime)layout=structuredClone(runtime.layout);
  else try {const saved=JSON.parse(localStorage.getItem(STORE)||localStorage.getItem('pokesift.prototype.physical.v1'));if(saved&&Array.isArray(saved.slots)&&saved.positions&&typeof saved.positions==='object')layout={slots:saved.slots,piles:Array.isArray(saved.piles)?saved.piles:[saved.pile||[],[]],positions:saved.positions};}catch{}
  const pageStep=()=>spreadMedia.matches?2:1;
  function reconcile() {
    const keys=new Set(cards.map(c=>c.key)),seen=new Set();
    if(!layout.slots.length){layout.slots=cards.slice(0,9).map(c=>c.key);layout.piles=[cards.slice(9).map(c=>c.key),[]];}
    layout.slots=layout.slots.map(key=>{if(keys.has(key)&&!seen.has(key)){seen.add(key);return key;}return null;});
    while(layout.slots.length%18 || layout.slots.length<180)layout.slots.push(null);
    layout.piles=[0,1].map(i=>(Array.isArray(layout.piles[i])?layout.piles[i]:[]).filter(key=>{if(keys.has(key)&&!seen.has(key)){seen.add(key);return true;}return false;}));
    for(const c of cards)if(!seen.has(c.key))layout.piles[0].push(c.key);
  }
  function persist(){if(runtime){if(!runtime.persist(layout)){layout=structuredClone(runtime.layout);note('This collection is read-only. Reload the page before arranging cards.');return false;}runtime.layout=structuredClone(layout);return true;}try{localStorage.setItem(STORE,JSON.stringify(layout));}catch{note('This demo arrangement could not be saved.');}}
  function locate(key){const slot=layout.slots.indexOf(key);if(slot>=0)return {slot};const stack=layout.piles.findIndex(p=>p.includes(key));return {stack,index:layout.piles[stack]?.indexOf(key)};}
  function place(key,slot=null,stack=0) {
    if(runtime?.readOnly){note('Reload the page before rearranging this collection.');return false;}
    const origin=locate(key);
    if(slot!==null&&layout.slots[slot]){if(layout.slots[slot]!==key)note('That sleeve is occupied. Clear it using a stack first.');return false;}
    if(origin.stack!==undefined&&layout.piles[origin.stack]?.at(-1)!==key)return false;
    if(origin.slot!==undefined)layout.slots[origin.slot]=null;else layout.piles[origin.stack].pop();
    if(slot===null)layout.piles[stack].push(key);else layout.slots[slot]=key;
    persist();renderCards();return true;
  }
  function freeSleeve(key){let slot=layout.slots.findIndex((k,i)=>!k&&i>=page*9&&i<(page+pageStep())*9);if(slot<0)slot=layout.slots.indexOf(null);if(slot<0){slot=layout.slots.length;layout.slots.push(...Array(18).fill(null));}page=Math.floor(Math.floor(slot/9)/pageStep())*pageStep();place(key,slot);}

  // One pointer-driven fan is shared by the full browser and Pokémon details.
  function makeFan(host,list,{initialIndex=Math.max(0,list.length-1),onChange=()=>{},onOpen=cardDetail}={}) {
    const controller=new AbortController(),signal=controller.signal;
    let position=Math.min(initialIndex,Math.max(0,list.length-1)),target=position,velocity=0,frame=0,gesture=null,lastLabel=-1,reveal=1,revealFrame=0,revealTarget=1;
    host.classList.add('tactile-fan');host.replaceChildren();
    const buttons=list.map((c,i)=>{const b=document.createElement('button');b.className='fan-card';b.dataset.fanIndex=i;b.setAttribute('aria-label',c.name+', '+valueOfCard(c));b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} ${escapeHTML(c.edition)}" draggable="false" loading="lazy" decoding="async"><span class="fan-price">${valueOfCard(c)}</span>`;b.onclick=e=>{if(e.detail===0){if(Math.round(position)===i)onOpen(c);else go(i);}};host.append(b);return b;});
    const step=()=>host.clientWidth<500?105:145;
    function paint(){
      const mobile=host.clientWidth<500,selected=Math.max(0,Math.min(list.length-1,Math.round(position)));
      const cardWidth=buttons[0]?.offsetWidth||180,spacing=mobile?30:43,radius=mobile?900:1250;
      buttons.forEach((b,i)=>{const d=i-position,a=Math.abs(d),fraction=Math.max(0,Math.min(1,d)),opening=fraction*fraction*(3-2*fraction),arc=d*spacing+opening*cardWidth*.88*reveal,angle=arc/radius;
        b.style.transform=`translateX(calc(-50% + ${Math.sin(angle)*radius}px)) translateY(${(1-Math.cos(angle))*radius}px) rotate(${angle*180/Math.PI}deg)`;const fade=list.length>30?Math.max(0,Math.min(1,(a-10)/8)):0,opacity=1-fade*fade*(3-2*fade);b.style.opacity=String(opacity);b.style.zIndex=String(i+1);b.style.visibility=opacity>0?'visible':'hidden';b.style.willChange=opacity>0?'transform':'auto';b.style.pointerEvents=opacity>0?'auto':'none';b.classList.toggle('selected',i===selected);b.tabIndex=i===selected?0:-1;b.setAttribute('aria-pressed',String(i===selected));b.querySelector('.fan-price').style.opacity=String(Math.max(0,1-a*2));});
      host.dataset.position=position.toFixed(3);host.dataset.reveal=reveal.toFixed(3);
      if(selected!==lastLabel){lastLabel=selected;onChange(selected,list[selected]);}
    }
    function revealTo(next){if(revealTarget===next&&revealFrame)return;revealTarget=next;cancelAnimationFrame(revealFrame);if(reduced()){reveal=next;paint();return;}const from=reveal,started=performance.now(),duration=next===1?800:460;function tick(now){const t=Math.min(1,(now-started)/duration),ease=t*t*(3-2*t);reveal=from+(next-from)*ease;paint();if(t<1)revealFrame=requestAnimationFrame(tick);else revealFrame=0;}revealFrame=requestAnimationFrame(tick);}
    function go(next){target=Math.max(0,Math.min(list.length-1,next));cancelAnimationFrame(frame);if(reduced()){position=target;velocity=0;paint();return;}let previous=performance.now();
      function spring(now){const dt=Math.min(.025,(now-previous)/1000);previous=now;velocity+=(target-position)*240*dt;velocity*=Math.exp(-25*dt);position+=velocity*dt;paint();if(Math.abs(target-position)<.001&&Math.abs(velocity)<.01){position=target;velocity=0;paint();frame=0;}else frame=requestAnimationFrame(spring);}
      frame=requestAnimationFrame(spring);
    }
    host.addEventListener('pointerdown',e=>{if(e.button!==0||!list.length)return;cancelAnimationFrame(frame);velocity=0;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,position,lastX:e.clientX,lastTime:performance.now(),speed:0,moved:false,card:Number(e.target.closest('[data-fan-index]')?.dataset.fanIndex??-1)};host.setPointerCapture(e.pointerId);host.classList.add('is-dragging');},{signal});
    host.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.x,now=performance.now();if(Math.abs(dx)>4&&!gesture.moved){gesture.moved=true;revealTo(0);}const dt=Math.max(8,now-gesture.lastTime);gesture.speed=.6*gesture.speed+.4*(e.clientX-gesture.lastX)/dt;gesture.lastX=e.clientX;gesture.lastTime=now;const raw=gesture.position-dx/step(),max=Math.max(0,list.length-1);position=raw<0?raw*.2:raw>max?max+(raw-max)*.2:raw;paint();},{signal});
    function release(e,cancelled=false){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;gesture=null;revealTo(1);host.classList.remove('is-dragging');if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(cancelled){go(Math.round(g.position));return;}if(g.moved){const speed=performance.now()-g.lastTime>120?0:g.speed;velocity=-speed/step()*1000;go(Math.round(position+Math.max(-1.5,Math.min(1.5,velocity*.09))));}else {go(Math.round(position));if(g.card>=0){if(g.card===Math.round(position))onOpen(list[g.card]);else go(g.card);}}e.preventDefault();}
    host.addEventListener('pointerup',e=>release(e),{signal});host.addEventListener('pointercancel',e=>release(e,true),{signal});host.addEventListener('lostpointercapture',e=>{if(gesture)release(e,true);},{signal});
    host.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(target+(e.key==='ArrowRight'?1:-1));}},{signal});
    const observer=new ResizeObserver(paint);observer.observe(host);paint();
    return {go,step:delta=>go(target+delta),destroy(){cancelAnimationFrame(frame);cancelAnimationFrame(revealFrame);controller.abort();observer.disconnect();},get selected(){return Math.round(position);}};
  }

  const aside=$('binder-layout').querySelector('.binder-aside');
  aside.innerHTML='<p class="eyebrow">MAKE A LITTLE ROOM</p><h3>Your stacks</h3><div class="stack-spots"><section><h4>Stack one <span id="pile-count-0"></span></h4><div id="card-pile" class="card-pile" data-pile-drop="0" role="region" aria-label="Stack one"></div></section><section><h4>Stack two <span id="pile-count-1"></span></h4><div id="card-pile-1" class="card-pile" data-pile-drop="1" role="region" aria-label="Stack two"></div></section></div><p class="pile-instructions">Pull up to remove. Drop into any empty sleeve or onto either stack. Drag an empty sleeve to turn the page.</p><p id="physical-count" class="physical-count" role="status"></p>';
  const table=$('binder-layout'),book=table.querySelector('.binder-book');
  table.classList.add('physical-table');
  book.querySelector('#pocket-grid').replaceWith(Object.assign(document.createElement('div'),{id:'binder-spread',className:'binder-spread'}));
  $('card-fan').onpointerdown=$('card-fan').onpointerup=$('card-fan').onpointercancel=$('card-fan').onkeydown=null;
  $('thumbnail-rail').hidden=true;
  function leaf(pageNumber,{side='right',corners=true}={}) {
    const sheet=document.createElement('section');sheet.className='binder-leaf leaf-'+side;sheet.dataset.page=pageNumber;sheet.setAttribute('aria-label','Binder page '+(pageNumber+1));
    const grid=document.createElement('div');grid.className='pocket-grid';
    layout.slots.slice(pageNumber*9,pageNumber*9+9).forEach((key,i)=>{const slot=pageNumber*9+i,c=cards.find(c=>c.key===key),pocket=document.createElement('div');pocket.className='physical-pocket'+(!c?' vacant':'');pocket.dataset.slot=slot;
      if(c){const b=document.createElement('button');b.className='sleeved-card';b.dataset.cardKey=c.key;b.setAttribute('aria-label',c.name+'. Pull straight up out of the sleeve, or tap for details.');b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} card" draggable="false">`;b.onclick=e=>{if(e.detail===0)cardDetail(c);};pocket.append(b);}else{const label=document.createElement('span');label.className='sleeve-number';label.textContent=String(slot+1).padStart(2,'0');pocket.append(label);}
      const sleeve=document.createElement('div');sleeve.className='sleeve-front';sleeve.setAttribute('aria-hidden','true');pocket.append(sleeve);grid.append(pocket);
    });sheet.append(grid);
    const number=document.createElement('span');number.className='leaf-number';number.textContent=String(pageNumber+1).padStart(2,'0');sheet.append(number);
    if(corners){const directions=spreadMedia.matches?[side==='right'?1:-1]:[-1,1];for(const direction of directions)for(const corner of ['top','bottom']){const button=document.createElement('button');button.className='page-corner corner-'+corner+(direction===1?' corner-right':' corner-left');button.dataset.turnDirection=direction;button.dataset.turnCorner=corner;button.disabled=page+direction*pageStep()<0||page+direction*pageStep()>=layout.slots.length/9;button.setAttribute('aria-label',`Turn ${direction===1?'next':'previous'} page from ${corner} corner`);button.innerHTML='<span aria-hidden="true"></span>';button.onclick=e=>{if(e.detail===0)turnPage(direction,corner);};sheet.append(button);}}
    return sheet;
  }
  function renderBook(){const spread=$('binder-spread');book.classList.toggle('two-page',spreadMedia.matches);spread.replaceChildren();spread.dataset.startPage=page;for(let i=0;i<pageStep();i++)spread.append(leaf(page+i,{side:spreadMedia.matches&&i===0?'left':'right'}));$('page-label').textContent=spreadMedia.matches?`PAGES ${page+1}–${page+2} / ${layout.slots.length/9}`:`PAGE ${page+1} / ${layout.slots.length/9}`;$('prev-page').disabled=page===0;$('next-page').disabled=page+pageStep()>=layout.slots.length/9;}
  renderCards=function(){
    if(theme==='desk'){
      const list=filtered();$('no-cards').hidden=!!list.length;mainFan?.destroy();
      mainFan=makeFan($('card-fan'),list,{initialIndex:mainFan?Math.min(index,Math.max(0,list.length-1)):Math.max(0,list.length-1),onChange:(i,c)=>{index=i;$('fan-name').textContent=c?.name||'No cards here yet';$('fan-meta').textContent=c?[c.type,c.set,c.edition].join(' · '):'';$('fan-position').textContent=c?`${i+1} / ${list.length} CARDS`:'';$('fan-prev').disabled=i<=0;$('fan-next').disabled=i>=list.length-1;}});$('thumbnail-rail').replaceChildren();return;
    }
    reconcile();page=Math.floor(Math.max(0,Math.min(page,layout.slots.length/9-1))/pageStep())*pageStep();$('no-cards').hidden=true;renderBook();
    layout.piles.forEach((pileKeys,stack)=>{const pile=$(stack?'card-pile-1':'card-pile');pile.replaceChildren();pile.classList.toggle('empty',!pileKeys.length);pileKeys.slice(-6).forEach((key,j)=>{const i=Math.max(0,pileKeys.length-6)+j,c=cards.find(c=>c.key===key),b=document.createElement('button');b.className='piled-card';b.dataset.cardKey=key;b.setAttribute('aria-label',c.name+' on stack '+(stack+1)+'. Drag into an empty sleeve or the other stack.');b.style.setProperty('--pile-angle',((i*7)%13-6)+'deg');b.style.setProperty('--pile-x',((i*3)%9-4)+'px');b.style.setProperty('--pile-y',Math.min(i,14)*2+'px');b.style.zIndex=i+1;const top=i===pileKeys.length-1;b.disabled=!top;b.tabIndex=top?0:-1;b.setAttribute('aria-hidden',String(!top));b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)}" draggable="false">`;b.onclick=e=>{if(e.detail===0&&top)cardDetail(c);};pile.append(b);});$('pile-count-'+stack).textContent=pileKeys.length;});
    $('physical-count').textContent=`${layout.slots.filter(Boolean).length} sleeved · ${layout.piles.flat().length} stacked`;
  };
  $('fan-prev').onclick=()=>mainFan?.step(-1);$('fan-next').onclick=()=>mainFan?.step(1);

  // Three rigid panels hinge at the pocket gutters. Cards stay flat while the
  // plastic between their columns folds; the final pose matches the resting leaf.
  function startTurn(direction,corner='bottom') {
    if(turn||drag)return false;const target=page+direction*pageStep();if(target<0||target>=layout.slots.length/9)return false;
    const spread=$('binder-spread'),source=direction===1?spread.lastElementChild:spread.firstElementChild,rect=source.getBoundingClientRect(),bounds=book.getBoundingClientRect(),gap=spreadMedia.matches?parseFloat(getComputedStyle(spread).gap):0;
    const sheet=document.createElement('div');sheet.className='turning-sheet curved-sheet';sheet.setAttribute('aria-hidden','true');sheet.inert=true;Object.assign(sheet.style,{left:rect.left-bounds.left+'px',top:rect.top-bounds.top+'px',width:rect.width+'px',height:rect.height+'px'});
    const front=source.cloneNode(true),back=leaf(direction===1?target:target+pageStep()-1,{side:direction===1?'left':'right',corners:false});
    for(const face of [front,back]){face.querySelectorAll('button').forEach(b=>b.tabIndex=-1);face.querySelectorAll('.page-corner').forEach(b=>b.remove());Object.assign(face.style,{width:rect.width+'px',height:rect.height+'px'});}
    const pockets=[...source.querySelectorAll('.physical-pocket')].slice(0,3).map(n=>n.getBoundingClientRect());
    const cuts=[0,(pockets[0].right+pockets[1].left)/2-rect.left,(pockets[1].right+pockets[2].left)/2-rect.left,rect.width],strips=[];
    for(let i=0;i<3;i++){const column=direction===1?i:2-i,start=cuts[column],w=cuts[column+1]-start,strip=document.createElement('div');strip.className='page-strip';strip.dataset.column=column;strip.foldWidth=w;Object.assign(strip.style,{width:w+.25+'px',height:rect.height+'px',transformOrigin:direction===1?'left center':'right center'});
      for(const [face,reverse] of [[front,false],[back,true]]){const mask=document.createElement('div');mask.className='strip-face'+(reverse?' strip-back':'');const content=face.cloneNode(true);content.style.left=-(reverse?rect.width-start-w:start)+'px';mask.append(content);strip.append(mask);}sheet.append(strip);strips.push(strip);
    }
    if(spreadMedia.matches){if(direction===1)spread.lastElementChild.replaceWith(leaf(target+1,{side:'right',corners:false}));else spread.firstElementChild.replaceWith(leaf(target,{side:'left',corners:false}));}else spread.replaceChildren(leaf(target,{corners:false}));
    book.append(sheet);book.classList.add('page-turning');turn={direction,corner,target,sheet,strips,gap,width:rect.width,progress:0,frame:0};paintTurn(0);return true;
  }
  function paintTurn(progress){if(!turn)return;const t=turn;t.progress=progress;const wave=Math.sin(progress*Math.PI);let x=t.direction===1?0:t.width,z=0;
    t.strips.forEach((strip,i)=>{const w=strip.foldWidth,angle=Math.PI*progress+wave*.6*(i-1),dy=0,left=t.direction===1?x:x-w;
      strip.style.left=left+'px';strip.style.transform=`translate3d(${-t.direction*t.gap*progress}px,${dy}px,${z}px) rotateY(${-t.direction*angle*180/Math.PI}deg)`;strip.style.setProperty('--strip-shade',Math.abs(Math.sin(angle))*.22);x+=t.direction*Math.cos(angle)*w;z+=Math.sin(angle)*w;
    });book.dataset.turnProgress=progress.toFixed(3);
  }
  function finishTurn(commit){if(!turn)return;cancelAnimationFrame(turn.frame);if(commit)page=turn.target;turn.sheet.remove();turn=null;book.classList.remove('page-turning');delete book.dataset.turnProgress;renderBook();}
  function settleTurn(commit){if(!turn)return;if(reduced()){finishTurn(commit);return;}cancelAnimationFrame(turn.frame);const start=turn.progress,end=commit?1:0,started=performance.now(),duration=Math.max(220,Math.abs(end-start)*680);function tick(now){if(!turn)return;const t=Math.min(1,(now-started)/duration),eased=t*t*(3-2*t);paintTurn(start+(end-start)*eased);if(t<1)turn.frame=requestAnimationFrame(tick);else finishTurn(commit);}turn.frame=requestAnimationFrame(tick);}
  function turnPage(direction,corner='bottom'){if(startTurn(direction,corner))settleTurn(true);}
  $('prev-page').onclick=()=>turnPage(-1);$('next-page').onclick=()=>turnPage(1);
  let pageGrab=null;
  book.addEventListener('pointerdown',e=>{if(e.button!==0||turn||drag)return;const corner=e.target.closest('.page-corner'),vacant=e.target.closest('.physical-pocket.vacant');if(corner&&!corner.disabled){e.stopPropagation();if(startTurn(Number(corner.dataset.turnDirection),corner.dataset.turnCorner)){turn.pointer=e.pointerId;turn.startX=e.clientX;turn.moved=false;book.setPointerCapture(e.pointerId);}}else if(vacant){e.stopPropagation();const leaf=vacant.closest('.binder-leaf'),r=leaf.getBoundingClientRect();pageGrab={id:e.pointerId,x:e.clientX,y:e.clientY,side:leaf.classList.contains('leaf-left')?-1:1,corner:e.clientY<r.top+r.height/2?'top':'bottom'};book.setPointerCapture(e.pointerId);}});
  book.addEventListener('pointermove',e=>{if(pageGrab?.id===e.pointerId){const g=pageGrab,dx=e.clientX-g.x;if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(e.clientY-g.y))return;const direction=dx<0?1:-1;if(spreadMedia.matches&&direction!==g.side)return;if(!startTurn(direction,g.corner))return;turn.pointer=e.pointerId;turn.startX=g.x;turn.moved=true;pageGrab=null;}if(!turn||turn.pointer!==e.pointerId)return;const distance=(turn.startX-e.clientX)*turn.direction;if(Math.abs(distance)>4)turn.moved=true;paintTurn(Math.acos(Math.max(-1,Math.min(1,1-distance/turn.width)))/Math.PI);});
  book.addEventListener('pointerup',e=>{if(pageGrab?.id===e.pointerId){pageGrab=null;if(book.hasPointerCapture(e.pointerId))book.releasePointerCapture(e.pointerId);return;}if(!turn||turn.pointer!==e.pointerId)return;const commit=!turn.moved||turn.progress>.28;turn.pointer=null;if(book.hasPointerCapture(e.pointerId))book.releasePointerCapture(e.pointerId);settleTurn(commit);e.preventDefault();});
  function cancelPageGesture(e){if(pageGrab?.id===e.pointerId)pageGrab=null;if(turn?.pointer===e.pointerId){turn.pointer=null;settleTurn(false);}}
  book.addEventListener('pointercancel',cancelPageGesture);book.addEventListener('lostpointercapture',cancelPageGesture);

  function returnCard(current){const ghost=current.ghost;if(!ghost){current.source.classList.remove('lifted-out');return;}const rect=current.source.getBoundingClientRect(),from=ghost.getBoundingClientRect();if(reduced()){ghost.remove();current.source.classList.remove('lifted-out');return;}ghost.style.transition='left .2s ease, top .2s ease, transform .2s ease';Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',transform:'none'});setTimeout(()=>{ghost.remove();current.source.classList.remove('lifted-out');},220);}
  function dropInto(c,from,slot=null,stack=0){if(!place(c.key,slot,stack))return false;const node=document.querySelector('[data-card-key="'+CSS.escape(c.key)+'"]');if(node&&from&&!reduced()){const to=node.getBoundingClientRect();node.animate([{translate:`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`,scale:String(from.width/to.width)},{translate:'0px 0px',scale:'1'}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});}return true;}
  function clearDrag({keepGhost=false}={}){if(!drag)return;cancelAnimationFrame(drag.scrollFrame);drag.catchUp?.cancel();if(!keepGhost){drag.source.classList.remove('lifted-out');drag.ghost?.remove();}drag.glass?.remove();document.querySelectorAll('.drop-ready,.drop-blocked').forEach(n=>n.classList.remove('drop-ready','drop-blocked'));document.body.classList.remove('holding-card');drag=null;}
  // Keep the original point held by the pointer. Never bake sideways drift
  // during constrained extraction into the free card's grab offset.
  function positionHeldCard(d,e){Object.assign(d.ghost.style,{left:(e.clientX-d.grabX)+'px',top:(e.clientY-d.grabY)+'px',transformOrigin:d.grabX+'px '+d.grabY+'px',transform:`rotate(${Math.max(-5,Math.min(5,(e.clientX-d.x)*.015))}deg) scale(1.025)`});}
  function updateExtraction(e){if(!drag)return;const d=drag,dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<5)return;
    if(!d.moved){d.moved=true;d.source.classList.add('lifted-out');document.body.classList.add('holding-card');const ghost=document.createElement('img');ghost.className='held-card';ghost.src=d.source.querySelector('img').src;ghost.alt='';Object.assign(ghost.style,{left:d.rect.left+'px',top:d.rect.top+'px',width:d.rect.width+'px',height:d.rect.height+'px'});document.body.append(ghost);d.ghost=ghost;if(d.inSleeve){const glass=document.createElement('div');glass.className='extraction-glass';document.body.append(glass);d.glass=glass;}}
    if(d.inSleeve&&!d.extracted){const origin=d.source.getBoundingClientRect(),up=Math.max(0,origin.top+d.grabY-e.clientY);Object.assign(d.ghost.style,{left:origin.left+'px',top:(origin.top-up)+'px',transform:'none'});Object.assign(d.glass.style,{left:origin.left-4+'px',top:origin.top+7+'px',width:origin.width+8+'px',height:origin.height-3+'px'});if(up>=origin.height+8){d.extracted=true;d.ghost.dataset.free='true';const offset=origin.left-(e.clientX-d.grabX);positionHeldCard(d,e);if(!reduced()&&Math.abs(offset)>1)d.catchUp=d.ghost.animate([{translate:offset+'px 0px'},{translate:'0px 0px'}],{duration:140,easing:'cubic-bezier(.16,1,.3,1)'});}}
    else {positionHeldCard(d,e);d.ghost.dataset.free='true';}
    document.querySelectorAll('.drop-ready,.drop-blocked').forEach(n=>n.classList.remove('drop-ready','drop-blocked'));
    if(d.extracted){if(d.glass){d.glass.remove();d.glass=null;}Object.assign(d.ghost.style,{width:d.rect.width+'px',height:d.rect.height+'px'});const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]');if(hit){const blocked=hit.hasAttribute('data-slot')&&layout.slots[Number(hit.dataset.slot)];if(!blocked)hit.classList.add('drop-ready');}}
  }
  table.addEventListener('pointerdown',e=>{const source=e.target.closest('[data-card-key]');if(!source||source.disabled||e.button!==0||turn||drag)return;const rect=source.getBoundingClientRect(),inSleeve=!!source.closest('.physical-pocket');drag={id:e.pointerId,key:source.dataset.cardKey,source,rect,x:e.clientX,y:e.clientY,grabX:e.clientX-rect.left,grabY:e.clientY-rect.top,moved:false,inSleeve,extracted:!inSleeve,last:{clientX:e.clientX,clientY:e.clientY}};table.setPointerCapture(e.pointerId);
    function scroll(){if(!drag)return;if(drag.moved&&drag.inSleeve&&!drag.extracted&&drag.last.clientY<55&&window.scrollY>0){window.scrollBy(0,-8);updateExtraction(drag.last);}drag.scrollFrame=requestAnimationFrame(scroll);}drag.scrollFrame=requestAnimationFrame(scroll);
  });
  table.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;drag.last={clientX:e.clientX,clientY:e.clientY};updateExtraction(e);});
  table.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const current=drag,c=cards.find(c=>c.key===current.key),hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]'),from=current.ghost?.getBoundingClientRect();const blocked=current.moved&&(!current.extracted||(hit?.hasAttribute('data-slot')&&layout.slots[Number(hit.dataset.slot)]));clearDrag({keepGhost:blocked});if(table.hasPointerCapture(e.pointerId))table.releasePointerCapture(e.pointerId);if(!c)return;
    if(blocked){returnCard(current);if(current.extracted)note('That sleeve is occupied. Use the stacks to make room.');}
    else if(current.moved&&hit?.hasAttribute('data-slot'))dropInto(c,from,Number(hit.dataset.slot));
    else if(current.moved&&hit?.hasAttribute('data-pile-drop'))dropInto(c,from,null,Number(hit.dataset.pileDrop));

    else {cardDetail(c,{from,holding:current.moved});if(current.moved)current.source.classList.add('lifted-out');}e.preventDefault();
  });
  table.addEventListener('pointercancel',()=>clearDrag());table.addEventListener('lostpointercapture',()=>{if(drag)clearDrag();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(turn){e.preventDefault();settleTurn(false);}if(drag){e.preventDefault();clearDrag();}}});
  spreadMedia.addEventListener('change',()=>{clearDrag();if(turn)finishTurn(false);page=Math.floor(page/pageStep())*pageStep();if(theme==='binder')renderCards();});

  const oldShowDetail=showDetail;
  showDetail=function(html){runtime?.focusRoom();closeFloat();detailFan?.destroy();detailFan=null;$('detail').classList.remove('pokemon-fan-detail');oldShowDetail(html);};
  cardDetail=function(c,{from=null,holding=false}={}){
    if(runtime&&theme!=='binder'){closeFloat();runtime.openDetail(c.key);return;}
    const origin=locate(c.key),inBinder=origin.slot!==undefined,physical=theme==='binder';
    showDetail(`<div class="detail-grid holding-detail"><img class="detail-card" src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} card"><div><p class="eyebrow">${holding?'IN YOUR HANDS':'A LITTLE CLOSER'}</p><h2>${escapeHTML(c.name)}</h2><p>${escapeHTML(c.set)} · ${escapeHTML(c.edition)}<br>${escapeHTML(c.type)} type</p><strong class="detail-value">${valueOfCard(c)}</strong><p>${runtime?escapeHTML(runtime.fx):'Sample value · AUD'}</p><div class="detail-actions">${physical?`<button id="put-back">${inBinder?'Slide back into its sleeve':'Return to stack '+(origin.stack+1)}</button><button id="change-place">${inBinder?'Lay on stack one':'Slide into an empty sleeve'}</button><button id="second-stack">${inBinder?'Lay on stack two':'Move to stack '+(origin.stack===0?2:1)}</button>`:''}<button id="meet-pokemon">Fan out my ${escapeHTML(c.name)} cards ↗</button></div></div></div>`);
    if(physical){$('second-stack').onclick=()=>{place(c.key,null,inBinder?1:1-origin.stack);$('detail').close();};$('put-back').onclick=()=>$('detail').close();$('change-place').onclick=()=>{if(inBinder)place(c.key);else freeSleeve(c.key);$('detail').close();};}
    if(runtime){$('meet-pokemon').textContent='Full card details ↗';$('meet-pokemon').onclick=()=>{$('detail').close();runtime.openDetail(c.key);};}else $('meet-pokemon').onclick=()=>speciesDetail(c);
    if(from&&!reduced())requestAnimationFrame(()=>{const image=$('detail-content').querySelector('.detail-card'),to=image.getBoundingClientRect();image.animate([{transformOrigin:'top left',transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`},{transformOrigin:'top left',transform:'none'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});});
  };
  function closeFloat(restore=false){floatFan?.destroy();floatFan=null;$('pokemon-float')?.remove();floatAnchor?.classList.remove('activated');if(restore)floatAnchor?.focus({preventScroll:true});floatAnchor=null;}
  speciesDetail=function(p){
    closeFloat();if($('detail').open)$('detail').close();const copies=cards.filter(c=>hasSpecies(c,p.id)),anchor=document.querySelector('[data-pokemon="'+p.id+'"]');floatAnchor=anchor;
    if(anchor){anchor.classList.add('activated');if(!reduced())anchor.querySelector('img').animate([{transform:'scale(1)'},{transform:'scale(1.12,.88) rotate(-5deg)',offset:.25},{transform:'translateY(-14px) scale(.94,1.08) rotate(4deg)',offset:.55},{transform:'scale(1)'}],{duration:440,easing:'ease-out'});}
    const panel=document.createElement('section');panel.id='pokemon-float';panel.className='pokemon-float';panel.setAttribute('role','region');panel.setAttribute('aria-label',p.name+' cards');panel.innerHTML=`<div id="species-fan" class="card-fan" tabindex="0" role="region" aria-label="Fan of your ${escapeHTML(p.name)} cards. Swipe to browse; Escape to close."></div>`;document.body.append(panel);
    const rect=anchor?.getBoundingClientRect(),width=Math.min(540,innerWidth-16),height=Math.min(390,innerHeight-24),left=Math.max(8,Math.min(innerWidth-width-8,(rect?rect.left+rect.width/2:innerWidth/2)-width/2)),top=Math.max(12,Math.min(innerHeight-height-12,(rect?rect.top+rect.height*.5:innerHeight/2)-height*.5));Object.assign(panel.style,{width:width+'px',height:height+'px',left:left+'px',top:top+'px'});
    floatFan=makeFan($('species-fan'),copies,{onOpen:c=>{closeFloat();cardDetail(c);}});$('species-fan').focus({preventScroll:true});
    if(!reduced())panel.animate([{opacity:0,transform:'translateY(25px) scale(.85)'},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.16,1,.3,1)'});
  };
  document.addEventListener('pointerdown',e=>{if(floatFan&&!e.target.closest('#pokemon-float,.habitat-pokemon'))closeFloat();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&floatFan){closeFloat(true);e.preventDefault();}});window.addEventListener('resize',()=>closeFloat());
  $('detail').addEventListener('close',()=>{detailFan?.destroy();detailFan=null;if(theme==='binder')renderCards();});

  // Cache the artwork alpha once, then resolve the visible pixel from front to
  // back. Keyboard focus remains on the original, accessibly named buttons.
  const alphaMaps=new Map();
  function prepareHitMask(node){const image=node.querySelector('img'),key=node.dataset.pokemon;
    function prepare(){let mask=alphaMaps.get(key);if(!mask||mask.src!==image.src){const canvas=document.createElement('canvas'),scale=Math.min(1,160/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);mask={src:image.src,width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};alphaMaps.set(key,mask);if(alphaMaps.size>128)alphaMaps.delete(alphaMaps.keys().next().value);}node.dataset.hitReady='true';
      node.zooHit=(x,y)=>{const r=image.getBoundingClientRect(),scale=Math.min(r.width/mask.width,r.height/mask.height),w=mask.width*scale,h=mask.height*scale,px=Math.floor((x-r.left-(r.width-w)/2)/scale),py=Math.floor((y-r.top-(r.height-h)/2)/scale);return px>=0&&py>=0&&px<mask.width&&py<mask.height&&mask.data[(py*mask.width+px)*4+3]>=24;};
    }
    if(image.complete&&image.naturalWidth)prepare();else image.addEventListener('load',prepare,{once:true});
  }
  function bindScenePointers(scene){let active=null,hover=null;
    const hit=e=>[...scene.children].reverse().sort((a,b)=>Number(b.style.zIndex)-Number(a.style.zIndex)).find(n=>n.zooHit?.(e.clientX,e.clientY));
    function highlight(node){if(hover===node)return;hover?.classList.remove('art-hovered');hover=node;hover?.classList.add('art-hovered');scene.style.cursor=node?'grab':'';}
    scene.onpointerdown=e=>{if(e.button!==0||active)return;const node=hit(e);if(!node)return;active=node;highlight(null);node.zooStart(e);};
    scene.onpointermove=e=>{if(active)active.zooDrag(e);else if(e.pointerType!=='touch')highlight(hit(e));};
    scene.onpointerleave=()=>{if(!active)highlight(null);};
    scene.onpointerup=e=>{const node=active;active=null;node?.zooFinish(e);if(e.pointerType!=='touch')highlight(hit(e));};
    scene.onpointercancel=scene.onlostpointercapture=e=>{const node=active;active=null;node?.zooFinish(e,true);highlight(null);};
    scene.cancelGesture=()=>{active?.zooCancel();active=null;highlight(null);};
  }

  const families=[[1,2],[4,5,6],[7,9],[25,26],[94,93],[129],[133],[143],[149],[151]];
  let habitatList=[];
  renderHabitat=function(list){const scene=$('habitat-creatures');if(!scene)return;habitatList=list;closeFloat();scene.cancelGesture?.();scene.replaceChildren();const world=scene.parentElement,width=world.clientWidth||800,columns=width<500?3:width<850?4:6,cell=width/columns,rowHeight=cell*1.04,groups=(runtime?[...new Set(list.map(p=>p.family))].sort((a,b)=>a-b).map(f=>list.filter(p=>p.family===f).sort((a,b)=>a.id-b.id)):families.map(f=>f.map(id=>list.find(p=>p.id===id)).filter(Boolean))).filter(f=>f.length).flatMap(group=>Array.from({length:Math.ceil(group.length/columns)},(_,i)=>group.slice(i*columns,(i+1)*columns))),rows=[];
    if(!runtime)for(const p of list)if(!families.flat().includes(p.id))groups.push([p]);while(groups.length){const row=[];for(let i=0;i<groups.length;){if(row.length+groups[i].length<=columns)row.push(...groups.splice(i,1)[0]);else i++;}rows.push(row);}const height=Math.max(300,rows.length*rowHeight+cell*.28+35);world.style.height=height+'px';
    rows.forEach((row,r)=>row.forEach((p,col)=>{const size=cell*([6,9,143,149].includes(p.id)?.92:.84),defaultPoint=[((columns-row.length)/2+col+.5)/columns*100,(cell*.14+(r+.5)*rowHeight)/height*100];let point=layout.positions[p.id];if(!Array.isArray(point)||point.length!==2||!point.every(n=>Number.isFinite(n)&&n>=0&&n<=100))point=defaultPoint;
      const b=document.createElement('button');b.className='habitat-pokemon';b.dataset.pokemon=p.id;b.setAttribute('aria-label',p.name+', '+count(p.id)+' cards. Drag to move; tap to browse cards.');b.style.setProperty('--creature-size',size+'px');b.style.left=point[0]+'%';b.style.top=point[1]+'%';b.style.zIndex=Math.round(point[1]);b.innerHTML=`<img src="${escapeHTML(art['pokemon-'+p.id])}" alt="${escapeHTML(p.name)}" draggable="false">`;
      let gesture=null;const move=()=>{b.style.left=point[0]+'%';b.style.top=point[1]+'%';};
      b.zooPoint=()=>point;b.zooMove=next=>{point=next;move();b.style.zIndex=Math.round(point[1]);};
      function nudge(){const bounds=scene.getBoundingClientRect();for(let pass=0;pass<3;pass++)for(const other of scene.children){if(other===b)continue;const op=other.zooPoint(),dx=(op[0]-point[0])*bounds.width/100,dy=(op[1]-point[1])*bounds.height/100,distance=Math.hypot(dx,dy),radius=(size+other.offsetWidth)*.28;if(distance>=radius)continue;const ux=distance?dx/distance:1,uy=distance?dy/distance:.2,push=(radius-distance)*.48,mx=other.offsetWidth*.5/bounds.width*100,my=other.offsetHeight*.5/bounds.height*100,next=[Math.max(mx,Math.min(100-mx,op[0]+ux*push/bounds.width*100)),Math.max(my,Math.min(100-my,op[1]+uy*push/bounds.height*100))];other.zooMove(next);layout.positions[other.dataset.pokemon]=next;}}

      b.zooStart=e=>{if(e.button!==0)return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,point:[...point],snapshot:[...scene.children].map(n=>[n,[...n.zooPoint()]]),positions:JSON.parse(JSON.stringify(layout.positions)),rect:scene.getBoundingClientRect(),moved:false};scene.setPointerCapture(e.pointerId);};
      b.zooDrag=e=>{if(!gesture||e.pointerId!==gesture.id||runtime?.readOnly)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(!gesture.moved&&Math.hypot(dx,dy)<5)return;if(!gesture.moved)closeFloat();gesture.moved=true;b.classList.add('being-moved');const mx=size*.5/gesture.rect.width*100,my=size*.5/gesture.rect.height*100;point=[Math.max(mx,Math.min(100-mx,gesture.point[0]+dx/gesture.rect.width*100)),Math.max(my,Math.min(100-my,gesture.point[1]+dy/gesture.rect.height*100))];move();nudge();b.style.zIndex='100';};
      function finish(e,cancelled=false){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;gesture=null;b.classList.remove('being-moved');if(scene.hasPointerCapture(e.pointerId))scene.releasePointerCapture(e.pointerId);if(cancelled){for(const [node,previous] of g.snapshot)node.zooMove(previous);layout.positions=g.positions;point=g.point;move();}else if(g.moved){layout.positions[p.id]=point;persist();}else speciesDetail(p);b.style.zIndex=Math.round(point[1]);e.preventDefault();}
      b.zooFinish=finish;b.zooCancel=()=>{if(gesture)finish({pointerId:gesture.id,preventDefault(){}},true);};b.onclick=e=>{if(e.detail===0)speciesDetail(p);};
      b.addEventListener('keydown',e=>{if(runtime?.readOnly||!e.shiftKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();point=[Math.max(7,Math.min(93,point[0]+(e.key==='ArrowRight'?2:e.key==='ArrowLeft'?-2:0))),Math.max(9,Math.min(91,point[1]+(e.key==='ArrowDown'?2:e.key==='ArrowUp'?-2:0)))];layout.positions[p.id]=point;persist();move();});scene.append(b);prepareHitMask(b);
    }));bindScenePointers(scene);};
  const arrange=document.createElement('button');arrange.className='arrange-pokemon';arrange.textContent='Arrange Pokémon';arrange.onclick=()=>{if(runtime?.readOnly){note('Reload before arranging this collection.');return;}layout.positions={};persist();renderHabitat(habitatList);};$('habitat-scroll')?.before(arrange);if(!$('habitat-scroll'))document.querySelector('.habitat-scroll')?.before(arrange);
  const share=document.createElement('button');share.id='share-zoo';share.className='share-zoo';share.textContent='Share picture ↗';arrange.before(share);
  share.onclick=async()=>{if(share.disabled)return;share.disabled=true;share.textContent='Making your picture…';try{const scene=$('habitat-creatures'),rect=scene.getBoundingClientRect(),scale=Math.min(3,1600/rect.width),canvas=document.createElement('canvas'),footer=65;canvas.width=Math.round(rect.width*scale);canvas.height=Math.round((rect.height+footer)*scale);const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#f0f2ec';ctx.fillRect(0,0,rect.width,rect.height+footer);for(const node of [...scene.children].sort((a,b)=>Number(a.style.zIndex)-Number(b.style.zIndex))){const image=node.querySelector('img');await image.decode();const point=node.zooPoint(),w=node.offsetWidth;ctx.drawImage(image,point[0]*rect.width/100-w/2,point[1]*rect.height/100-w/2,w,w);}ctx.fillStyle='#264c3b';ctx.font='bold 18px Georgia';ctx.fillText('My Pokémon Zoo',20,rect.height+28);ctx.font='11px sans-serif';ctx.fillStyle='#778c76';ctx.fillText(owned().length+' Pokémon · PokéSift',20,rect.height+47);const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image unavailable')),'image/png')),file=new File([blob],'my-pokemon-zoo.png',{type:'image/png'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'My Pokémon Zoo'});}catch(error){if(error.name==='AbortError')return;downloadZoo(blob);}}else downloadZoo(blob);}catch{note('Could not create the picture. Please try again.');}finally{share.disabled=false;share.textContent='Share picture ↗';}};
  function downloadZoo(blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='my-pokemon-zoo.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('Your Zoo picture is ready.');}
  let sceneWidth=0;const sceneObserver=new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width&&width!==sceneWidth){sceneWidth=width;if(theme==='zoo')renderHabitat(habitatList);}});if(document.querySelector('.habitat-scroll'))sceneObserver.observe(document.querySelector('.habitat-scroll'));
  $('reset-demo').onclick=()=>{if(runtime)return;clearDrag();closeFloat();if(turn)finishTurn(false);cards=initial();layout={slots:[],piles:[[],[]],positions:{}};page=0;index=0;filter='All';dexFilter='All';sort='recent';missing=false;newFriend=null;$('sort').value=sort;reconcile();persist();render();note('Demo arrangement reset.');};
  labels.desk='B · The Fan';labels.zoo='C · Pokémon Zoo';
  document.querySelectorAll('[data-surface]').forEach(a=>{if(a.dataset.surface===theme)a.setAttribute('aria-current','page');});
  const baseRender=render;render=function(){baseRender();$('hero-copy').textContent=theme==='binder'?'Pull up a card. Find it a home. Every sleeve is yours.':theme==='desk'?'Hold, slide, sift. The cards move with you.':'Your Pokémon. A little room to be themselves.';if(theme==='binder'){$('card-heading').textContent='Your binder. Two stacks. Make yourself at home.';}if(theme==='zoo'){$('hero-title').innerHTML='All your favourites.<br><em>Room to be themselves.</em>';$('eyebrow').textContent='YOUR POKÉMON';}};
  function renderLive(){if(!runtime)return;const known=cards.filter(c=>c.value!==null);$('collection-value').textContent=known.length?money(known.reduce((sum,c)=>sum+c.value,0)):'Value unknown';$('no-cards').textContent=cards.length?'No cards match this view.':'Your cards will appear here after you add them.';if(theme==='zoo'){$('zoo-empty').hidden=owned().length>0;$('share-zoo').disabled=!owned().length;const unknown=runtime.unclassified||[];$('unclassified-cards').hidden=!unknown.length;$('unclassified-summary').textContent=unknown.length+' cards need a Pokémon name';$('unclassified-list').replaceChildren();for(const c of unknown){const b=document.createElement('button');b.textContent=c.name+' ↗';b.onclick=()=>runtime.openDetail(c.key);$('unclassified-list').append(b);}$('room-art-status').textContent=runtime.artUnavailable?'Some Pokémon artwork is unavailable. Your cards are still saved.':'';$('retry-artwork').hidden=!runtime.artUnavailable;}}
  if(runtime){const liveBase=render;render=()=>{liveBase();renderLive();};$('room-search').oninput=e=>{runtime.query=e.target.value.trim().toLowerCase();index=0;renderCards();};$('retry-artwork').onclick=()=>runtime.retryArtwork();let pending=null,timer=0;function apply(){if(!pending)return;if(drag||turn||floatFan||$('detail').open||document.querySelector('.being-moved,.tactile-fan.is-dragging')){timer=setTimeout(apply,120);return;}const data=runtime.current();pending=null;Object.assign(runtime,data);cards=data.cards;pokemon.splice(0,pokemon.length,...data.pokemon);Object.assign(art,data.art);layout=structuredClone(data.layout);reconcile();render();}runtime.ready({update(data){pending=data;clearTimeout(timer);apply();}});}
  reconcile();render();
})();
