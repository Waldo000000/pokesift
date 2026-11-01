const {reveal,openTools,closeTools,roomOptions,closeRoomOptions}=require('./ui.cjs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/card-effects.js'),'utf8'),scope);
const F=scope.window.PokeSiftFoil;
const printing={name:'Charizard',set:'Base Set 2',number:'004/130',language:'English',finish:'holofoil',canonical:true};
assert.equal(F.resolve(printing).profile,'cosmos');
assert.equal(F.resolve({...printing,finish:'non_holo'}).profile,'matte');
const reverseClassic=F.resolve({...printing,finish:'Reverse Holofoil'});
assert.equal(reverseClassic.profile,'reverse');assert.equal(reverseClassic.region,'reverse');assert.equal(reverseClassic.printing,null,'Reverse metadata must not reuse the regular holo silhouette');
for(const changed of [{language:'zh-TW'},{number:'4/102'},{set:'Celebrations'}]){const result=F.resolve({...printing,...changed});assert.equal(result.profile,'sheen');assert.equal(result.region,'artwork');assert.equal(result.printing,null,'Approximate holo must not reuse the English printing-specific mask');}
assert.equal(F.resolve({...printing,canonical:false}).profile,'matte');
assert.equal(F.resolve({rarity:'Rare Holo VMAX'}).profile,'matte');
assert.equal(F.resolve({finish:'full-art rainbow holo'}).profile,'rainbow');
const dondozo={name:'Dondozo',finish:'holo',suggestedFinish:'Holofoil',notes:'Double Rare Pokémon ex card inside a protective sleeve.',canonical:true};
for(const finish of ['holo','Holofoil','holo_foil','holographic','unknown']){const result=F.resolve({...dondozo,finish});assert.equal(result.profile,'sparkle');assert.equal(result.region,'full');assert.equal(result.layout,'modern');assert.equal(result.source,'metadata');}
assert.equal(F.resolve({...dondozo,notes:'',rarity:'Double Rare'}).profile,'sparkle');
assert.equal(F.resolve({...dondozo,notes:'Card inside a protective sleeve.'}).profile,'sheen');
assert.equal(F.resolve({...dondozo,notes:'Not a double rare Pokémon ex card.'}).profile,'sheen');
assert.equal(F.resolve({...dondozo,finish:'non_holo'}).profile,'matte','Explicit non-holo overrides notes and suggested printing');
assert.equal(F.resolve({...dondozo,finish:'',suggestedFinish:''}).profile,'matte','Sleeve/classification notes alone are not finish evidence');
assert.equal(F.resolve({...dondozo,appearance:{version:1,profile:'matte',region:'auto',layout:'modern'}}).profile,'matte');
const giovanni={name:"Team Rocket's Giovanni - 238/182",set:'SV10: Destined Rivals',number:'238/182',rarity:'Special Illustration Rare',finish:'Holofoil',canonical:true};
for(const rarity of ['Special Illustration Rare','Illustration Rare','Full Art Ultra Rare','Hyper Rare','Rare Holo VMAX','Rare Holo VSTAR']){
  const result=F.resolve({...giovanni,rarity});assert.equal(result.region,'full');assert.equal(result.layout,'full-art');assert.equal(result.profile,'full-sheen');
}
for(const extra of [{layout:'full_art'},{subtypes:['Supporter','Full Art']},{notes:'A full-art Supporter card.'}])assert.equal(F.resolve({...giovanni,rarity:'Rare',...extra}).region,'full');
assert.equal(F.resolve({...giovanni,finish:'non_holo'}).profile,'matte');assert.equal(F.resolve({...giovanni,finish:''}).profile,'matte','Full-art rarity alone must not enable foil');
assert.equal(F.resolve({...giovanni,canonical:false}).profile,'matte');
for(const notes of ['Not a full-art card.','Maybe full art.','No illustration rare printing confirmed.'])assert.equal(F.resolve({...giovanni,rarity:'Rare',notes}).region,'artwork');
assert.equal(F.resolve({...giovanni,rarity:'Rare Holo'}).region,'artwork','Regular holo cards retain their artwork-window mask');
assert.equal(F.resolve({...giovanni,appearance:{version:1,profile:'sheen',region:'artwork',layout:'modern'}}).region,'artwork','Saved manual settings must remain unchanged');
const birdKeeper={name:'Bird Keeper',set:'SWSH03: Darkness Ablaze',number:'159/189',language:'English',finish:'reverse_holo',canonical:true};
for(const finish of ['reverse_holo','Reverse Holofoil','reverse holo foil','reverse-holographic','reverse foil']){
  const result=F.resolve({...birdKeeper,finish});assert.equal(result.profile,'trainer-reverse');assert.equal(result.region,'reverse');assert.equal(result.layout,'trainer');assert.equal(result.source,'card-family');assert.match(result.note,/inferred/);
}
for(const set of ['Darkness Ablaze','Sword & Shield - Darkness Ablaze','SWSH03: Darkness Ablaze'])assert.equal(F.resolve({...birdKeeper,set}).profile,'trainer-reverse');
assert.equal(F.resolve({...birdKeeper,finish:'unknown',suggestedFinish:'Reverse Holofoil'}).profile,'trainer-reverse');
assert.equal(F.resolve({...birdKeeper,finish:'non_holo',suggestedFinish:'Reverse Holofoil'}).profile,'matte');
assert.equal(F.resolve({...birdKeeper,finish:'',suggestedFinish:''}).profile,'matte','A known printing never proves a physical finish by itself');
assert.equal(F.resolve({...birdKeeper,appearance:{version:1,profile:'matte',region:'auto',layout:'trainer'}}).profile,'matte');
assert.equal(F.resolve({...birdKeeper,canonical:false}).profile,'matte');
for(const changed of [{language:'Japanese'},{set:'Other set'},{number:'160/189'},{stamp:'Prerelease'}])assert.equal(F.resolve({...birdKeeper,...changed}).profile,'reverse','Unknown variants retain a generic reverse treatment, without assuming Trainer tiles');
const classifiedTrainer={finish:'reverse_holo',supertype:'Trainer - Supporter',set:'SWSH12: Silver Tempest',language:'en'};
assert.equal(F.resolve(classifiedTrainer).profile,'trainer-reverse');
assert.equal(F.resolve({...classifiedTrainer,supertype:'Pokemon'}).profile,'reverse');
assert.equal(F.resolve({finish:'reverse_holo',supertype:'Special Energy'}).region,'full');
assert.equal(F.cleanAppearance({version:1,profile:'constructor',region:'full',layout:'classic'}),null);
assert.equal(F.cleanAppearance({version:2,profile:'cosmos',region:'print',layout:'classic'}),null);
const artScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/concepts/art.js'),'utf8'),artScope);
const image=artScope.window.CONCEPT_ART['card-6'],base='http://127.0.0.1:8797',key='pokesift.collection.v1';
const entry={id:'foil-fixture',status:'matched',createdAt:'2026-10-27T00:00:00Z',canonicalImage:image,thumbnail:image,result:{data:{status:'matched',read:{game:'pokemon',name:'Charizard',language:'en',finish:'holofoil'},candidates:[{name:'Charizard',number:'4/130',set:{name:'Base Set 2'},prices:[{printing:'Normal',currency:'USD',market_price:1},{printing:'Holofoil',currency:'USD',market_price:5}]}]}}};
(async()=>{let browser;const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,POKESIFT_CLOUD_ENABLED:'0',PORT:'8797',POKESIFT_PASSWORD:'fixture-only',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''},stdio:'ignore'});
try{
  for(let i=0;i<60;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:851},hasTouch:true,isMobile:true});let paid=0;const errors=[];
  await context.route('**/api/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/session')return route.fulfill({json:{authenticated:true}});if(url.pathname==='/api/exchange-rates')return route.fulfill({json:{base:'AUD',date:'2026-10-27',rates:{AUD:1,USD:.5},source:'Fixture',fetchedAt:new Date().toISOString()}});paid++;return route.abort();});
  const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/concepts/card-study.html');await page.waitForFunction(()=>document.querySelector('#card-art').naturalWidth>0);
  assert.equal(await page.locator('#card').getAttribute('data-foil-profile'),'cosmos');
  const masks=await page.evaluate(async()=>{
    const F=PokeSiftFoil,out={};
    for(const region of ['print','subject','reverse','full','border','art-border']){
      const url=F.maskFor({profile:'cosmos',region,layout:'classic',printing:'base2-4-holo'}),im=new Image();im.src=url;await im.decode();const canvas=document.createElement('canvas');canvas.width=480;canvas.height=660;const c=canvas.getContext('2d');c.drawImage(im,0,0);const a=(x,y)=>c.getImageData(x*2,y*2,1,1).data[3];out[region]={subject:a(130,130),background:a(40,100),body:a(120,250),border:a(5,100)};
    }
    out.unknown=F.maskFor({profile:'cosmos',region:'print',layout:'classic'});out.energy=F.maskFor({profile:'reverse',region:'reverse',layout:'energy'});return out;
  });
  assert.deepEqual(masks.print,{subject:0,background:255,body:0,border:0});assert.equal(masks.subject.subject,255);assert.equal(masks.subject.background,0);
  assert.deepEqual(masks.reverse,{subject:0,background:0,body:255,border:0});assert.equal(masks.full.subject,255);assert.equal(masks.full.body,255);
  assert.deepEqual(masks.border,{subject:0,background:0,body:0,border:255});assert.equal(masks['art-border'].background,255);assert.equal(masks.unknown,null);assert.equal(masks.energy,null);
  const box=await page.locator('#card').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,cdp=await context.newCDPSession(page);
  const pixels=()=>page.locator('.foil-pattern').evaluate(c=>c.toDataURL());const before=await pixels();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+60,y:y-35}]});await page.waitForTimeout(250);assert.notEqual(await pixels(),before);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1400);const resting=await pixels();await page.waitForTimeout(100);assert.equal(await pixels(),resting);
  await page.getByText('Explore foil finishes',{exact:true}).click();
  for(const profile of Object.keys(F.profiles)){
    await page.locator('#study-finish').selectOption(profile);assert.equal(await page.locator('#card').getAttribute('data-foil-profile'),profile);
    await page.locator('#card').press('ArrowRight');await page.waitForTimeout(50);
  }
  await page.locator('#study-finish').selectOption('pokeball');await page.locator('#study-region').selectOption('reverse');await page.locator('#card').press('Home');await page.screenshot({path:'/tmp/pokesift-foil-library-mobile.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>PokeSiftMotion.set('reduced'));await page.locator('#card').press('ArrowLeft');assert.equal(await page.locator('#card').evaluate(e=>e.style.getPropertyValue('--card-ry')),'-6deg');
  await page.getByRole('button',{name:'Pikachu',exact:true}).click();assert(!(await page.locator('#card').evaluate(e=>e.classList.contains('has-foil'))));
  await page.goto(base);await page.evaluate(({key,entry})=>localStorage.setItem(key,JSON.stringify({version:1,entries:[entry]})),{key,entry});await page.reload();await closeTools(page);await page.locator('.card-tile').first().click();
  assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'cosmos','cheapest Normal price must not override the saved holo read');
  const originalResult=await page.evaluate(()=>structuredClone(entries[0].result));
  await page.getByText('Card finish & light',{exact:true}).click();await page.locator('#visual-finish').selectOption('sparkle');await page.locator('#visual-region').selectOption('full');
  let saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).entries[0],key);assert.deepEqual(saved.visualFinish,{version:1,profile:'sparkle',region:'full',layout:'classic'});assert.deepEqual(saved.result,originalResult);
  await page.locator('#toggle-photo').click();assert(!(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil'))));assert(await page.locator('#visual-finish').isDisabled());await page.locator('#toggle-photo').click();assert(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil')));
  await page.locator('#close-detail').click();await page.waitForFunction(()=>!document.querySelector('#detail-tilt .foil-pattern'));assert.equal(await page.locator('#detail-tilt .foil-pattern').count(),0);await page.reload();await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');
  await page.screenshot({path:'/tmp/pokesift-foil-collection-mobile.png',fullPage:true});await page.locator('#close-detail').click();
  const download=page.waitForEvent('download');await reveal(page,'#export');await page.locator('#export').click();const dl=await download,stream=await dl.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const backup=JSON.parse(Buffer.concat(chunks));assert.deepEqual(backup.entries[0].visualFinish,saved.visualFinish);
  await page.evaluate(()=>{entries=[];save();render();});await page.locator('#backup-file').setInputFiles({name:'foil-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('.card-tile').first().waitFor();await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');
  await page.evaluate(()=>{readOnlyStorage=true;renderDetail();});assert(await page.locator('#visual-finish').isDisabled());
  // Regression: the user's saved holo + double-rare ex note must activate foil
  // without an exact silhouette, a manual correction, or a fresh provider call.
  await page.locator('#close-detail').click();await page.waitForFunction(()=>!document.querySelector('#detail-tilt .foil-pattern'));
  await page.evaluate(()=>{readOnlyStorage=false;const e=entries[0];delete e.visualFinish;e.result.data.read={game:'pokemon',name:'Dondozo',finish:'holo',notes:'Double Rare Pokémon ex card inside a protective sleeve.'};e.result.data.candidates[0]={name:'Dondozo',set:{name:'Fixture set'},number:'1/100',suggested_printing:'Holofoil',prices:[{printing:'Normal',currency:'USD',market_price:1}]};save();render();});
  await closeTools(page);await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-region'),'full');
  assert(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil')));
  assert.match(await page.locator('#visual-finish option:checked').textContent(),/All-over sparkle/);assert.match(await page.locator('#visual-region option:checked').textContent(),/Whole card/);assert.equal(await page.locator('#visual-layout').inputValue(),'modern');
  const autoImage=await page.locator('#detail-tilt').screenshot();await page.locator('#detail-tilt').press('ArrowRight');
  const autoPixels=await page.locator('#detail-tilt .foil-pattern').evaluate(c=>c.toDataURL());await page.locator('#detail-tilt').press('ArrowRight');assert.notEqual(await page.locator('#detail-tilt .foil-pattern').evaluate(c=>c.toDataURL()),autoPixels,'Automatic holo must respond visibly to tilt');
  await page.locator('#detail-tilt').press('Home');
  if(!(await page.locator('.foil-settings').evaluate(e=>e.open)))await page.getByText('Card finish & light',{exact:true}).click();
  await page.locator('#visual-finish').selectOption('matte');assert(!(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil'))));assert.notDeepEqual(await page.locator('#detail-tilt').screenshot(),autoImage,'Automatic holo must render differently from no foil');
  assert.match(await page.locator('#visual-finish option[value="auto"]').textContent(),/All-over sparkle/);await page.locator('#visual-finish').selectOption('auto');
  assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');await page.locator('#close-detail').click();await page.reload();await closeTools(page);await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle','Existing saved entries should work after reload with no rescan');
  // The saved Bird Keeper response has reverse_holo and no supertype, just
  // like the compact identify API response. Existing entries update locally.
  await page.locator('#close-detail').click();await page.waitForFunction(()=>!document.querySelector('#detail-tilt .foil-pattern'));
  await page.evaluate(()=>{const e=entries[0];delete e.visualFinish;e.result.data.read={game:'pokemon',name:'Bird Keeper',number:'159/189',language:'english',finish:'reverse_holo',stamp:null};e.result.data.candidates[0]={name:'Bird Keeper',set:{name:'SWSH03: Darkness Ablaze'},number:'159/189',rarity:'Uncommon',suggested_printing:'Reverse Holofoil',prices:[{printing:'Normal',currency:'USD',market_price:1},{printing:'Reverse Holofoil',currency:'USD',market_price:2}]};save();render();});
  const reverseEvidence=await page.evaluate(()=>structuredClone(entries[0].result));
  await closeTools(page);await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'trainer-reverse');assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-region'),'reverse');
  assert.match(await page.locator('#visual-finish option:checked').textContent(),/Trainer reverse tiles/);assert.equal(await page.locator('#visual-layout').inputValue(),'trainer');assert.match(await page.locator('#visual-status').textContent(),/inferred/);
  const trainerMask=await page.evaluate(async()=>{const im=new Image();im.src=PokeSiftFoil.maskFor(PokeSiftFoil.resolve(PokeSiftCardDetails.describe(entries[0])));await im.decode();const c=document.createElement('canvas');c.width=480;c.height=660;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {art:ctx.getImageData(240,200,1,1).data[3],body:ctx.getImageData(240,500,1,1).data[3],border:ctx.getImageData(10,200,1,1).data[3]};});
  assert.deepEqual(trainerMask,{art:0,body:255,border:0});
  const tilePixels=()=>page.locator('#detail-tilt .foil-pattern').evaluate(c=>({url:c.toDataURL(),painted:c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)}));
  const restingTiles=await tilePixels();assert(restingTiles.painted);await page.locator('#detail-tilt').press('ArrowRight');assert.notEqual((await tilePixels()).url,restingTiles.url,'Trainer tiles must reflect a change in light angle');
  await page.locator('#detail-tilt').press('Home');await page.screenshot({path:'/tmp/pokesift-bird-keeper-reverse.png',fullPage:true});
  if(!(await page.locator('.foil-settings').evaluate(e=>e.open)))await page.getByText('Card finish & light',{exact:true}).click();
  await page.locator('#visual-finish').selectOption('matte');assert(!(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil'))));await page.locator('#visual-finish').selectOption('auto');
  await page.locator('#toggle-photo').click();assert(!(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil'))));await page.locator('#toggle-photo').click();assert(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil')));
  assert.deepEqual(await page.evaluate(()=>entries[0].result),reverseEvidence);await page.locator('#close-detail').click();await page.reload();await closeTools(page);await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'trainer-reverse','Saved reverse entries update without rescanning');
  await page.locator('#close-detail').click();await page.setViewportSize({width:844,height:390});await closeTools(page);await page.locator('[data-collection-view="binder"]').click();const binder=page.frameLocator('#collection-room');await binder.locator('#binder-stacks-toggle').click();await binder.locator('[data-card-key="foil-fixture"]').first().click();assert.equal(await binder.locator('.held-foil-card').getAttribute('data-foil-profile'),'trainer-reverse','Binder and collection must use the same automatic finish');await binder.locator('#put-back').click();await binder.locator('#binder-back').click();
  // New results with documented catalogue custom_attributes use their Trainer
  // layout too, without adding a new network request just to render the foil.
  await page.evaluate(()=>{const e=entries[0];e.result.data.read.name='Fixture Supporter';const c=e.result.data.candidates[0];c.name='Fixture Supporter';c.set.name='SWSH12: Silver Tempest';c.custom_attributes={cardType:'Trainer - Supporter'};save();render();});
  await closeTools(page);await page.locator('button[data-collection-view="grid"]').click();await closeTools(page);await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'trainer-reverse');assert.equal(await page.locator('#visual-layout').inputValue(),'trainer');
  // Existing full-art results must use the whole card locally, including the
  // lower artwork, and share the same coverage with the binder and fan.
  await page.locator('#close-detail').click();await page.evaluate(()=>{const e=entries[0];delete e.visualFinish;e.result.data.read={game:'pokemon',name:"Team Rocket's Giovanni - 238/182",language:'english',finish:'holo'};e.result.data.candidates[0]={name:"Team Rocket's Giovanni - 238/182",number:'238/182',set:{name:'SV10: Destined Rivals'},rarity:'Special Illustration Rare',suggested_printing:'Holofoil',prices:[{printing:'Holofoil',currency:'USD',market_price:10}]};save();render();});
  const fullArtEvidence=await page.evaluate(()=>structuredClone(entries[0].result));await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-region'),'full');assert.equal(await page.locator('#visual-layout').inputValue(),'full-art');assert.match(await page.locator('#visual-region option:checked').textContent(),/Whole card/);
  const fullMask=await page.evaluate(async()=>{const config=PokeSiftFoil.resolve(PokeSiftCardDetails.describe(entries[0])),im=new Image();im.src=PokeSiftFoil.maskFor(config);await im.decode();const c=document.createElement('canvas');c.width=480;c.height=660;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return [ctx.getImageData(240,200,1,1).data[3],ctx.getImageData(240,500,1,1).data[3],ctx.getImageData(10,200,1,1).data[3]];});assert.deepEqual(fullMask,[255,255,255],'Foil must cover the lower art and border, not only the upper rectangle');
  assert.deepEqual(await page.evaluate(()=>entries[0].result),fullArtEvidence);await page.locator('#close-detail').click();await page.reload();await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-region'),'full','Saved full-art cards update without rescanning');await page.locator('#close-detail').click();
  await page.setViewportSize({width:844,height:390});await page.locator('button[data-collection-view="binder"]').click();const fullBinder=page.frameLocator('#collection-room');await fullBinder.locator('#binder-stacks-toggle').click();await fullBinder.locator('[data-card-key="foil-fixture"]').first().click();assert.equal(await fullBinder.locator('.held-foil-card').getAttribute('data-foil-region'),'full');await fullBinder.locator('#put-back').click();await fullBinder.locator('#binder-back').click();
  await page.locator('button[data-collection-view="desk"]').click();const fullFan=page.frameLocator('#collection-room');await fullFan.locator('#card-fan .selected').press('Enter');assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-region'),'full');
  assert.equal(paid,0);assert.deepEqual(errors,[]);console.log('PASS: '+Object.keys(F.profiles).length+' foil treatments; masks; automatic full-art coverage, holo/ex and reverse-holo Trainer tiles; metadata and variant guards; collection/binder/fan consistency; touch and reduced motion; saved corrections; photo fallback; backup restore; renderer cleanup. No provider calls.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exit(1)});
