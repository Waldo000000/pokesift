// Public prototype fixtures exercise the same page-turn renderer as real collections.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=8806,base=`http://127.0.0.1:${port}`;
(async()=>{
  const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,POKESIFT_CLOUD_ENABLED:'0',PORT:String(port),TCGAPI_KEY:'fixture-only',POKESIFT_PASSWORD:'binder-turn-fixture-password',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''},stdio:'ignore'});
  let browser;const errors=[];let providerCalls=0;
  try{
    for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error('Fixture server unavailable');await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    for(const mobile of [false,true]){
      const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:1000}});
      await c.route('**/api/**',r=>{providerCalls++;return r.abort();});
      await c.addInitScript(()=>{const slots=Array(180).fill(null);for(let i=0;i<14;i++)slots[i+9]='card-'+i;localStorage.setItem('pokesift.prototype.physical.v2',JSON.stringify({slots,piles:[[],[]],positions:{}}));});
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
      await p.goto(base+'/concepts/binder.html');await p.locator('.binder-book').scrollIntoViewIfNeeded();
      await p.evaluate(()=>Promise.allSettled([...document.images].map(img=>img.decode())));
      const step=mobile?1:2;
      assert.equal(await p.locator('.page-corner span').count(),0,'Resting pages must not have folded triangle decorations');
      const corners=await p.locator('.page-corner').evaluateAll(nodes=>nodes.map(n=>({background:getComputedStyle(n).backgroundColor,image:getComputedStyle(n).backgroundImage,label:n.getAttribute('aria-label')})));
      assert(corners.every(x=>x.background==='rgba(0, 0, 0, 0)'&&x.image==='none'&&x.label),'Invisible corner grab targets remain accessible');
      for(const direction of [1,-1]){
        const oldPage=Number(await p.locator('#binder-spread').getAttribute('data-start-page')),expected=oldPage+direction*step;
        const button=p.locator(`.corner-bottom.corner-${direction===1?'right':'left'}:not(:disabled)`).first();await button.scrollIntoViewIfNeeded();
        const box=await button.boundingBox(),leaf=await p.locator('#binder-spread>.binder-leaf').first().boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
        await p.mouse.move(x,y);await p.mouse.down();
        assert.equal(await p.locator('.page-strip').count(),3);
        assert.equal(await p.locator('.turning-sheet .page-corner').count(),0);
        const keys=await p.locator('.turning-sheet .strip-face:not(.strip-back) .sleeved-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardKey));
        assert.equal(new Set(keys).size,keys.length,'A card appears only on its own moving panel, not on three full-page copies');
        await p.evaluate(()=>{
          const book=document.querySelector('.binder-book'),spread=document.querySelector('#binder-spread');
          window.turnTrace=[];window.preparedUnderlay=[...spread.children];window.preparedImages=[...spread.querySelectorAll('img')];
          function sample(){const nodes=[...spread.children],imgs=[...spread.querySelectorAll('img')];turnTrace.push({page:Number(spread.dataset.startPage),overlay:!!book.querySelector('.turning-sheet'),leaves:nodes.length,imagesReady:imgs.every(i=>i.complete&&i.naturalWidth>0)});window.turnProbe=requestAnimationFrame(sample);}sample();
        });
        // A burst of 80 input updates needs only one rendered frame. The last
        // pointer position still wins, including a partial fold before release.
        const updates=await p.evaluate(async({x,y,width,direction})=>{
          const book=document.querySelector('.binder-book');let count=0;
          const observer=new MutationObserver(rows=>count+=rows.length);observer.observe(book,{attributes:true,attributeFilter:['data-turn-progress']});
          for(let i=1;i<=80;i++)book.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:x-direction*width*.8*i/80,clientY:y,bubbles:true}));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));observer.disconnect();return {count,progress:Number(book.dataset.turnProgress)};
        },{x,y,width:leaf.width,direction});
        assert(updates.count<=2,'Pointer bursts must not perform a full paint for every input event');assert(updates.progress>.3&&updates.progress<.6);
        const transforms=await p.locator('.page-strip').evaluateAll(nodes=>nodes.map(n=>n.style.transform));assert(new Set(transforms).size===3,'The physical fold still bends across pocket gutters');
        await p.mouse.move(x-direction*leaf.width*2,y,{steps:10});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        assert.equal(await p.locator('.binder-book').getAttribute('data-turn-progress'),'1.000');
        await p.locator('.binder-book').screenshot({path:`/tmp/pokesift-binder-${mobile?'phone':'spread'}-${direction}-landed.png`});
        await p.mouse.up();await p.locator('.turning-sheet').waitFor({state:'detached'});
        await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        const trace=await p.evaluate(()=>{cancelAnimationFrame(window.turnProbe);return turnTrace;});
        assert(trace.some(s=>s.page===expected&&s.overlay),'The prepared destination is installed underneath the landed sheet before it disappears');
        assert(trace.some(s=>s.page===expected&&!s.overlay),'The completed resting page is observed after the overlay retires');
        assert(trace.every(s=>s.leaves===step),'No rendered frame has an empty or partial resting spread');
        assert(trace.filter(s=>s.page===expected&&!s.overlay).every(s=>s.imagesReady),'The revealed resting page must already have decoded artwork');
        assert.equal(Number(await p.locator('#binder-spread').getAttribute('data-start-page')),expected);
        const reuse=await p.evaluate(()=>window.preparedUnderlay.some(n=>[...document.querySelector('#binder-spread').children].includes(n)));
        if(!mobile||direction===1)assert(reuse,'The prepared resting page is reused during the handoff');
        assert.equal(await p.locator('.page-corner span').count(),0);
        await p.locator('.binder-book').screenshot({path:`/tmp/pokesift-binder-${mobile?'phone':'spread'}-${direction}-rest.png`});
      }
      // Cancelling restores the original, already-decoded page nodes as well.
      const original=await p.locator('.corner-top.corner-right:not(:disabled)').first().boundingBox(),x=original.x+original.width/2,y=original.y+original.height/2;
      await p.evaluate(()=>window.originalPages=[...document.querySelector('#binder-spread').children]);
      await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x-6,y);await p.mouse.up();await p.locator('.turning-sheet').waitFor({state:'detached'});
      assert.equal(Number(await p.locator('#binder-spread').getAttribute('data-start-page')),0);
      assert(await p.evaluate(()=>[...document.querySelector('#binder-spread').children].every((n,i)=>n===window.originalPages[i])),'Cancelling reuses the original page nodes');
      await p.emulateMedia({reducedMotion:'reduce'});await p.evaluate(()=>PokeSiftMotion.set('reduced'));
      await p.locator('#next-page').click();assert.equal(Number(await p.locator('#binder-spread').getAttribute('data-start-page')),step);assert.equal(await p.locator('.turning-sheet').count(),0);
      await c.close();
    }
    assert.equal(providerCalls,0);assert.deepEqual(errors,[]);
    console.log('PASS: natural binder corners, coalesced transform-only input, column-only artwork, decoded two-frame handoff, forward/backward phone and desktop turns, cancellation and reduced motion. Zero provider requests.');
  }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
