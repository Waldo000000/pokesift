// Real browser interactions, saved photos and queue scheduling; no live providers.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=8803,base=`http://127.0.0.1:${port}`,password='bulk-retry-fixture-password';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=';
const matched={data:{status:'matched',read:{name:'Recovered card'},candidates:[]}};
(async()=>{
  const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,POKESIFT_CLOUD_ENABLED:'0',PORT:String(port),TCGAPI_KEY:'not-a-real-key',POKESIFT_PASSWORD:password,PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''},stdio:'ignore'});
  let browser;const errors=[];let unexpected=0;
  try{
    for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error('Fixture server unavailable');await new Promise(r=>setTimeout(r,100));}
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const cookie=execFileSync('python3',['-c',`from auth import mint_token; print(mint_token('${password}', 'session', '${base}'))`],{cwd:root}).toString().trim();
    async function setup(count,{missing=false,identified=false}={}){
      const c=await browser.newContext({viewport:{width:390,height:844}});
      await c.addCookies([{name:'pokesift',value:cookie,url:base,httpOnly:true,sameSite:'Strict'}]);
      await c.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-10-31',rates:{AUD:1,USD:.5},source:'Fixture'}}));
      for(const route of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await c.route(route,r=>{unexpected++;return r.abort();});
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
      await p.evaluate(async({count,image,missing,identified})=>{
        entries=[];
        for(let n=0;n<count;n++){
          const id='failed-'+n,blob=PokeSiftPhotos.decode(image);
          await PokeSiftPhotos.put(id,blob);
          entries.push({id,status:n%2?'interrupted':'error',createdAt:'2026-10-31T00:00:00Z',thumbnail:image,message:'Original failure '+n,collectorNote:'Keep '+n,scanRequestId:'previous-'+n,scanPhoto:{id,mime:blob.type,bytes:blob.size,persisted:true},result:{error:{message:'Original evidence '+n}}});
        }
        if(missing)entries.push({id:'missing',status:'error',thumbnail:image,createdAt:'2026-10-31T00:00:00Z'});
        if(identified)entries.push({id:'identified',status:'matched',thumbnail:image,collectorNote:'Leave alone',result:{data:{status:'matched',read:{name:'Already identified'},candidates:[]}}});
        save();render();
      },{count,image,missing,identified});
      return {c,p};
    }
    async function start(p){await p.locator('#retry-failed-scans').click();await p.locator('#confirm-scan-retries').click();}
    async function finished(p){await p.waitForFunction(()=>!retryBatch.running&&retryBatch.message,{},{timeout:30000});}
    // Confirmation uses a fixed selection. More than the upload queue's 20-card
    // capacity is processed gradually, while missing and changed cards are skipped.
    const all=await setup(23,{missing:true,identified:true});let calls=0,inflight=0,maxInflight=0;const requestIds=new Set();
    await all.c.route('**/api/identify',async r=>{
      calls++;inflight++;maxInflight=Math.max(maxInflight,inflight);const h=r.request().headers();assert(/^previous-\d+$/.test(h['x-pokesift-retry-of']));assert(!requestIds.has(h['x-request-id']));requestIds.add(h['x-request-id']);
      assert(r.request().postDataBuffer().equals(Buffer.from(image.split(',')[1],'base64')));
      await new Promise(resolve=>setTimeout(resolve,20));inflight--;return r.fulfill({json:matched});
    });
    await all.p.locator('#retry-failed-scans').click();assert.match(await all.p.locator('#scan-retry-cost').textContent(),/up to 24 scans/);assert.equal(calls,0);
    assert.equal(await all.p.evaluate(()=>document.activeElement.id),'cancel-scan-retries');
    await all.p.locator('#scan-retry-confirmation').screenshot({path:'/tmp/pokesift-bulk-retry-confirmation.png'});
    await all.p.locator('#cancel-scan-retries').click();assert.equal(calls,0);assert(await all.p.locator('#scan-retry-confirmation').isHidden());
    await all.p.locator('#retry-failed-scans').click();await all.p.keyboard.press('Escape');assert(await all.p.locator('#scan-retry-confirmation').isHidden());assert.equal(calls,0);
    await all.p.locator('#retry-failed-scans').click();
    await all.p.evaluate(image=>{entries.find(e=>e.id==='failed-22').status='matched';entries.push({id:'later-failure',status:'error',thumbnail:image});save();render();},image);
    await all.p.evaluate(()=>{document.querySelector('#confirm-scan-retries').click();document.querySelector('#confirm-scan-retries').click();});await finished(all.p);
    assert.equal(calls,22);assert.equal(maxInflight,1);assert.match(await all.p.locator('#bulk-retry-status').textContent(),/24 of 24 cards checked.*22 identified.*1 photos missing.*1 changed/);
    const recovered=await all.p.evaluate(()=>structuredClone(entries.find(e=>e.id==='failed-0')));
    assert.equal(recovered.collectorNote,'Keep 0');assert.equal(recovered.scanAttempts[0].result.error.message,'Original evidence 0');
    assert.equal(await all.p.evaluate(()=>entries.find(e=>e.id==='later-failure').status),'error');assert.equal(await all.p.evaluate(()=>entries.find(e=>e.id==='identified').collectorNote),'Leave alone');
    assert.equal(await all.p.evaluate(()=>entries.length),26);await all.c.close();
    // Stop lets the current provider call finish, preserving the remaining cards.
    const stopped=await setup(4);let stopCalls=0,release;
    await stopped.c.route('**/api/identify',async r=>{stopCalls++;await new Promise(resolve=>release=resolve);return r.fulfill({json:matched});});
    await start(stopped.p);await stopped.p.waitForFunction(()=>entries.some(e=>e.status==='scanning'));while(!release)await new Promise(r=>setTimeout(r,10));
    await stopped.p.locator('#stop-scan-retries').click();release();await finished(stopped.p);
    assert.equal(stopCalls,1);assert.match(await stopped.p.locator('#bulk-retry-status').textContent(),/Stopped.*1 of 4/);
    await stopped.p.reload();assert.equal(stopCalls,1);assert.equal(await stopped.p.evaluate(()=>entries.filter(e=>failedStates.has(e.status)).length),3);await stopped.c.close();
    // Provider/account failures and lost responses stop after the first attempt.
    for(const mode of ['quota','network']){
      const test=await setup(3);let attempts=0;
      await test.c.route('**/api/identify',r=>{attempts++;return mode==='network'?r.abort():r.fulfill({status:402,json:{error:{message:'Scan credits unavailable'}}});});
      await start(test.p);await finished(test.p);assert.equal(attempts,1);assert.match(await test.p.locator('#bulk-retry-status').textContent(),/Stopped.*1 of 3/);await test.c.close();
    }
    // A pending result is per-card: keep its original ID and continue with others.
    const pending=await setup(2);let pendingCalls=0;
    await pending.c.route('**/api/identify',r=>{pendingCalls++;return r.fulfill(pendingCalls===1?{status:409,json:{error:{code:'request_pending',requestId:'previous-0',message:'Waiting for the earlier scan'}}}:{json:matched});});
    await start(pending.p);await finished(pending.p);assert.equal(pendingCalls,2);assert.match(await pending.p.locator('#bulk-retry-status').textContent(),/1 identified.*1 awaiting earlier results/);assert.equal(await pending.p.evaluate(()=>entries[0].scanRequestId),'previous-0');await pending.c.close();
    // Safe throttles keep the same IDs and resume, without counting twice.
    const paced=await setup(1);const pacedIds=[];
    await paced.c.route('**/api/identify',r=>{pacedIds.push(r.request().headers()['x-request-id']);return r.fulfill(pacedIds.length===1?{status:429,headers:{'X-PokeSift-Scan-Throttled':'1'},json:{error:{code:'scan_throttled',retryAfter:1,message:'Wait'}}}:{json:matched});});
    await start(paced.p);await finished(paced.p);assert.equal(pacedIds.length,2);assert.equal(pacedIds[0],pacedIds[1]);assert.match(await paced.p.locator('#bulk-retry-status').textContent(),/1 of 1 cards checked.*1 identified/);await paced.c.close();
    // Stop also cancels a safely throttled retry, including a stop requested
    // while its rejection is in flight. It must never wake up and spend later.
    for(const mode of ['during-request','while-queued']){
      const test=await setup(2);let attempts=0,allow;
      await test.c.route('**/api/identify',async r=>{attempts++;if(mode==='during-request')await new Promise(resolve=>allow=resolve);return r.fulfill({status:429,headers:{'X-PokeSift-Scan-Throttled':'1'},json:{error:{code:'scan_throttled',retryAfter:60,message:'Wait'}}});});
      await start(test.p);
      if(mode==='during-request'){while(!allow)await new Promise(r=>setTimeout(r,10));await test.p.locator('#stop-scan-retries').click();allow();}
      else{await test.p.waitForFunction(()=>jobs.length===1&&entries[0].status==='queued');await test.p.locator('#stop-scan-retries').click();}
      await finished(test.p);assert.equal(attempts,1);assert.equal(await test.p.evaluate(()=>jobs.length),0);assert.equal(await test.p.evaluate(()=>entries[0].status),'error');await test.c.close();
    }
    assert.equal(unexpected,0);assert.deepEqual(errors,[]);
    console.log('PASS: bulk retry confirmation/cancel, exact photos, more than 20 cards, fixed selection, missing photos, stop/reload, quota/network failures, pending recovery, safe throttles and stop races. Zero live scans.');
  }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
