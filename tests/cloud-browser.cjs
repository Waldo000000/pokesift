const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-cloud-')),port=8801,base=`http://127.0.0.1:${port}`;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=';
const card={id:'legacy-one',status:'matched',createdAt:'2026-10-01T00:00:00Z',thumbnail:image,canonicalImage:image,scanPhoto:{id:'legacy-one',mime:'image/png',bytes:68,persisted:true},scanHistory:[{id:'old-photo',thumbnail:image,scanPhoto:{id:'old-photo',mime:'image/png',persisted:true},result:{read:'original evidence'}}],providerObservations:[{provider:'tcgapi',response:{raw:'preserve'}}],result:{data:{status:'matched',read:{name:'Pikachu',game:'pokemon',finish:'holo'},candidates:[{name:'Pikachu',prices:[{market_price:7,currency:'USD',currency_assumed:true}]}]}},visualFinish:{profile:'sparkle',region:'full',layout:'modern'},pokemonSpeciesIds:[25],selectedPriceKey:'saved-choice',futureData:{nested:['keep','everything']}};
const layout={version:1,slots:['legacy-one',null],piles:[[],[]],positions:{25:[30,40]}};
(async()=>{const server=spawn('python3',['tests/cloud_fixture.py',tmp,String(port)],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let browser;let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
 const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json')));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const errors=[];let paid=0;
 async function context(which,seed=false){const c=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});await c.addCookies([{name:'pokesift-account',value:sessions[which],url:base,httpOnly:true,sameSite:'Strict'}]);
 await c.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-10-28',rates:{USD:.5,AUD:1},source:'Fixture',fetchedAt:new Date().toISOString()}}));
 await c.route('**/api/pokemon-art?*',r=>r.fulfill({contentType:'image/png',body:Buffer.from(image.split(',')[1],'base64')}));
 for(const route of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await c.route(route,r=>{paid++;return r.abort()});
 if(seed)await c.addInitScript(({card,layout,image})=>{if(localStorage.getItem('fixture-seeded'))return;localStorage.setItem('fixture-seeded','1');localStorage.setItem('pokesift.collection.v1',JSON.stringify({version:1,entries:[card],collectionViews:layout}));window.seedPhotos=new Promise((resolve,reject)=>{const r=indexedDB.open('pokesift-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('scan-images');r.onsuccess=()=>{const db=r.result,tx=db.transaction('scan-images','readwrite'),bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));for(const id of ['legacy-one','old-photo'])tx.objectStore('scan-images').put(new Blob([bytes],{type:'image/png'}),id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};r.onerror=reject;});},{card,layout,image});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')process.stderr.write('browser: '+m.text()+'\n')});await p.goto(base);await p.locator('#account-button').waitFor();if(seed)await p.evaluate(()=>window.seedPhotos);return {c,p};}
 const waitSynced=async p=>{await p.waitForFunction(()=>document.querySelector('#sync-status')?.textContent==='Synced',{},{timeout:20000})};
 const a=await context('alice',true);await waitSynced(a.p);
 if(process.env.POKESIFT_SCREENSHOT_DIR){fs.mkdirSync(process.env.POKESIFT_SCREENSHOT_DIR,{recursive:true});await a.p.screenshot({path:path.join(process.env.POKESIFT_SCREENSHOT_DIR,'cloud-migration-mobile.png'),fullPage:true});}
 assert.equal(await a.p.locator('#cloud-migration').isVisible(),true);assert.equal(await a.p.locator('.card-tile').count(),0);
 const backup=a.p.waitForEvent('download');await a.p.getByRole('button',{name:'Back up this device first',exact:true}).click();const dl=await backup;const stream=await dl.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const original=JSON.parse(Buffer.concat(chunks));assert.equal(Object.keys(original.scanImages).length,2);
 await a.p.locator('#migrate-device').click();await a.p.locator('.card-tile').waitFor();await waitSynced(a.p);
 assert.deepEqual(await a.p.evaluate(()=>JSON.parse(localStorage.getItem('pokesift.collection.v1')).entries[0]),card,'legacy source must remain unchanged');
 const migrated=await a.p.evaluate(()=>PokeSiftCloud.snapshot().entries[0]);assert.deepEqual(migrated.futureData,card.futureData);assert.deepEqual(migrated.visualFinish,card.visualFinish);assert(migrated.scanPhoto.sha256);assert(migrated.scanHistory[0].scanPhoto.sha256);
 const inventory=await a.p.evaluate(()=>PokeSiftCloud.api('inventory'));assert.equal(inventory.cards.length,1);assert.equal(inventory.migrations[0].state,'complete');assert.equal(inventory.layout.document.slots[0],'legacy-one');
 const second=await context('alice');await second.p.locator('.card-tile').waitFor();await waitSynced(second.p);assert.deepEqual(await second.p.evaluate(()=>PokeSiftCloud.snapshot().entries[0].futureData),card.futureData);
 const exportWait=second.p.waitForEvent('download');await second.p.locator('#export').click();const exportStream=await (await exportWait).createReadStream(),parts=[];for await(const part of exportStream)parts.push(part);const exported=JSON.parse(Buffer.concat(parts));assert.equal(Object.keys(exported.scanImages).length,2);assert.deepEqual(exported.missingScanImages,[]);assert.deepEqual(exported.collectionViews.positions,layout.positions);
 const b=await context('bob');await waitSynced(b.p);assert.equal(await b.p.locator('.card-tile').count(),0);
 const isolation=await b.p.evaluate(async sha=>({card:(await fetch('/api/cloud/card?id=legacy-one')).status,media:(await fetch('/api/cloud/media?hash='+sha)).status,admin:(await fetch('/api/cloud/admin')).status}),migrated.scanPhoto.sha256);assert.deepEqual(isolation,{card:404,media:404,admin:403});
 // Offline edits on separate devices merge disjoint fields without losing data.
 await a.c.setOffline(true);await second.c.setOffline(true);
 await a.p.evaluate(()=>{entries[0].pokemonSpeciesIds=[25,133];save();render()});
 await second.p.evaluate(()=>{entries[0].visualFinish={profile:'cosmos',region:'artwork',layout:'classic'};save();render()});
 await a.c.setOffline(false);await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);
 await second.c.setOffline(false);await second.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(second.p);
 await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);
 const merged=await a.p.evaluate(()=>PokeSiftCloud.snapshot().entries[0]);assert.deepEqual(merged.pokemonSpeciesIds,[25,133]);assert.equal(merged.visualFinish.profile,'cosmos');
 // Concurrent edits to the same field are surfaced, preserving both versions.
 await a.c.setOffline(true);await second.c.setOffline(true);
 await a.p.evaluate(()=>{entries[0].collectorNote='Phone note';save()});await second.p.evaluate(()=>{entries[0].collectorNote='Tablet note';save()});
 await a.c.setOffline(false);await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);
 await second.c.setOffline(false);await second.p.evaluate(()=>PokeSiftCloud.sync());await second.p.locator('#sync-conflicts').waitFor({state:'visible'});
 assert.match(await second.p.locator('#sync-conflicts pre').textContent(),/Phone note/);assert.match(await second.p.locator('#sync-conflicts pre').textContent(),/Tablet note/);
 await second.p.getByRole('button',{name:'Use this device',exact:true}).click();await waitSynced(second.p);await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);assert.equal(await a.p.evaluate(()=>entries[0].collectorNote),'Tablet note');
 // A dropped acknowledgement replays the same operation instead of duplicating a card.
 let dropped=false;await a.c.route('**/api/cloud/card',async r=>{if(r.request().method()==='POST'&&!dropped){dropped=true;await r.fetch();return r.abort();}return r.continue()});
 await a.p.evaluate(()=>{entries[0].replayMarker='once';save()});await a.p.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('fetch'),{},{timeout:10000}).catch(()=>{});
 assert(dropped);await a.c.unroute('**/api/cloud/card');await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);
 const afterReplay=await a.p.evaluate(()=>PokeSiftCloud.api('card?id=legacy-one'));assert.equal(afterReplay.document.replayMarker,'once');assert.equal((await a.p.evaluate(()=>PokeSiftCloud.api('inventory'))).cards.length,1);
 // Invites are transferable grants, not access to the sender's collection.
 const invite=await a.p.evaluate(()=>PokeSiftCloud.api('invite',{}));assert.equal(invite.maxUses,5);assert(invite.expiresAt>Date.now()/1000+6*86400);
 await b.p.evaluate(code=>PokeSiftCloud.api('redeem',{code}),invite.code);await b.p.evaluate(code=>PokeSiftCloud.api('redeem',{code}),invite.code);
 const info=await b.p.evaluate(()=>fetch('/api/session').then(r=>r.json()));assert.equal(info.account.scanAllowance,50);assert.equal(info.account.role,'member');assert.equal((await b.p.evaluate(()=>PokeSiftCloud.api('inventory'))).cards.length,0);
 // Restore the complete cloud export into a different account without rescanning.
 b.p.once('dialog',dialog=>dialog.accept());await b.p.locator('#backup-file').setInputFiles({name:'collection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
 await b.p.locator('.card-tile').waitFor();await waitSynced(b.p);
 assert.equal((await b.p.evaluate(()=>PokeSiftCloud.api('inventory'))).cards.length,1);
 assert.deepEqual(await b.p.evaluate(()=>PokeSiftCloud.snapshot().entries[0].futureData),card.futureData);
 assert.equal(await b.p.evaluate(async()=>Boolean(await PokeSiftPhotos.get('old-photo'))),true);
 // Another device's retake replaces a cached current photo, but keeps its history.
 const changedHash=await a.p.evaluate(async()=>{const old=await PokeSiftPhotos.get('legacy-one'),blob=new Blob([await old.arrayBuffer(),'retake fixture'],{type:'image/png'});await PokeSiftPhotos.put('legacy-one',blob);const sha=await PokeSiftPhotos.digest(blob);entries[0].scanPhoto={...entries[0].scanPhoto,sha256:sha,bytes:blob.size};save();return sha;});
 await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);await second.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(second.p);
 assert.equal(await second.p.evaluate(async()=>PokeSiftPhotos.digest(await PokeSiftPhotos.get('legacy-one'))),changedHash);
 assert.equal(await second.p.evaluate(async()=>PokeSiftPhotos.digest(await PokeSiftPhotos.get('old-photo'))),migrated.scanPhoto.sha256);
 if(process.env.POKESIFT_SCREENSHOT_DIR){await a.p.locator('#account-button').click();await a.p.screenshot({path:path.join(process.env.POKESIFT_SCREENSHOT_DIR,'cloud-account-mobile.png'),fullPage:true});await a.p.locator('#close-account').click();}
 // Soft delete syncs and explicit recovery brings the same card back.
 await a.p.evaluate(()=>{entries=[];save();render()});await a.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(a.p);
 await second.p.evaluate(()=>PokeSiftCloud.sync());await waitSynced(second.p);assert.equal(await second.p.locator('.card-tile').count(),0);
 await second.p.evaluate(()=>PokeSiftCloud.recover('legacy-one'));await waitSynced(second.p);assert.equal(await second.p.locator('.card-tile').count(),1);
 // Reload reads the durable account cache and never imports the legacy source twice.
 await a.p.reload();await a.p.locator('.card-tile').waitFor();await waitSynced(a.p);assert.equal(await a.p.locator('#cloud-migration').isVisible(),false);
 // Check account UI on phone; cloud sign-out removes only this account cache.
 await a.p.locator('#account-button').click();await a.p.locator('summary').filter({hasText:'Sign out of this device'}).click();await a.p.locator('#account-sign-out').click();await a.p.locator('#google-sign-in').waitFor();assert.equal(await a.p.locator('#collection-view').isVisible(),false);assert.equal(await a.p.evaluate(()=>JSON.parse(localStorage.getItem('pokesift.collection.v1')).entries.length),1);
 assert.equal(paid,0);assert.deepEqual(errors,[]);
 console.log('PASS: two-device cloud sync, complete migration, cloud backup restore and remote retake cache, account isolation, offline merges/conflicts, lost acknowledgements, invites, soft deletion/recovery and sign-out. Zero provider calls.');
}finally{await browser?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exit(1)});
