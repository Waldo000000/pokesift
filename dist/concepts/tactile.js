'use strict';
// Shared physical interactions. Demo pages are isolated; the live room persists
// through the parent collection bridge and never initiates a scan.
(() => {
  const STORE='pokesift.prototype.physical.v2';
  const reduced=()=>window.PokeSiftMotion?.matches||false;
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
    let position=Math.min(initialIndex,Math.max(0,list.length-1)),target=position,frame=0,gesture=null,lastLabel=-1,reveal=1,revealFrame=0,revealTarget=1,revealAnchor=position,gapWeights=null,gestureTimer=0;
    host.classList.add('tactile-fan');host.replaceChildren();
    const buttons=list.map((c,i)=>{const b=document.createElement('button');b.className='fan-card';b.dataset.fanIndex=i;b.setAttribute('aria-label',c.name+', '+valueOfCard(c));b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} ${escapeHTML(c.edition)}" draggable="false" loading="lazy" decoding="async"><span class="fan-price">${valueOfCard(c)}</span>`;b.onclick=e=>{if(e.detail===0){if(Math.round(position)===i)onOpen(c);else go(i);}};host.append(b);return b;});
    const step=()=>host.clientWidth<500?105:145;
    const spacing=()=>host.clientWidth<500?30:43;
    const flickGesture={maxMs:420,pauseMs:180,minPixels:12,minSpeed:.12,straightness:.75};
    function paint(){
      const mobile=host.clientWidth<500,selected=Math.max(0,Math.min(list.length-1,Math.round(position)));
      const cardWidth=buttons[0]?.offsetWidth||180,gap=spacing(),radius=mobile?900:1250;
      buttons.forEach((b,i)=>{const d=i-position,a=Math.abs(d),fraction=Math.max(0,Math.min(1,i-revealAnchor)),opening=gapWeights?.[i]??fraction*fraction*(3-2*fraction),arc=d*gap+opening*cardWidth*.88*reveal,angle=arc/radius;
        b.style.transform=`translateX(calc(-50% + ${Math.sin(angle)*radius}px)) translateY(${(1-Math.cos(angle))*radius}px) rotate(${angle*180/Math.PI}deg)`;const fade=list.length>30?Math.max(0,Math.min(1,(a-10)/8)):0,opacity=1-fade*fade*(3-2*fade);b.style.opacity=String(opacity);b.style.zIndex=String(i+1);b.style.visibility=opacity>0?'visible':'hidden';b.style.willChange=opacity>0?'transform':'auto';b.style.pointerEvents=opacity>0?'auto':'none';b.classList.toggle('selected',i===selected);b.tabIndex=i===selected?0:-1;b.setAttribute('aria-pressed',String(i===selected));b.querySelector('.fan-price').style.opacity=String(Math.max(0,1-a*2));});
      host.dataset.position=position.toFixed(3);host.dataset.reveal=reveal.toFixed(3);
      if(selected!==lastLabel){lastLabel=selected;onChange(selected,list[selected]);}
    }
    // Keep the opening attached to the same cards until it has closed. Moving
    // that opening with the selection made a steady drag reverse a card's path.
    function maybeReveal(){if(!gesture&&!frame&&reveal===0){gapWeights=null;revealAnchor=position;revealTo(1);}}
    function revealTo(next){
      if(revealTarget===next&&revealFrame)return;
      revealTarget=next;cancelAnimationFrame(revealFrame);revealFrame=0;
      if(reduced()||reveal===next){reveal=next;paint();return;}
      const from=reveal,started=performance.now(),duration=next===1?240:200;
      function tick(now){const t=Math.min(1,Math.max(0,(now-started)/duration)),ease=t*t*(3-2*t);reveal=from+(next-from)*ease;paint();if(t<1)revealFrame=requestAnimationFrame(tick);else{revealFrame=0;if(next===0)maybeReveal();}}
      revealFrame=requestAnimationFrame(tick);
    }
    function go(next,{flick=false}={}){
      target=Math.max(0,Math.min(list.length-1,next));cancelAnimationFrame(frame);frame=0;
      if(reduced()){cancelAnimationFrame(revealFrame);revealFrame=0;position=target;gapWeights=null;revealAnchor=position;reveal=revealTarget=1;paint();return;}
      if(flick){
        // Move directly between the two open poses. Interpolating each card's
        // gap offset preserves the fan's opening throughout the transition.
        cancelAnimationFrame(revealFrame);revealFrame=0;
        const from=position,started=performance.now(),gaps=list.map((_,i)=>{const f=Math.max(0,Math.min(1,i-revealAnchor));return (gapWeights?.[i]??f*f*(3-2*f))*reveal;});
        gapWeights=gaps;reveal=revealTarget=1;
        function stepFlick(now){const t=Math.min(1,Math.max(0,(now-started)/220)),ease=1-Math.pow(1-t,3);position=from+(target-from)*ease;gapWeights=gaps.map((gap,i)=>gap+((i>target?1:0)-gap)*ease);if(t===1){position=target;revealAnchor=target;gapWeights=null;frame=0;}paint();if(t<1)frame=requestAnimationFrame(stepFlick);}
        frame=requestAnimationFrame(stepFlick);return;
      }
      revealTo(0);
      const from=position,started=performance.now(),duration=160;
      if(Math.abs(target-from)<.001){position=target;paint();maybeReveal();return;}
      // Both dragging and single-card flicks use this bounded ease: no overshoot.
      function settle(now){const t=Math.min(1,Math.max(0,(now-started)/duration));position=from+(target-from)*(1-Math.pow(1-t,3));paint();if(t<1)frame=requestAnimationFrame(settle);else{position=target;frame=0;paint();maybeReveal();}}
      frame=requestAnimationFrame(settle);
    }
    function follow(){
      // Coalesce pointer events into one paint per frame, without a trailing
      // smoothing animation: the card position always uses the latest input.
      position=target;
      if(reduced()){paint();return;}
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint();});
    }
    function followPointer(x){
      const dx=x-gesture.x,max=Math.max(0,list.length-1);
      // A held deck tracks the original touch, including movement made while
      // the gesture was still a capped, single-card flick preview.
      let raw=gesture.position-dx/(gesture.dragging?spacing():step());
      if(!gesture.dragging){const next=Math.max(0,Math.min(max,gesture.startIndex-Math.sign(dx)));raw=dx>0?Math.max(next,raw):Math.min(next,raw);}
      target=raw<0?raw*.2:raw>max?max+(raw-max)*.2:raw;gesture.appliedX=x;follow();
    }
    function beginDrag(){if(!gesture||!gesture.moved||gesture.dragging)return;clearTimeout(gestureTimer);gesture.dragging=true;revealTo(0);followPointer(gesture.appliedX);}
    host.addEventListener('pointerdown',e=>{if(e.button!==0||!list.length||gesture)return;const startIndex=Math.round(frame?target:position),now=performance.now();cancelAnimationFrame(frame);frame=0;cancelAnimationFrame(revealFrame);revealFrame=0;target=position;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,position,startIndex,started:now,lastMove:now,lastX:e.clientX,appliedX:e.clientX,path:0,moved:false,dragging:false,card:Number(e.target.closest('[data-fan-index]')?.dataset.fanIndex??-1)};host.setPointerCapture(e.pointerId);host.classList.add('is-dragging');},{signal});
    host.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.x,delta=Math.abs(e.clientX-gesture.lastX);if(delta>.5){gesture.path+=delta;gesture.lastX=e.clientX;gesture.lastMove=performance.now();}if(Math.abs(dx)>4)gesture.moved=true;if(!gesture.moved)return;
      if(!gesture.dragging){const remaining=flickGesture.maxMs-(performance.now()-gesture.started);clearTimeout(gestureTimer);if(remaining<=0||Math.abs(dx)<gesture.path*flickGesture.straightness)beginDrag();else gestureTimer=setTimeout(beginDrag,Math.min(flickGesture.pauseMs,remaining));}
      // A quick sweep can span the screen, but previews at most the next card.
      followPointer(e.clientX);},{signal});
    function release(e,cancelled=false){if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;clearTimeout(gestureTimer);gesture=null;host.classList.remove('is-dragging');if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(cancelled){go(Math.round(g.position));return;}if(g.moved){
        const now=performance.now(),dx=e.clientX-g.x,dy=e.clientY-g.y,distance=Math.abs(dx),duration=now-g.started;
        // A quick release steps one card regardless of swipe length. A hold,
        // pause or reversal remains a drag, with no added velocity impulse.
        const flick=!g.dragging&&duration<=flickGesture.maxMs&&distance>=flickGesture.minPixels&&distance/Math.max(1,duration)>=flickGesture.minSpeed&&now-g.lastMove<=flickGesture.pauseMs&&distance>=Math.abs(dy)*1.15&&distance>=g.path*flickGesture.straightness;
        go(flick?g.startIndex-Math.sign(dx):Math.round(target),{flick});
      }else if(g.card>=0){if(g.card===Math.round(position)){go(Math.round(position));onOpen(list[g.card]);}else go(g.card);}else go(Math.round(position));e.preventDefault();}
    host.addEventListener('pointerup',e=>release(e),{signal});host.addEventListener('pointercancel',e=>release(e,true),{signal});host.addEventListener('lostpointercapture',e=>{if(gesture)release(e,true);},{signal});
    host.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(target+(e.key==='ArrowRight'?1:-1));}},{signal});
    const observer=new ResizeObserver(paint);observer.observe(host);paint();
    return {go,step:delta=>go(target+delta),destroy(){clearTimeout(gestureTimer);cancelAnimationFrame(frame);cancelAnimationFrame(revealFrame);controller.abort();observer.disconnect();},get selected(){return Math.round(position);},get selectedKey(){return list[Math.round(position)]?.key;}};
  }

  const aside=$('binder-layout').querySelector('.binder-aside');
  aside.innerHTML='<p class="eyebrow">MAKE A LITTLE ROOM</p><h3>Your stacks</h3><div class="stack-spots"><section><h4>Stack one <span id="pile-count-0"></span></h4><div id="card-pile" class="card-pile" data-pile-drop="0" role="region" aria-label="Stack one"></div></section><section><h4>Stack two <span id="pile-count-1"></span></h4><div id="card-pile-1" class="card-pile" data-pile-drop="1" role="region" aria-label="Stack two"></div></section></div><p class="pile-instructions">Drag cards in any direction. Drop into any empty sleeve or onto either stack. Drag an empty sleeve to turn the page.</p><p id="physical-count" class="physical-count" role="status"></p>';
  const table=$('binder-layout'),book=table.querySelector('.binder-book');
  table.classList.add('physical-table');
  book.querySelector('#pocket-grid').replaceWith(Object.assign(document.createElement('div'),{id:'binder-spread',className:'binder-spread'}));
  $('card-fan').onpointerdown=$('card-fan').onpointerup=$('card-fan').onpointercancel=$('card-fan').onkeydown=null;
  $('thumbnail-rail').hidden=true;
  function leaf(pageNumber,{side='right',corners=true}={}) {
    const sheet=document.createElement('section');sheet.className='binder-leaf leaf-'+side;sheet.dataset.page=pageNumber;sheet.setAttribute('aria-label','Binder page '+(pageNumber+1));
    const grid=document.createElement('div');grid.className='pocket-grid';
    layout.slots.slice(pageNumber*9,pageNumber*9+9).forEach((key,i)=>{const slot=pageNumber*9+i,c=cards.find(c=>c.key===key),pocket=document.createElement('div');pocket.className='physical-pocket'+(!c?' vacant':'');pocket.dataset.slot=slot;
      if(c){const b=document.createElement('button');b.className='sleeved-card';b.dataset.cardKey=c.key;b.setAttribute('aria-label',c.name+'. Drag to move, or tap for details.');b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} card" draggable="false">`;b.onclick=e=>{if(e.detail===0)cardDetail(c);};pocket.append(b);}else{const label=document.createElement('span');label.className='sleeve-number';label.textContent=String(slot+1).padStart(2,'0');pocket.append(label);}
      const sleeve=document.createElement('div');sleeve.className='sleeve-front';sleeve.setAttribute('aria-hidden','true');pocket.append(sleeve);grid.append(pocket);
    });sheet.append(grid);
    const number=document.createElement('span');number.className='leaf-number';number.textContent=String(pageNumber+1).padStart(2,'0');sheet.append(number);
    if(corners){const directions=spreadMedia.matches?[side==='right'?1:-1]:[-1,1];for(const direction of directions)for(const corner of ['top','bottom']){const button=document.createElement('button');button.className='page-corner corner-'+corner+(direction===1?' corner-right':' corner-left');button.dataset.turnDirection=direction;button.dataset.turnCorner=corner;button.disabled=page+direction*pageStep()<0||page+direction*pageStep()>=layout.slots.length/9;button.setAttribute('aria-label',`Turn ${direction===1?'next':'previous'} page from ${corner} corner`);button.onclick=e=>{if(e.detail===0)turnPage(direction,corner);};sheet.append(button);}}
    return sheet;
  }
  function pageLeaves(start){return Array.from({length:pageStep()},(_,i)=>leaf(start+i,{side:spreadMedia.matches&&i===0?'left':'right'}));}
  function renderBook(leaves=pageLeaves(page)){const spread=$('binder-spread');book.classList.toggle('two-page',spreadMedia.matches);spread.replaceChildren(...leaves);spread.dataset.startPage=page;spread.querySelectorAll('.page-corner').forEach(b=>{const next=page+Number(b.dataset.turnDirection)*pageStep();b.disabled=next<0||next>=layout.slots.length/9;});$('page-label').textContent=spreadMedia.matches?`PAGES ${page+1}–${page+2} / ${layout.slots.length/9}`:`PAGE ${page+1} / ${layout.slots.length/9}`;$('prev-page').disabled=page===0;$('next-page').disabled=page+pageStep()>=layout.slots.length/9;}
  renderCards=function(){
    if(theme==='desk'){
      // First in the sort order belongs on top: the rightmost physical card.
      const selectedKey=fanSelectionReset?null:mainFan?.selectedKey,list=filtered().reverse();
      const retained=list.findIndex(c=>c.key===selectedKey);$('no-cards').hidden=!!list.length;mainFan?.destroy();
      mainFan=makeFan($('card-fan'),list,{initialIndex:retained>=0?retained:Math.max(0,list.length-1),onChange:(i,c)=>{index=i;$('fan-name').textContent=c?.name||'No cards here yet';$('fan-meta').textContent=c?[c.type,c.set,c.edition].join(' · '):'';$('fan-position').textContent=c?`${list.length-i} / ${list.length} CARDS`:'';$('fan-prev').disabled=i<=0;$('fan-next').disabled=i>=list.length-1;}});fanSelectionReset=false;$('thumbnail-rail').replaceChildren();return;
    }
    reconcile();page=Math.floor(Math.max(0,Math.min(page,layout.slots.length/9-1))/pageStep())*pageStep();$('no-cards').hidden=true;renderBook();
    layout.piles.forEach((pileKeys,stack)=>{const pile=$(stack?'card-pile-1':'card-pile');pile.replaceChildren();pile.classList.toggle('empty',!pileKeys.length);pileKeys.slice(-6).forEach((key,j)=>{const i=Math.max(0,pileKeys.length-6)+j,c=cards.find(c=>c.key===key),b=document.createElement('button');b.className='piled-card';b.dataset.cardKey=key;b.setAttribute('aria-label',c.name+' on stack '+(stack+1)+'. Drag into an empty sleeve or the other stack.');b.style.setProperty('--pile-angle',((i*7)%13-6)+'deg');b.style.setProperty('--pile-x',((i*3)%9-4)+'px');b.style.setProperty('--pile-y',Math.min(i,14)*2+'px');b.style.zIndex=i+1;const top=i===pileKeys.length-1;b.disabled=!top;b.tabIndex=top?0:-1;b.setAttribute('aria-hidden',String(!top));b.innerHTML=`<img src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)}" draggable="false">`;b.onclick=e=>{if(e.detail===0&&top)cardDetail(c);};pile.append(b);});$('pile-count-'+stack).textContent=pileKeys.length;});
    $('physical-count').textContent=`${layout.slots.filter(Boolean).length} sleeved · ${layout.piles.flat().length} stacked`;
  };
  $('fan-prev').onclick=()=>mainFan?.step(-1);$('fan-next').onclick=()=>mainFan?.step(1);

  // Three rigid panels hinge at the pocket gutters. Cards stay flat while the
  // plastic between their columns folds; the final pose matches the resting leaf.
  function turnFace(face,column,left,width,height){
    const content=face.cloneNode(false),grid=face.querySelector('.pocket-grid').cloneNode(false);
    // Each panel carries only its own three pockets. Empty grid placeholders
    // preserve the exact page geometry without painting off-panel card copies.
    [...face.querySelector('.pocket-grid').children].forEach((pocket,i)=>grid.append(i%3===column?pocket.cloneNode(true):document.createElement('div')));
    content.append(grid,face.querySelector('.leaf-number').cloneNode(true));
    Object.assign(content.style,{left:left+'px',width:width+'px',height:height+'px'});
    content.querySelectorAll('button').forEach(b=>b.tabIndex=-1);
    content.querySelectorAll('img').forEach(img=>{img.loading='eager';img.decoding='sync';});return content;
  }
  function readyPageImages(leaves){return Promise.allSettled(leaves.flatMap(n=>[...n.querySelectorAll('img')]).map(img=>{img.loading='eager';img.decoding='sync';return img.decode?.();}));}
  function startTurn(direction,corner='bottom') {
    if(turn||drag)return false;const target=page+direction*pageStep();if(target<0||target>=layout.slots.length/9)return false;
    // A single-page binder stays hinged at the left spine in both directions.
    // Going back brings the previous page in by reversing the forward fold.
    const reverseTurn=!spreadMedia.matches&&direction===-1,foldDirection=reverseTurn?1:direction;
    const spread=$('binder-spread'),source=direction===1?spread.lastElementChild:spread.firstElementChild,rect=source.getBoundingClientRect(),bounds=book.getBoundingClientRect(),gap=spreadMedia.matches?parseFloat(getComputedStyle(spread).gap):0;
    const sheet=document.createElement('div');sheet.className='turning-sheet curved-sheet';sheet.setAttribute('aria-hidden','true');sheet.inert=true;Object.assign(sheet.style,{left:rect.left-bounds.left+'px',top:rect.top-bounds.top+'px',width:rect.width+'px',height:rect.height+'px'});
    const resting=[...spread.children],destination=pageLeaves(target),front=reverseTurn?destination[0]:source,back=reverseTurn?source:destination[direction===1?0:destination.length-1];
    const ready=readyPageImages(destination);
    const pockets=[...source.querySelectorAll('.physical-pocket')].slice(0,3).map(n=>n.getBoundingClientRect());
    const cuts=[0,(pockets[0].right+pockets[1].left)/2-rect.left,(pockets[1].right+pockets[2].left)/2-rect.left,rect.width],strips=[];
    for(let i=0;i<3;i++){const column=foldDirection===1?i:2-i,start=cuts[column],w=cuts[column+1]-start,strip=document.createElement('div');strip.className='page-strip';strip.dataset.column=column;strip.foldWidth=w;strip.lights=[];Object.assign(strip.style,{left:'0px',width:w+.25+'px',height:rect.height+'px',transformOrigin:foldDirection===1?'left center':'right center'});
      for(const [face,reverse] of [[front,false],[back,true]]){const mask=document.createElement('div');mask.className='strip-face'+(reverse?' strip-back':'');const content=turnFace(face,reverse?2-column:column,-(reverse?rect.width-start-w:start),rect.width,rect.height),light=document.createElement('div');light.className='strip-light';mask.append(content,light);strip.lights.push(light);strip.append(mask);}sheet.append(strip);strips.push(strip);
    }
    if(spreadMedia.matches){if(direction===1)spread.lastElementChild.replaceWith(destination[1]);else spread.firstElementChild.replaceWith(destination[0]);}else if(!reverseTurn)spread.replaceChildren(destination[0]);
    book.append(sheet);book.classList.add('page-turning');turn={direction,foldDirection,reverseTurn,corner,target,sheet,strips,gap,resting,destination,ready,width:rect.width,progress:0,frame:0,inputFrame:0,finishing:false};paintTurn(0);return true;
  }
  function paintTurn(progress){if(!turn)return;const t=turn;t.progress=progress;const fold=t.reverseTurn?1-progress:progress,direction=t.foldDirection,wave=Math.sin(fold*Math.PI);let x=direction===1?0:t.width,z=0;
    t.strips.forEach((strip,i)=>{const w=strip.foldWidth,angle=Math.PI*fold+wave*.6*(i-1),dy=0,left=direction===1?x:x-w;
      strip.style.transform=`translate3d(${left-direction*t.gap*fold}px,${dy}px,${z}px) rotateY(${-direction*angle*180/Math.PI}deg)`;const shade=String(Math.abs(Math.sin(angle))*.22);strip.lights.forEach(light=>light.style.opacity=shade);x+=direction*Math.cos(angle)*w;z+=Math.sin(angle)*w;
    });book.dataset.turnProgress=progress.toFixed(3);
  }
  function finishTurn(commit){
    if(!turn||turn.finishing)return;const t=turn;t.finishing=true;cancelAnimationFrame(t.frame);cancelAnimationFrame(t.inputFrame);
    if(commit)page=t.target;
    // Install the already prepared resting pages underneath the final fold.
    // Let their decoded images paint before retiring the animated surface.
    renderBook(commit?t.destination:t.resting);
    const remove=()=>{if(turn!==t)return;t.sheet.remove();turn=null;book.classList.remove('page-turning');delete book.dataset.turnProgress;};
    if(reduced()){remove();return;}
    (commit?t.ready:Promise.resolve()).then(()=>{t.frame=requestAnimationFrame(()=>{t.frame=requestAnimationFrame(remove);});});
  }
  function followTurn(progress){if(!turn||turn.finishing)return;const t=turn;t.progress=progress;if(!t.inputFrame)t.inputFrame=requestAnimationFrame(()=>{t.inputFrame=0;if(turn===t&&!t.finishing)paintTurn(t.progress);});}
  function settleTurn(commit){if(!turn||turn.finishing)return;if(reduced()){finishTurn(commit);return;}cancelAnimationFrame(turn.frame);cancelAnimationFrame(turn.inputFrame);turn.inputFrame=0;const start=turn.progress,end=commit?1:0,started=performance.now(),duration=Math.max(220,Math.abs(end-start)*680);function tick(now){if(!turn||turn.finishing)return;const t=Math.min(1,(now-started)/duration),eased=t*t*(3-2*t);paintTurn(start+(end-start)*eased);if(t<1)turn.frame=requestAnimationFrame(tick);else finishTurn(commit);}turn.frame=requestAnimationFrame(tick);}
  function turnPage(direction,corner='bottom'){if(startTurn(direction,corner))settleTurn(true);}
  $('prev-page').onclick=()=>turnPage(-1);$('next-page').onclick=()=>turnPage(1);
  let pageGrab=null;
  book.addEventListener('pointerdown',e=>{if(e.button!==0||turn||drag)return;const corner=e.target.closest('.page-corner'),vacant=e.target.closest('.physical-pocket.vacant');if(corner&&!corner.disabled){e.stopPropagation();if(startTurn(Number(corner.dataset.turnDirection),corner.dataset.turnCorner)){turn.pointer=e.pointerId;turn.startX=e.clientX;turn.moved=false;book.setPointerCapture(e.pointerId);}}else if(vacant){e.stopPropagation();const leaf=vacant.closest('.binder-leaf'),r=leaf.getBoundingClientRect();pageGrab={id:e.pointerId,x:e.clientX,y:e.clientY,side:leaf.classList.contains('leaf-left')?-1:1,corner:e.clientY<r.top+r.height/2?'top':'bottom'};book.setPointerCapture(e.pointerId);}});
  book.addEventListener('pointermove',e=>{if(pageGrab?.id===e.pointerId){const g=pageGrab,dx=e.clientX-g.x;if(Math.abs(dx)<5||Math.abs(dx)<Math.abs(e.clientY-g.y)*.65)return;const direction=dx<0?1:-1;if(spreadMedia.matches&&direction!==g.side)return;if(!startTurn(direction,g.corner))return;turn.pointer=e.pointerId;turn.startX=g.x;turn.moved=true;pageGrab=null;}if(!turn||turn.finishing||turn.pointer!==e.pointerId)return;const distance=(turn.startX-e.clientX)*turn.direction;if(Math.abs(distance)>4)turn.moved=true;followTurn(Math.acos(Math.max(-1,Math.min(1,1-distance/turn.width)))/Math.PI);});
  book.addEventListener('pointerup',e=>{if(pageGrab?.id===e.pointerId){pageGrab=null;if(book.hasPointerCapture(e.pointerId))book.releasePointerCapture(e.pointerId);return;}if(!turn||turn.pointer!==e.pointerId)return;const distance=(turn.startX-e.clientX)*turn.direction,commit=!turn.moved||distance>=12;turn.pointer=null;if(book.hasPointerCapture(e.pointerId))book.releasePointerCapture(e.pointerId);settleTurn(commit);e.preventDefault();});
  function cancelPageGesture(e){if(pageGrab?.id===e.pointerId)pageGrab=null;if(turn?.pointer===e.pointerId){turn.pointer=null;settleTurn(false);}}
  book.addEventListener('pointercancel',cancelPageGesture);book.addEventListener('lostpointercapture',cancelPageGesture);

  function returnCard(current){const ghost=current.ghost;if(!ghost){current.source.classList.remove('lifted-out');return;}const rect=current.source.getBoundingClientRect(),from=ghost.getBoundingClientRect();if(reduced()){ghost.remove();current.source.classList.remove('lifted-out');return;}ghost.style.transition='left .2s ease, top .2s ease, transform .2s ease';Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',transform:'none'});setTimeout(()=>{ghost.remove();current.source.classList.remove('lifted-out');},220);}
  function dropInto(c,from,slot=null,stack=0){if(!place(c.key,slot,stack))return false;const node=document.querySelector('[data-card-key="'+CSS.escape(c.key)+'"]');if(node&&from&&!reduced()){const to=node.getBoundingClientRect();node.animate([{translate:`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`,scale:String(from.width/to.width)},{translate:'0px 0px',scale:'1'}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});}return true;}
  function clearDrag({keepGhost=false}={}){if(!drag)return;if(!keepGhost){drag.source.classList.remove('lifted-out');drag.ghost?.remove();}document.querySelectorAll('.drop-ready,.drop-blocked').forEach(n=>n.classList.remove('drop-ready','drop-blocked'));document.body.classList.remove('holding-card');drag=null;}
  // The grabbed point stays under the pointer from the first movement.
  function positionHeldCard(d,e){Object.assign(d.ghost.style,{left:(e.clientX-d.grabX)+'px',top:(e.clientY-d.grabY)+'px',transformOrigin:d.grabX+'px '+d.grabY+'px',transform:`rotate(${Math.max(-5,Math.min(5,(e.clientX-d.x)*.015))}deg) scale(1.025)`});}
  function updateCardDrag(e){if(!drag)return;const d=drag,dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<5)return;
    if(!d.moved){d.moved=true;d.source.classList.add('lifted-out');document.body.classList.add('holding-card');const ghost=document.createElement('img');ghost.className='held-card';ghost.src=d.source.querySelector('img').src;ghost.alt='';Object.assign(ghost.style,{width:d.rect.width+'px',height:d.rect.height+'px'});document.body.append(ghost);d.ghost=ghost;}
    positionHeldCard(d,e);d.ghost.dataset.free='true';
    document.querySelectorAll('.drop-ready,.drop-blocked').forEach(n=>n.classList.remove('drop-ready','drop-blocked'));
    const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]');if(hit){const blocked=hit.hasAttribute('data-slot')&&layout.slots[Number(hit.dataset.slot)];if(!blocked)hit.classList.add('drop-ready');}
  }
  table.addEventListener('pointerdown',e=>{const source=e.target.closest('[data-card-key]');if(!source||source.disabled||e.button!==0||turn||drag)return;const rect=source.getBoundingClientRect();drag={id:e.pointerId,key:source.dataset.cardKey,source,rect,x:e.clientX,y:e.clientY,grabX:e.clientX-rect.left,grabY:e.clientY-rect.top,moved:false};table.setPointerCapture(e.pointerId);});
  table.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;updateCardDrag(e);});
  table.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const current=drag,c=cards.find(c=>c.key===current.key),hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot],[data-pile-drop]'),from=current.ghost?.getBoundingClientRect();const blocked=current.moved&&(hit?.hasAttribute('data-slot')&&layout.slots[Number(hit.dataset.slot)]);clearDrag({keepGhost:blocked});if(table.hasPointerCapture(e.pointerId))table.releasePointerCapture(e.pointerId);if(!c)return;
    if(blocked){returnCard(current);note('That sleeve is occupied. Use the stacks to make room.');}
    else if(current.moved&&hit?.hasAttribute('data-slot'))dropInto(c,from,Number(hit.dataset.slot));
    else if(current.moved&&hit?.hasAttribute('data-pile-drop'))dropInto(c,from,null,Number(hit.dataset.pileDrop));

    else {cardDetail(c,{from,holding:current.moved});if(current.moved)current.source.classList.add('lifted-out');}e.preventDefault();
  });
  table.addEventListener('pointercancel',()=>clearDrag());table.addEventListener('lostpointercapture',()=>{if(drag)clearDrag();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(turn){e.preventDefault();settleTurn(false);}if(drag){e.preventDefault();clearDrag();}}});
  spreadMedia.addEventListener('change',()=>{clearDrag();if(turn)finishTurn(false);page=Math.floor(page/pageStep())*pageStep();if(theme==='binder')renderCards();});

  let heldRenderer=null;
  $('detail').addEventListener('close',()=>{heldRenderer?.destroy();heldRenderer=null;});
  const oldShowDetail=showDetail;
  showDetail=function(html){heldRenderer?.destroy();heldRenderer=null;$('detail').classList.remove('card-inspect-detail');runtime?.focusRoom();closeFloat();detailFan?.destroy();detailFan=null;$('detail').classList.remove('pokemon-fan-detail');oldShowDetail(html);};
  cardDetail=function(c,{from=null,holding=false}={}){
    if(runtime&&theme!=='binder'){closeFloat();runtime.openDetail(c.key);return;}
    const origin=locate(c.key),inBinder=origin.slot!==undefined,physical=theme==='binder';
    showDetail(`<div class="detail-grid holding-detail"><img class="detail-card" src="${escapeHTML(img(c))}" alt="${escapeHTML(c.name)} card"><div><p class="eyebrow">${holding?'IN YOUR HANDS':'A LITTLE CLOSER'}</p><h2>${escapeHTML(c.name)}</h2><p>${escapeHTML(c.set)} · ${escapeHTML(c.edition)}<br>${escapeHTML(c.type)} type</p><strong class="detail-value">${valueOfCard(c)}</strong><p>${runtime?escapeHTML(runtime.fx):'Sample value · AUD'}</p><div class="detail-actions">${physical?`<button id="put-back">${inBinder?'Slide back into its sleeve':'Return to stack '+(origin.stack+1)}</button><button id="change-place">${inBinder?'Lay on stack one':'Slide into an empty sleeve'}</button><button id="second-stack">${inBinder?'Lay on stack two':'Move to stack '+(origin.stack===0?2:1)}</button>`:''}<button id="meet-pokemon">Fan out my ${escapeHTML(c.name)} cards ↗</button></div></div></div>`);
    if(window.PokeSiftFoil){
      $('detail').classList.add('card-inspect-detail');
      const image=$('detail-content').querySelector('.detail-card'),perspective=document.createElement('div'),holder=document.createElement('div');perspective.className='foil-perspective';holder.className='held-foil-card';image.replaceWith(perspective);perspective.append(holder);holder.append(image);
      const data=c.foilData||{name:c.name,set:c.id===6?'Base Set 2':c.set,number:c.id===6?'4/130':c.id===9?'2/102':'',language:'en',game:'pokemon',finish:c.edition,canonical:true};
      heldRenderer=PokeSiftFoil.mount(holder,image,PokeSiftFoil.resolve(data));
    }
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
  $('reset-demo').onclick=()=>{if(runtime)return;clearDrag();closeFloat();if(turn)finishTurn(false);cards=initial();layout={slots:[],piles:[[],[]],positions:{}};page=0;index=0;fanSelectionReset=true;filter='All';dexFilter='All';sort='recent';missing=false;newFriend=null;$('sort').value=sort;reconcile();persist();render();note('Demo arrangement reset.');};
  labels.desk='B · The Fan';labels.zoo='C · Pokémon Zoo';
  document.querySelectorAll('[data-surface]').forEach(a=>{if(a.dataset.surface===theme)a.setAttribute('aria-current','page');});
  const baseRender=render;render=function(){baseRender();$('hero-copy').textContent=theme==='binder'?'Pick up a card. Find it a home. Every sleeve is yours.':theme==='desk'?'Hold, slide, sift. The cards move with you.':'Your Pokémon. A little room to be themselves.';if(theme==='binder'){$('card-heading').textContent='Your binder. Two stacks. Make yourself at home.';}if(theme==='zoo'){$('hero-title').innerHTML='All your favourites.<br><em>Room to be themselves.</em>';$('eyebrow').textContent='YOUR POKÉMON';}};
  function renderLive(){if(!runtime)return;const known=cards.filter(c=>c.value!==null);$('collection-value').textContent=known.length?money(known.reduce((sum,c)=>sum+c.value,0)):'Value unknown';$('no-cards').textContent=cards.length?'No cards match this view.':'Your cards will appear here after you add them.';if(theme==='zoo'){$('zoo-empty').hidden=owned().length>0;$('share-zoo').disabled=!owned().length;const unknown=runtime.unclassified||[];$('unclassified-cards').hidden=!unknown.length;$('unclassified-summary').textContent=unknown.length+' cards need a Pokémon name';$('unclassified-list').replaceChildren();for(const c of unknown){const b=document.createElement('button');b.textContent=c.name+' ↗';b.onclick=()=>runtime.openDetail(c.key);$('unclassified-list').append(b);}$('room-art-status').textContent=runtime.artUnavailable?'Some Pokémon artwork is unavailable. Your cards are still saved.':'';$('retry-artwork').hidden=!runtime.artUnavailable;}}
  if(runtime){const liveBase=render;render=()=>{liveBase();renderLive();};$('room-search').oninput=e=>{runtime.query=e.target.value.trim().toLowerCase();index=0;fanSelectionReset=true;renderCards();};$('retry-artwork').onclick=()=>runtime.retryArtwork();let pending=null,timer=0;function apply(){if(!pending)return;if(drag||turn||floatFan||$('detail').open||document.querySelector('.being-moved,.tactile-fan.is-dragging')){timer=setTimeout(apply,120);return;}const data=runtime.current();pending=null;Object.assign(runtime,data);cards=data.cards;pokemon.splice(0,pokemon.length,...data.pokemon);Object.assign(art,data.art);layout=structuredClone(data.layout);reconcile();render();}runtime.ready({update(data){pending=data;clearTimeout(timer);apply();}});}
  reconcile();render();
})();
