const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {openTools,closeTools,roomOptions,closeRoomOptions,reveal}=require('./ui.cjs');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-workspace-')),base='http://127.0.0.1:8813';
(async()=>{
 let browser;const server=spawn('python3',['tests/cloud_fixture.py',tmp,'8813'],{cwd:root,stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
  const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/concepts/art.js'),'utf8'),scope);const art=scope.window.CONCEPT_ART;
  const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json')));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,permissions:['camera']});
  await context.addCookies([{name:'pokesift-account',value:sessions.alice,url:base,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-10-31',rates:{AUD:1,USD:.5},source:'Fixture'}}));
  await context.route('**/api/pokemon-art?*',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({contentType:'image/png',body:Buffer.from(art['pokemon-'+id].split(',')[1],'base64')});});
  let providerCalls=0;for(const pattern of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await context.route(pattern,r=>{providerCalls++;return r.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#account-button').waitFor();
  await page.evaluate(art=>{
   entries=[[25,'Pikachu'],[151,'Mew'],[133,'Eevee']].map(([id,name],i)=>({id:'workspace-'+id,status:'matched',createdAt:'2026-10-31T00:00:0'+i+'Z',thumbnail:art['card-'+id],canonicalImage:art['card-'+id],result:{data:{status:'matched',read:{game:'pokemon',name,language:'english',finish:'non_holo'},candidates:[{name,number:'25/102',set:{name:i===1?'SWSH: Crown Zenith: Galarian Gallery':'Base Set'},prices:[{currency:'USD',market_price:5+i,printing:'Normal'},{currency:'USD',market_price:10+i,printing:'Holofoil'}]}]}}}));save();render();
  },art);
  const view=async mode=>{await closeTools(page);await page.locator('button[data-collection-view="'+mode+'"]').click();const f=page.frameLocator('#collection-room');await f.locator('#room-options-toggle').waitFor();return f;};
  const within=(r,v)=>r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1;
  const touch=await context.newCDPSession(page);
  async function swipe(x,y,dx,dy){
   const timestamp=Date.now()/1000;await touch.send('Input.dispatchTouchEvent',{type:'touchStart',timestamp,touchPoints:[{x,y,id:1}]});
   for(let n=1;n<=6;n++){await page.waitForTimeout(1);await touch.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:timestamp+n*.012,touchPoints:[{x:x+dx*n/6,y:y+dy*n/6,id:1}]});}
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:timestamp+.08,touchPoints:[]});
  }
  for(const viewport of [{width:320,height:668},{width:390,height:844},{width:768,height:1024},{width:1280,height:900},{width:844,height:390}]){
   await page.setViewportSize(viewport);let frame=await view('desk');await frame.locator('#card-fan .selected img').evaluate(im=>im.decode());
   const card=await frame.locator('#card-fan .selected').boundingBox();assert(within(card,viewport),'The whole selected card must fit at '+JSON.stringify(viewport));
   assert(card.width>=(viewport.height<500?70:viewport.width<500?240:300),'Cards must use the available space '+JSON.stringify({viewport,card}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow in the app shell');
   assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow in the fan');
   for(const selector of ['#open-camera','#workspace-tools-toggle','[data-collection-view="zoo"]'])assert(within(await page.locator(selector).boundingBox(),viewport));
   assert(await page.locator('.collection-heading').isHidden());assert(await page.locator('.prototype-links').isHidden());
   await roomOptions(frame);await frame.locator('#sort').selectOption('name');await closeRoomOptions(frame);assert(await frame.locator('#card-fan .selected').isVisible());
   await page.screenshot({path:'/tmp/pokesift-workspace-fan-'+viewport.width+'.png'});
   await page.locator('button[data-collection-view="grid"]').click();await page.locator('.card-tile').first().click();
   const image=await page.locator('#detail-tilt').boundingBox();if(viewport.width<=640)assert(image.width>=Math.min(viewport.width*.59,230),'The chosen larger-card layout must be applied');
   const popup=await page.locator('#detail-view').boundingBox(),close=await page.locator('#close-detail').boundingBox();
   assert(popup.x>=23&&popup.y>=23&&popup.x+popup.width<=viewport.width-23&&popup.y+popup.height<=viewport.height-23,'Leave an easy-to-tap backdrop around card details');
   assert(close.width>=48&&close.height>=48,'The close button must have a generous touch target');
   assert(close.y>=popup.y&&close.y+close.height<=popup.y+popup.height,'The whole close target must remain inside the popup');
   assert(await page.locator('#detail-value-summary').isVisible());assert.match(await page.locator('#detail-value-summary').textContent(),/A\$/);
   for(const selector of ['#valuation-choice','#remove-card']){await reveal(page,selector);assert(await page.locator(selector).isVisible());}
   await page.locator('#close-detail').click();
   frame=await view('desk');await frame.locator('#card-fan .selected').press('Enter');await page.locator('#detail-view').waitFor();
   const selected=await frame.locator('#card-fan').getAttribute('data-position');
   await page.locator('#detail-title').tap();assert(await page.locator('#detail-view').isVisible(),'Tapping popup contents must not close it');
   const edge=await page.locator('#detail-view').boundingBox();await page.touchscreen.tap(edge.x/2,edge.y+Math.min(80,edge.height/2));await page.locator('#detail-view').waitFor({state:'hidden'});
   assert.equal(await frame.locator('#card-fan').getAttribute('data-position'),selected,'Dismissing details must retain the current fan selection');
   if(viewport.width===390){
    for(const direction of [-1,1]){
     await frame.locator('#card-fan .selected').press('Enter');await page.locator('#detail-view').waitFor();
     const r=await page.locator('#detail-view').boundingBox(),x=r.x+r.width/2,y=r.y+36;
     await swipe(x,y,20,0);await page.waitForTimeout(180);assert(await page.locator('#detail-view').isVisible(),'Small incidental movements must snap back');
     await swipe(x,y,0,80);assert(await page.locator('#detail-view').isVisible(),'Vertical gestures must not dismiss details');
     const foil=await page.locator('#detail-tilt').boundingBox();await swipe(foil.x+foil.width/2,foil.y+foil.height/2,direction*65,0);assert(await page.locator('#detail-view').isVisible(),'The artwork keeps its 3D gesture');
     const label=page.locator('.species-correction>summary');await label.scrollIntoViewIfNeeded();const labelRect=await label.boundingBox();await swipe(labelRect.x+labelRect.width/2,labelRect.y+labelRect.height/2,direction*80,0);await page.locator('#detail-view').waitFor({state:'hidden'});assert.equal(await frame.locator('#card-fan').getAttribute('data-position'),selected,'A flick must return to the same fan selection');
    }
    await page.evaluate(()=>PokeSiftMotion.set('reduced'));await frame.locator('#card-fan .selected').press('Enter');await page.locator('#detail-view').waitFor();
    assert(!await page.locator('.species-correction').evaluate(el=>el.open),'Flicking an accordion must not activate its click action');const reduced=await page.locator('#detail-view').boundingBox();await swipe(reduced.x+reduced.width/2,reduced.y+36,-80,0);await page.locator('#detail-view').waitFor({state:'hidden'});await page.evaluate(()=>PokeSiftMotion.set('full'));
    frame=await view('binder');assert(within(await frame.locator('.binder-book').boundingBox(),viewport));assert(within(await frame.locator('#card-pile').boundingBox(),viewport));await page.screenshot({path:'/tmp/pokesift-workspace-binder.png'});
    await frame.locator('#card-pile .piled-card').last().press('Enter');await frame.locator('#detail').waitFor();
    const held=await frame.locator('#detail').boundingBox();assert(held.x>=23&&held.x+held.width<=viewport.width-23);await page.touchscreen.tap(held.x/2,held.y+50);await frame.locator('#detail').waitFor({state:'hidden'});
    assert.equal(await frame.locator('#binder-spread').getAttribute('data-start-page'),'0','Dismissing the binder popup must retain the page');
    await frame.locator('#card-pile .piled-card').last().press('Enter');await frame.locator('#detail').waitFor();await frame.locator('#detail h2').scrollIntoViewIfNeeded();const binderTitle=await frame.locator('#detail h2').boundingBox();await swipe(binderTitle.x+binderTitle.width/2,binderTitle.y+binderTitle.height/2,90,0);await frame.locator('#detail').waitFor({state:'hidden'});
    frame=await view('zoo');await frame.locator('[data-pokemon="25"]').waitFor();await frame.locator('#room-search').fill('Eevee');assert.equal(await frame.locator('.habitat-pokemon').count(),1);await frame.locator('#room-search').fill('');assert.equal(await frame.locator('.habitat-pokemon').count(),3);
    await roomOptions(frame);assert(await frame.locator('#share-zoo').isVisible());assert(await frame.locator('.arrange-pokemon').isVisible());await closeRoomOptions(frame);
   }
  }
  await page.setViewportSize({width:390,height:844});await page.locator('button[data-collection-view="grid"]').click();await page.locator('.card-tile').first().click();await page.screenshot({path:'/tmp/pokesift-workspace-card-large.png'});await page.locator('#close-detail').click();
  await openTools(page);assert(await page.locator('#export').isVisible());assert(await page.locator('#bulk-pricing').isHidden());await reveal(page,'#update-missing-prices');assert(await page.locator('#update-missing-prices').isVisible());await page.locator('.tool-playground>summary').click();assert.equal(await page.locator('.prototype-links a:visible').count(),4);await closeTools(page);
  await page.locator('#account-button').click();await page.locator('#account-email').waitFor();await reveal(page,'#join-code');assert(await page.locator('#join-code').isVisible());await page.locator('#close-account').click();
  await page.locator('#open-camera').click();await page.locator('#enable-camera').click();await page.locator('#shutter').waitFor({state:'visible'});assert(await page.locator('#close-camera').isVisible());assert(await page.locator('#choose-photos').isVisible());await page.locator('#close-camera').click();
  const download=page.waitForEvent('download');await reveal(page,'#export');await page.locator('#export').click();const backup=await download;const stream=await backup.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(JSON.parse(Buffer.concat(chunks)).entries.length,3);assert(await page.locator('#workspace-tools').isHidden());
  assert.equal(providerCalls,0);assert.deepEqual(errors,[]);console.log('PASS: viewport-first fan, compact navigation, floating card dialog, backdrop and left/right flick dismissal, preserved 3D/vertical gestures, tools/disclosures, Zoo search, camera and complete backup across phone/tablet/desktop/landscape. Zero provider calls.');
 }finally{await browser?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
