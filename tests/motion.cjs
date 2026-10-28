const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8799';
(async()=>{let browser;const server=spawn('python3',['server.py'],{cwd:root,env:{...process.env,POKESIFT_CLOUD_ENABLED:'0',PORT:'8799',POKESIFT_PASSWORD:'motion-fixture',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:''},stdio:'ignore'});
try{
  for(let i=0;i<50;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  let providerCalls=0;const errors=[];
  await context.route('**/api/**',r=>{const pathname=new URL(r.request().url()).pathname;if(pathname==='/api/session')return r.fulfill({json:{authenticated:true}});if(pathname==='/api/exchange-rates')return r.fulfill({json:{base:'AUD',date:'2026-10-27',rates:{AUD:1,USD:.5},source:'Fixture',fetchedAt:new Date().toISOString()}});providerCalls++;return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/concepts/desk.html');
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  assert.equal(await page.evaluate(()=>PokeSiftMotion.matches),false,'Full animations must be the default despite the OS preference');
  assert.equal(await page.locator('html').getAttribute('data-motion'),'full');
  await page.evaluate(()=>{const probe=document.createElement('div');probe.id='motion-probe';probe.style.transition='opacity 1s';document.body.append(probe);});
  assert.equal(await page.locator('#motion-probe').evaluate(n=>getComputedStyle(n).transitionDuration),'1s');
  async function fanMove(animated){
    const start=Number(await page.locator('#card-fan').getAttribute('data-position'));
    await page.evaluate(()=>{window.motionFrames=[];const host=document.querySelector('#card-fan');function tick(){motionFrames.push(Number(host.dataset.position));window.motionRAF=requestAnimationFrame(tick);}tick();});
    await page.locator('#card-fan').press('ArrowLeft');await page.waitForTimeout(550);
    const frames=await page.evaluate(()=>{cancelAnimationFrame(motionRAF);return motionFrames;});
    assert.equal(Number(await page.locator('#card-fan').getAttribute('data-position')),start-1);
    assert.equal(frames.some(p=>p>start-1&&p<start),animated,'Fan motion must follow the app preference');
  }
  await fanMove(true);
  await page.locator('[data-motion-choice]').selectOption('reduced');await fanMove(false);
  assert.equal(await page.locator('#motion-probe').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
  await page.reload();assert.equal(await page.locator('[data-motion-choice]').inputValue(),'reduced');assert.equal(await page.evaluate(()=>PokeSiftMotion.matches),true);
  await page.locator('[data-motion-choice]').selectOption('full');await fanMove(true);
  await page.locator('[data-motion-choice]').selectOption('system');await fanMove(false);
  await page.emulateMedia({reducedMotion:'no-preference'});await fanMove(true);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>PokeSiftMotion.matches),true);
  await page.locator('[data-motion-choice]').selectOption('full');
  await page.goto(base+'/concepts/binder.html');await page.locator('#next-page').click();
  assert.equal(await page.locator('.turning-sheet').count(),1,'Binder turn must animate with OS Reduce Motion on');await page.waitForTimeout(800);
  await page.locator('[data-motion-choice]').selectOption('reduced');await page.locator('#next-page').click();assert.equal(await page.locator('.turning-sheet').count(),0);
  await page.locator('[data-motion-choice]').selectOption('full');await page.goto(base+'/concepts/zoo.html');
  await page.locator('[data-pokemon="25"]').focus();await page.locator('[data-pokemon="25"]').press('Enter');
  assert(await page.locator('[data-pokemon="25"] img').evaluate(n=>n.getAnimations().length>0),'Zoo tap animation must run with full app motion');
  await page.keyboard.press('Escape');await page.locator('[data-motion-choice]').selectOption('reduced');
  await page.locator('[data-pokemon="25"]').press('Enter');assert.equal(await page.locator('[data-pokemon="25"] img').evaluate(n=>n.getAnimations().length),0);
  await page.keyboard.press('Escape');await page.locator('[data-motion-choice]').selectOption('full');
  await page.goto(base+'/concepts/card-study.html');await page.evaluate(()=>{window.tiltFrames=[];function tick(){tiltFrames.push(parseFloat(document.querySelector('#card').style.getPropertyValue('--card-ry'))||0);window.tiltRAF=requestAnimationFrame(tick);}tick();});
  await page.locator('#card').press('ArrowRight');await page.waitForTimeout(700);const tilt=await page.evaluate(()=>{cancelAnimationFrame(tiltRAF);return tiltFrames;});assert(tilt.some(x=>x>0&&x<6),'Card tilt should interpolate with full app motion');
  await page.locator('[data-motion-choice]').selectOption('reduced');await page.locator('#card').press('Home');await page.locator('#card').press('ArrowRight');assert.equal(await page.locator('#card').evaluate(n=>n.style.getPropertyValue('--card-ry')),'6deg');
  // Parent and collection iframe share changes immediately; no reload needed.
  await page.evaluate(()=>{const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=';localStorage.setItem('pokesift.collection.v1',JSON.stringify({version:1,entries:[{id:'motion-fixture',status:'matched',thumbnail:image,canonicalImage:image,result:{data:{read:{game:'pokemon',name:'Pikachu'},candidates:[{name:'Pikachu',prices:[]}]}}}]}));});
  await page.goto(base);await page.locator('[data-collection-view="desk"]').click();const room=page.frameLocator('#collection-room');await room.locator('body.live-collection').waitFor();
  assert.equal(await room.locator('html').getAttribute('data-motion'),'reduced');
  await page.locator('[data-motion-choice]').selectOption('full');assert.equal(await room.locator('html').getAttribute('data-motion'),'full');
  const other=await context.newPage();await other.goto(base+'/concepts/desk.html');await other.locator('[data-motion-choice]').selectOption('reduced');
  await page.waitForFunction(()=>PokeSiftMotion.matches);assert.equal(await room.locator('html').getAttribute('data-motion'),'reduced');
  assert.equal(await page.locator('[data-motion-choice]').inputValue(),'reduced');
  await other.evaluate(()=>localStorage.removeItem('pokesift.motion.v1'));await page.waitForFunction(()=>PokeSiftMotion.preference==='full');assert.equal(await room.locator('html').getAttribute('data-motion'),'full');
  // Storage-blocked browsers still let the user change motion for this visit.
  const blocked=await browser.newContext({reducedMotion:'reduce'});await blocked.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k==='pokesift.motion.v1')throw new DOMException('Blocked','SecurityError');return get.call(this,k);};Storage.prototype.setItem=function(k,v){if(k==='pokesift.motion.v1')throw new DOMException('Blocked','QuotaExceededError');return set.call(this,k,v);};});
  const bp=await blocked.newPage();await bp.goto(base+'/concepts/desk.html');assert.equal(await bp.evaluate(()=>PokeSiftMotion.matches),false);await bp.locator('[data-motion-choice]').selectOption('reduced');assert.equal(await bp.evaluate(()=>PokeSiftMotion.matches),true);await blocked.close();
  assert.equal(providerCalls,0);assert.deepEqual(errors,[]);console.log('PASS: full motion despite OS Reduce Motion; explicit reduced/system options; fan, binder, Zoo and tilt; CSS; persistence, iframe/tab sync and blocked storage. No provider calls.');
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exit(1)});
