// Returning-user startup is exercised against real local account/cookie routes.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-startup-')),port=8807,base=`http://127.0.0.1:${port}`;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAADQ/GvKAAAAEklEQVR4nGNIbI3HihhGJdARAG9VeeGlXk9cAAAAAElFTkSuQmCC';
(async()=>{
  const server=spawn('python3',['tests/cloud_fixture.py',tmp,String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});let browser,output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  const errors=[];let paid=0,oauth=0;
  try{
    for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
    const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json')));
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const aliceCookie={name:'pokesift-account',value:sessions.alice,url:base,httpOnly:true,sameSite:'Strict'};
    async function context(signedIn=true){
      const c=await browser.newContext({viewport:{width:390,height:844}});if(signedIn)await c.addCookies([aliceCookie]);
      await c.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-10-31',rates:{AUD:1,USD:.5},source:'Fixture'}}));
      for(const route of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await c.route(route,r=>{paid++;return r.abort();});
      await c.route('**/api/account/sign-in',r=>{oauth++;return r.fulfill({json:{url:base+'/fixture-google'}});});
      await c.route('**/fixture-google',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Google fixture</title><h1>Explicit sign-in</h1>'}));
      await c.addInitScript(()=>{
        window.startupFrames=[];
        function sample(){const visible=id=>Boolean(document.getElementById(id)?.getClientRects().length);startupFrames.push({auth:document.body?.dataset.auth,google:visible('google-sign-in'),pairing:visible('pairing-view'),empty:visible('empty'),collection:visible('collection-view'),loading:visible('startup-view')});requestAnimationFrame(sample);}requestAnimationFrame(sample);
      });
      const p=await c.newPage(),documents=[];p.on('pageerror',e=>errors.push(e.message));p.on('framenavigated',f=>{if(f===p.mainFrame())documents.push(f.url());});return {c,p,documents};
    }
    const seed=await context();
    const document={id:'returning-card',status:'matched',createdAt:'2026-10-31T00:00:00Z',thumbnail:image,canonicalImage:image,collectorNote:'Keep startup data',result:{data:{status:'matched',read:{name:'Returning Pikachu'},candidates:[]}}};
    const put=await seed.c.request.post(base+'/api/cloud/card',{headers:{Origin:base},data:{id:document.id,baseRevision:0,operationId:crypto.randomUUID(),action:'put',document}});assert.equal(put.status(),200);await seed.c.close();
    async function noFlash(p){const frames=await p.evaluate(()=>startupFrames);assert(frames.length>2);assert(frames.every(f=>!f.google&&!f.pairing&&!f.empty),'A valid session must never flash login or an empty collection');}
    const waiting=async fn=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture request did not arrive');};
    // Delayed session and initial cloud data produce one neutral screen, then
    // the real collection, with no navigation or OAuth request in between.
    const cold=await context();let releaseSession,releaseInventory,sessionCalls=0,inventoryCalls=0;
    await cold.c.route('**/api/session',async r=>{sessionCalls++;if(sessionCalls===1)await new Promise(resolve=>releaseSession=resolve);return r.continue();});
    await cold.c.route('**/api/cloud/inventory',async r=>{inventoryCalls++;if(inventoryCalls===1)await new Promise(resolve=>releaseInventory=resolve);return r.continue();});
    await cold.p.goto(base,{waitUntil:'domcontentloaded'});await waiting(()=>releaseSession);await cold.p.waitForTimeout(120);
    assert(await cold.p.locator('#startup-view').isVisible());assert(await cold.p.locator('#google-sign-in').isHidden());assert(await cold.p.locator('#collection-view').isHidden());
    await cold.p.evaluate(()=>window.dispatchEvent(new Event('pokesift:unauthorized')));assert(await cold.p.locator('#google-sign-in').isHidden(),'An older background response cannot override a current session check');
    await cold.p.screenshot({path:'/tmp/pokesift-startup-loading.png'});
    releaseSession();await waiting(()=>releaseInventory);await cold.p.waitForTimeout(120);assert(await cold.p.locator('#startup-view').isVisible());assert(await cold.p.locator('#empty').isHidden());releaseInventory();
    await cold.p.locator('.card-tile').waitFor();await noFlash(cold.p);assert.equal(cold.documents.length,1);assert.equal(sessionCalls,1);assert.equal(oauth,0);
    await cold.p.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Synced');
    // A returning browser can reveal its verified account cache without
    // waiting for a slow background inventory refresh.
    let releaseBackground,hold=true;await cold.c.unroute('**/api/cloud/inventory');
    await cold.c.route('**/api/cloud/inventory',async r=>{if(hold){hold=false;await new Promise(resolve=>releaseBackground=resolve);}return r.continue();});
    await cold.p.reload({waitUntil:'domcontentloaded'});await cold.p.locator('.card-tile').waitFor();await waiting(()=>releaseBackground);await noFlash(cold.p);releaseBackground();assert.equal(cold.documents.length,2);assert.equal(sessionCalls,2);
    // Restoring the browser page cache revalidates silently and retains the
    // existing collection instead of restoring a stale Google sign-in view.
    await cold.p.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    await cold.p.waitForFunction(()=>document.body.dataset.auth==='signed-in');assert.equal(sessionCalls,3);assert.equal(oauth,0);await noFlash(cold.p);
    // If another tab changes the account, reset the live document before
    // opening that account's cache. Alice's private cards cannot carry over.
    await cold.c.addCookies([{...aliceCookie,value:sessions.bob}]);
    await cold.p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await cold.p.waitForFunction(id=>document.body.dataset.auth==='signed-in'&&PokeSiftAccount.user?.id===id,sessions.bobId);
    assert.equal(await cold.p.locator('.card-tile').count(),0);assert(await cold.p.locator('#empty').isVisible());assert.equal(cold.documents.length,3);assert.equal(oauth,0);await cold.c.close();
    // Temporary session and cold-cache sync failures are retryable loading
    // errors. Neither one claims that the user needs to sign in again.
    for(const failure of ['session','inventory']){
      const test=await context();let attempts=0;
      await test.c.route(failure==='session'?'**/api/session':'**/api/cloud/inventory',r=>{attempts++;return attempts===1?r.fulfill({status:503,json:{error:{message:'Temporary fixture failure'}}}):r.continue();});
      await test.p.goto(base);await test.p.locator('#retry-startup').waitFor();assert(await test.p.locator('#google-sign-in').isHidden());assert(await test.p.locator('#collection-view').isHidden());assert.equal(test.documents.length,1);
      await test.p.locator('#retry-startup').click();await test.p.locator('.card-tile').waitFor();await noFlash(test.p);assert.equal(oauth,0);assert.equal(await test.p.locator('#account-button').count(),1);assert.equal(await test.p.locator('#google-sign-in').count(),1);await test.c.close();
    }
    // Only a definitive 401 reveals sign-in. If another tab has since signed
    // in, clicking Google rechecks the cookie and opens the collection directly.
    const anonymous=await context(false);let releaseAnonymous;
    await anonymous.c.route('**/api/session',async r=>{if(!releaseAnonymous)await new Promise(resolve=>releaseAnonymous=resolve);return r.continue();});
    await anonymous.p.goto(base,{waitUntil:'domcontentloaded'});await waiting(()=>releaseAnonymous);assert(await anonymous.p.locator('#google-sign-in').isHidden());releaseAnonymous();await anonymous.p.locator('#google-sign-in').waitFor();
    const anonymousFrames=await anonymous.p.evaluate(()=>startupFrames);assert(anonymousFrames.filter(f=>f.auth!=='signed-out').every(f=>!f.google));
    await anonymous.c.addCookies([aliceCookie]);await anonymous.p.locator('#google-sign-in').click();await anonymous.p.locator('.card-tile').waitFor();assert.equal(oauth,0);assert.equal(anonymous.documents.length,1);await anonymous.c.close();
    // Genuine signed-out users still take the explicit sign-in path once.
    const signIn=await context(false);await signIn.p.goto(base);await signIn.p.locator('#google-sign-in').click();await signIn.p.waitForURL(base+'/fixture-google');assert.equal(oauth,1);await signIn.c.close();
    // A stalled session check times out into retry, never into Google.
    const timeout=await context();await timeout.p.clock.install();await timeout.c.route('**/api/session',()=>new Promise(()=>{}));await timeout.p.goto(base,{waitUntil:'domcontentloaded'});await timeout.p.clock.runFor(21000);await timeout.p.locator('#retry-startup').waitFor();assert(await timeout.p.locator('#google-sign-in').isHidden());assert.equal(oauth,1);await timeout.c.close();
    // A missing runtime script must not accidentally launch legacy QR auth.
    const missing=await context();await missing.c.route('**/runtime.js',r=>r.abort());await missing.p.goto(base);await missing.p.locator('#retry-startup').waitFor();assert.equal(await missing.p.locator('#google-sign-in').count(),0);assert(await missing.p.locator('#pairing-view').isHidden());await missing.c.close();
    assert.equal(paid,0);assert.deepEqual(errors,[]);
    console.log('PASS: no login/empty-state flash for cold and warm sessions, silent page-cache restore, retryable session/sync failures and timeouts, expired sessions, session recheck before OAuth, missing runtime and explicit sign-in. Zero provider calls.');
  }finally{await browser?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
