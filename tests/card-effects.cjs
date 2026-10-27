const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/card-effects.js'),'utf8'),scope);
const F=scope.window.PokeSiftFoil;
const printing={name:'Charizard',set:'Base Set 2',number:'004/130',language:'English',finish:'holofoil',canonical:true};
assert.equal(F.resolve(printing).profile,'cosmos');
assert.equal(F.resolve({...printing,finish:'non_holo'}).profile,'matte');
assert.equal(F.resolve({...printing,finish:'Reverse Holofoil'}).profile,'matte');
assert.equal(F.resolve({...printing,language:'zh-TW'}).profile,'matte');
assert.equal(F.resolve({...printing,number:'4/102'}).profile,'matte');
assert.equal(F.resolve({...printing,set:'Celebrations'}).profile,'matte');
assert.equal(F.resolve({...printing,canonical:false}).profile,'matte');
assert.equal(F.resolve({rarity:'Rare Holo VMAX'}).profile,'matte');
assert.equal(F.resolve({finish:'full-art rainbow holo'}).profile,'rainbow');
assert.equal(F.cleanAppearance({version:1,profile:'constructor',region:'full',layout:'classic'}),null);
assert.equal(F.cleanAppearance({version:2,profile:'cosmos',region:'print',layout:'classic'}),null);
const artScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/concepts/art.js'),'utf8'),artScope);
const image=artScope.window.CONCEPT_ART['card-6'],base='http://127.0.0.1:8797',key='pokesift.collection.v1';
const entry={id:'foil-fixture',status:'matched',createdAt:'2026-10-27T00:00:00Z',canonicalImage:image,thumbnail:image,result:{data:{status:'matched',read:{game:'pokemon',name:'Charizard',language:'en',finish:'holofoil'},candidates:[{name:'Charizard',number:'4/130',set:{name:'Base Set 2'},prices:[{printing:'Normal',currency:'USD',market_price:1},{printing:'Holofoil',currency:'USD',market_price:5}]}]}}};
(async()=>{let browser;const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,PORT:'8797',POKESIFT_PASSWORD:'fixture-only',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''},stdio:'ignore'});
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
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#card').press('ArrowLeft');assert.equal(await page.locator('#card').evaluate(e=>e.style.getPropertyValue('--card-ry')),'-6deg');
  await page.getByRole('button',{name:'Pikachu',exact:true}).click();assert(!(await page.locator('#card').evaluate(e=>e.classList.contains('has-foil'))));
  await page.goto(base);await page.evaluate(({key,entry})=>localStorage.setItem(key,JSON.stringify({version:1,entries:[entry]})),{key,entry});await page.reload();await page.locator('.card-tile').first().click();
  assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'cosmos','cheapest Normal price must not override the saved holo read');
  const originalResult=await page.evaluate(()=>structuredClone(entries[0].result));
  await page.getByText('Card finish & light',{exact:true}).click();await page.locator('#visual-finish').selectOption('sparkle');await page.locator('#visual-region').selectOption('full');
  let saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).entries[0],key);assert.deepEqual(saved.visualFinish,{version:1,profile:'sparkle',region:'full',layout:'classic'});assert.deepEqual(saved.result,originalResult);
  await page.locator('#toggle-photo').click();assert(!(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil'))));assert(await page.locator('#visual-finish').isDisabled());await page.locator('#toggle-photo').click();assert(await page.locator('#detail-tilt').evaluate(e=>e.classList.contains('has-foil')));
  await page.locator('#close-detail').click();await page.waitForFunction(()=>!document.querySelector('#detail-tilt .foil-pattern'));assert.equal(await page.locator('#detail-tilt .foil-pattern').count(),0);await page.reload();await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');
  await page.screenshot({path:'/tmp/pokesift-foil-collection-mobile.png',fullPage:true});await page.locator('#close-detail').click();
  const download=page.waitForEvent('download');await page.locator('#export').click();const dl=await download,stream=await dl.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const backup=JSON.parse(Buffer.concat(chunks));assert.deepEqual(backup.entries[0].visualFinish,saved.visualFinish);
  await page.evaluate(()=>{entries=[];save();render();});await page.locator('#backup-file').setInputFiles({name:'foil-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('.card-tile').first().waitFor();await page.locator('.card-tile').first().click();assert.equal(await page.locator('#detail-tilt').getAttribute('data-foil-profile'),'sparkle');
  await page.evaluate(()=>{readOnlyStorage=true;renderDetail();});assert(await page.locator('#visual-finish').isDisabled());
  assert.equal(paid,0);assert.deepEqual(errors,[]);console.log('PASS: 20 foil treatments; print/subject/reverse/full/border masks; conservative metadata; touch and reduced motion; saved corrections; photo fallback; backup restore; renderer cleanup. No provider calls.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exit(1)});
