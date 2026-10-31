// Cloud HTTP, catalog adapter and image bytes are real; upstream providers are local fixtures.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-chinese-')),port=8804,base=`http://127.0.0.1:${port}`;
(async()=>{
  const server=spawn('python3',['tests/cloud_fixture.py',tmp,String(port),'chinese-images'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let browser,output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  try{
    for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
    const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json'))),stats=()=>JSON.parse(fs.readFileSync(path.join(tmp,'image-stats.json')));
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const errors=[];
    async function device(){const c=await browser.newContext({viewport:{width:390,height:844}});await c.addCookies([{name:'pokesift-account',value:sessions.alice,url:base,httpOnly:true,sameSite:'Strict'}]);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await c.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-10-31',rates:{AUD:1,USD:.5},source:'Fixture'}}));await p.goto(base);await p.locator('#account-button').waitFor();return {c,p};}
    const {c,p}=await device();
    const original=await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=120;canvas.height=168;const ctx=canvas.getContext('2d');ctx.fillStyle='#d63b2f';ctx.fillRect(0,0,120,168);return canvas.toDataURL('image/png');});
    const photo={name:'chinese.png',mimeType:'image/png',buffer:Buffer.from(original.split(',')[1],'base64')};
    const ready=async id=>p.waitForFunction(id=>entries.find(e=>e.id===id)?.status==='matched'&&entries.find(e=>e.id===id)?.canonicalImage,id,{timeout:15000});
    const sync=async page=>{await page.evaluate(()=>PokeSiftCloud.sync());await page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Synced',{},{timeout:20000});};
    // A brand-new Chinese photo automatically matches, then downloads real
    // binary artwork through the production cloud transport wrapper.
    await p.locator('#open-camera').click();await p.locator('#photo-input').setInputFiles(photo);
    await p.waitForFunction(()=>entries[0]?.catalogMatch&&entries[0]?.canonicalImage,{},{timeout:15000});await p.locator('#close-camera').click();
    const first=await p.evaluate(()=>structuredClone(entries[0]));assert.equal(first.status,'matched');assert.equal(first.catalogMatch.card.provider,'pikaqian');assert.notEqual(first.canonicalImage,first.thumbnail);
    await p.locator('.card-tile img').waitFor();assert.equal(await p.locator('.card-tile img').getAttribute('src'),first.canonicalImage);assert.equal(stats().scans,1);assert.equal(stats().images,1);assert.equal(stats().cdn_key_used,false);
    async function failed(id){await p.evaluate(async({id,first})=>{const original=await PokeSiftPhotos.get(first.id),blob=new Blob([await original.arrayBuffer(),id],{type:original.type});await PokeSiftPhotos.put(id,blob);entries.push({id,status:'error',createdAt:first.createdAt,thumbnail:first.thumbnail,message:'Old allowance failure',collectorNote:'Keep '+id,scanRequestId:'blocked-'+id,scanPhoto:{...first.scanPhoto,id,bytes:blob.size,sha256:await PokeSiftPhotos.digest(blob)}});save();render();},{id,first});}
    // Per-card and bulk retries both go through the same image path.
    await failed('retried');await p.evaluate(()=>openDetail('retried'));await p.locator('#retry-scan').click();await ready('retried');await p.locator('#close-detail').click();assert.equal(stats().scans,2);assert.equal(stats().images,2);
    await failed('bulk-retried');await p.locator('#retry-failed-scans').click();assert.match(await p.locator('#scan-retry-cost').textContent(),/up to 1 scan/);await p.locator('#confirm-scan-retries').click();await ready('bulk-retried');await p.waitForFunction(()=>!retryBatch.running);assert.equal(stats().scans,3);assert.equal(stats().images,3);
    // An earlier confirmed match can survive an unsuccessful retry. Reusing
    // that match must restore matched status before attempting its artwork.
    await p.evaluate(id=>{const e=entries.find(e=>e.id===id);e.status='error';e.message='Earlier retry failed';delete e.canonicalImage;e.catalogMatch.confirmedBy='user';e.selectedPriceKey='keep-choice';save();render();openDetail(id);},first.id);
    await p.locator('#retry-scan').click();await ready(first.id);await p.locator('#close-detail').click();
    assert.equal(stats().scans,3,'The completed photo response is recovered without a new scan');assert.equal(stats().images,4);
    assert.equal(await p.evaluate(id=>entries.find(e=>e.id===id).selectedPriceKey,first.id),'keep-choice');assert.equal(await p.evaluate(id=>entries.find(e=>e.id===id).catalogMatch.confirmedBy,first.id),'user');
    // Existing identified Chinese cards join the same bulk operation as
    // image-only repairs. Their original photos are never read or resubmitted.
    const before=await p.evaluate(()=>{for(const e of entries.slice(0,2))delete e.canonicalImage;entries[1].status='unsupported';entries[1].message='Earlier retry left the scan status unchanged';save();render();return structuredClone(entries);});
    const beforeRepair=stats();await p.locator('#retry-failed-scans').click();assert.match(await p.locator('#scan-retry-cost').textContent(),/No photo scans will be used.*2 Chinese catalog images/);
    await p.locator('#scan-retry-confirmation').screenshot({path:'/tmp/pokesift-chinese-image-repair.png'});
    await p.locator('#cancel-scan-retries').click();assert.deepEqual(stats(),beforeRepair);
    await p.evaluate(()=>{window.originalPhotoGet=PokeSiftPhotos.get;PokeSiftPhotos.get=()=>{throw Error('Image-only repair must not read the capture');};});
    await p.locator('#retry-failed-scans').click();await p.locator('#confirm-scan-retries').click();await p.waitForFunction(()=>!retryBatch.running&&retryBatch.images===2);
    assert.equal(stats().scans,3);assert.equal(stats().images,beforeRepair.images+2);assert.equal(stats().cdn_key_used,false);
    const after=await p.evaluate(()=>{PokeSiftPhotos.get=window.originalPhotoGet;return structuredClone(entries);});
    for(let n=0;n<before.length;n++){assert(after[n].canonicalImage);const a={...after[n]},b={...before[n]};delete a.canonicalImage;delete b.canonicalImage;if(b.status!=='matched'){b.status='matched';b.message='';}assert.deepEqual(a,b,'Repair preserves the full card document and restores the confirmed match status');}
    const account=await p.evaluate(()=>fetch('/api/session').then(r=>r.json()));assert.equal(account.account.scansUsed,3);
    await sync(p);await p.reload();await p.waitForFunction(()=>entries.length===3&&entries.every(e=>e.canonicalImage));assert.equal(stats().scans,3);assert.equal(stats().images,beforeRepair.images+2);
    const second=await device();await sync(second.p);assert.equal(await second.p.evaluate(()=>entries.filter(e=>e.canonicalImage).length),3);await second.c.close();
    // A slow older TCGPlayer image must not overwrite a later Chinese match.
    let releaseOld;await c.route('**/api/card-image?*',async r=>{await new Promise(resolve=>releaseOld=resolve);return r.fulfill({contentType:'image/png',body:photo.buffer});});
    await p.evaluate(({first})=>{const e={id:'image-race',status:'matched',thumbnail:first.thumbnail,result:{data:{status:'matched',candidates:[{name:'Earlier English match',tcgplayer_id:12345}]}}};entries.push(e);save();window.oldImageRequest=cacheCanonicalImage(e);},{first});
    while(!releaseOld)await new Promise(r=>setTimeout(r,10));
    await p.evaluate(()=>{const e=entries.find(e=>e.id==='image-race'),source=entries.find(e=>e.catalogMatch);e.enrichment={status:'matched'};applyCatalogMatch(e,structuredClone(source.enrichment.candidates[0]),'user');});await ready('image-race');
    const chineseImage=await p.evaluate(()=>entries.find(e=>e.id==='image-race').canonicalImage);releaseOld();await p.evaluate(()=>window.oldImageRequest);assert.equal(await p.evaluate(()=>entries.find(e=>e.id==='image-race').canonicalImage),chineseImage);
    // Transient image failures keep the identity/photo and can be retried in
    // bulk immediately, without waiting for or consuming another photo scan.
    await c.unroute('**/api/card-image?*');let imageFailures=0;
    await c.route('**/api/pikaqian-image?*',r=>{imageFailures++;return r.fulfill({status:502,json:{error:{message:'Temporarily unavailable'}}});});
    await p.evaluate(()=>{delete entries[0].canonicalImage;save();render();});await p.locator('#retry-failed-scans').click();await p.locator('#confirm-scan-retries').click();await p.waitForFunction(()=>!retryBatch.running&&retryBatch.errors===1);
    assert.equal(imageFailures,1);assert.equal(await p.evaluate(()=>entries[0].status),'matched');assert.equal(stats().scans,3);
    await c.unroute('**/api/pikaqian-image?*');await p.locator('#retry-failed-scans').click();await p.locator('#confirm-scan-retries').click();await p.waitForFunction(()=>!retryBatch.running&&retryBatch.images===1);assert.equal(stats().scans,3);
    // Mixed confirmations must count only failed photos as possible scan use.
    await p.evaluate(()=>{delete entries[0].canonicalImage;entries.push({id:'mixed-failure',status:'error',thumbnail:entries[0].thumbnail});save();render();});
    const beforeMixed=stats();await p.locator('#retry-failed-scans').click();assert.match(await p.locator('#scan-retry-cost').textContent(),/up to 1 scan.*1 Chinese catalog image/);await p.locator('#cancel-scan-retries').click();assert.deepEqual(stats(),beforeMixed);
    assert.deepEqual(errors,[]);console.log('PASS: cloud Chinese images on new scans, per-card/bulk retries, zero-scan bulk artwork repairs, complete document preservation, reload/device sync, stale image races and failed-image recovery. Zero live provider calls.');
  }finally{await browser?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
