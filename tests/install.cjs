const {chromium,webkit}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-install-')),port=8830,base=`http://127.0.0.1:${port}`;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=';
const doc={id:'install-card',status:'matched',thumbnail:image,canonicalImage:image,collectorNote:'Keep this fixture photo',result:{data:{status:'matched',read:{game:'pokemon',name:'Pikachu',language:'english'},candidates:[{name:'Pikachu',prices:[]}]}}};
(async()=>{
 const server=spawn('python3',['tests/cloud_fixture.py',tmp,String(port)],{cwd:root,env:{...process.env,TCGAPI_KEY:'fixture-only'},stdio:['ignore','pipe','pipe']});let output='',android,ipad;
 server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
  const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json'))),cookie={name:'pokesift-account',value:sessions.alice,url:base,httpOnly:true,sameSite:'Strict'};
  const errors=[];let paid=0;
  async function fixtures(context){
   for(const pattern of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await context.route(pattern,r=>{paid++;return r.abort();});
   await context.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-11-04',rates:{AUD:1,USD:.5},source:'Fixture'}}));
  }
  android=await chromium.launchPersistentContext(path.join(tmp,'android-profile'),{executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox'],viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'});
  await fixtures(android);await android.addCookies([cookie]);const p=android.pages()[0];p.on('pageerror',e=>errors.push(e.message));
  const navigations=[];p.on('framenavigated',f=>{if(f===p.mainFrame())navigations.push(f.url());});await p.goto(base);await p.waitForFunction(()=>document.body.dataset.auth==='signed-in');
  await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  assert.equal(navigations.length,1,'Registering the app must not reload an open collection');
  const cdp=await android.newCDPSession(p),manifest=await cdp.send('Page.getAppManifest');assert.equal(manifest.errors.length,0);const data=JSON.parse(manifest.data);assert.equal(data.display,'standalone');assert.equal(data.id,'/');
  const eligibility=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(eligibility.installabilityErrors,[],'Chromium installability checks must pass');
  // Native install prompts are offered only following an explicit tap.
  await p.evaluate(()=>{window.nativePrompts=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{nativePrompts++;return Promise.resolve();};e.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(e);window.installDefaultPrevented=e.defaultPrevented;});
  assert.equal(await p.evaluate(()=>nativePrompts),0);assert(await p.evaluate(()=>installDefaultPrevented));
  await p.locator('#workspace-tools-toggle').click();await p.locator('#install-app').click();assert(await p.locator('#workspace-tools').isHidden());assert(await p.locator('#install-view').isVisible());assert.match(await p.locator('#install-instructions').textContent(),/Chrome/);await p.locator('#install-now').click();await p.waitForFunction(()=>document.querySelector('#install-status').textContent.includes('dismissed'));assert.equal(await p.evaluate(()=>nativePrompts),1);
  await p.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{nativePrompts++;return Promise.resolve();};e.userChoice=Promise.resolve({outcome:'accepted'});dispatchEvent(e);});await p.locator('#install-now').click();await p.waitForFunction(()=>document.querySelector('#install-status').textContent.includes('confirmation'));await p.evaluate(()=>dispatchEvent(new Event('appinstalled')));assert(await p.locator('#install-now').isHidden());assert.match(await p.locator('#install-intro').textContent(),/own app window/);await p.mouse.click(2,2);assert(await p.locator('#install-view').isHidden());
  // Preserve a saved card and scan photo through worker activation and an
  // offline cold launch. Neither is ever added to Cache Storage.
  await p.evaluate(async doc=>{const blob=PokeSiftPhotos.decode(doc.thumbnail);await PokeSiftPhotos.put(doc.id,blob);entries=[doc];save();render();await PokeSiftCloud.sync();},doc);
  await p.waitForFunction(()=>document.querySelector('#sync-status').textContent==='Synced');
  await p.evaluate(async()=>{await fetch('/api/session');await fetch('/api/cloud/inventory');await fetch('/runtime.js');});
  async function cachedPaths(page){return page.evaluate(async()=>{const paths=[];for(const name of await caches.keys())for(const r of await(await caches.open(name)).keys())paths.push(new URL(r.url).pathname+new URL(r.url).search);return paths.sort();});}
  const allowed=['/icons/app-192.png','/offline.html','/offline.js','/pwa.css'];assert.deepEqual(await cachedPaths(p),allowed);
  await android.setOffline(true);await p.goto(base+'/index.html#private=fixture-secret');await p.locator('#retry-connection').waitFor();assert.match(await p.locator('body').textContent(),/You’re offline/);assert.equal(await p.locator('.install-icon').evaluate(im=>im.naturalWidth),192);assert.equal(await p.locator('button').evaluate(b=>getComputedStyle(b).backgroundColor),'rgb(40, 92, 70)');
  assert(await p.evaluate(async()=>{try{await fetch('/api/session');return false;}catch{return true;}}),'A private API must fail offline, not receive a cached response or HTML');
  assert(await p.evaluate(async()=>{try{await fetch('/auth/callback?code=fixture-secret');return false;}catch{return true;}}),'OAuth callbacks must bypass the offline fallback');assert.deepEqual(await cachedPaths(p),allowed);
  await android.setOffline(false);await p.locator('#retry-connection').click();await p.locator('.card-tile').waitFor();assert.equal(await p.evaluate(()=>entries[0].collectorNote),doc.collectorNote);assert(await p.evaluate(async()=>Boolean(await PokeSiftPhotos.get('install-card'))));assert.deepEqual(await cachedPaths(p),allowed);
  await p.screenshot({path:'/tmp/pokesift-installed-android.png'});
  await android.close();android=null;
  // iPadOS desktop user agent + touch hardware is still detected as iPad.
  // WebKit runs in CI; Chromium-only mode is available for local machines
  // without the required WebKit system libraries.
  const browserType=process.env.POKESIFT_CHROMIUM_ONLY==='1'?chromium:webkit;
  ipad=await browserType.launchPersistentContext(path.join(tmp,'ipad-profile'),{headless:true,...(browserType===chromium?{executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}:{}),viewport:{width:834,height:1194},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'});
  await fixtures(ipad);await ipad.addInitScript(()=>{Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});});
  const tablet=ipad.pages()[0];tablet.on('pageerror',e=>errors.push(e.message));await tablet.goto(base);await tablet.locator('#google-sign-in').waitFor();await tablet.locator('#install-from-signin').click();assert.match(await tablet.locator('#install-instructions').textContent(),/Safari.*Share.*Add to Home Screen.*Open as Web App/);assert(await tablet.locator('#install-now').isHidden());assert.match(await tablet.locator('#install-account-note').textContent(),/usual Google account/);await tablet.screenshot({path:'/tmp/pokesift-install-ipad.png'});await tablet.locator('#close-install').click();
  // An installed app keeps normal Google/session startup, without repeatedly
  // offering installation or changing a saved collection.
  await ipad.addCookies([cookie]);await ipad.addInitScript(()=>Object.defineProperty(navigator,'standalone',{get:()=>true}));await tablet.reload();await tablet.locator('.card-tile').waitFor();await tablet.locator('#workspace-tools-toggle').click();assert.match(await tablet.locator('#install-app').textContent(),/is installed/);await tablet.locator('#install-app').click();assert(await tablet.locator('#install-instructions').isHidden());assert(await tablet.locator('#install-now').isHidden());await tablet.locator('#close-install').click();await tablet.locator('#open-camera').click();assert(await tablet.locator('#camera-view').isVisible());await tablet.locator('#close-camera').click();assert.equal(await tablet.evaluate(()=>entries[0].collectorNote),doc.collectorNote);
  assert.equal(paid,0);assert.deepEqual(errors,[]);console.log('PASS: valid Android manifest/installability, explicit install/dismiss/installed flows, public-only offline cache, offline cold launch/reconnect, preserved account/card/photo, iPad instructions and standalone startup/camera. '+(browserType===webkit?'WebKit iPad engine.':'Chromium iPad emulation.'));
 }finally{await android?.close();await ipad?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
