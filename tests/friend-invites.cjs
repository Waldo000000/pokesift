const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokesift-friends-')),base='http://127.0.0.1:8815';
(async()=>{let browser;const server=spawn('python3',['tests/cloud_fixture.py',tmp,'8815','friend-invites'],{cwd:root,stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(n===99)throw Error(output);await new Promise(r=>setTimeout(r,100));}
  const sessions=JSON.parse(fs.readFileSync(path.join(tmp,'sessions.json'))),errors=[];let paid=0;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
  async function client(name,{signedIn=true,url=base}={}){
   const c=await browser.newContext({viewport:{width:390,height:844}});
   if(signedIn)await c.addCookies([{name:'pokesift-account',value:sessions[name],url:base,httpOnly:true,sameSite:'Strict'}]);
   await c.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedInvitation=text;}}});Object.defineProperty(navigator,'share',{value:async data=>{window.sharedInvitation=data;}});});
   await c.route('**/api/exchange-rates',r=>r.fulfill({json:{base:'AUD',date:'2026-11-01',rates:{AUD:1,USD:.5},source:'Fixture'}}));
   for(const pattern of ['**/api/identify','**/api/enrich','**/api/pikaqian-prices'])await c.route(pattern,r=>{paid++;return r.abort();});
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return {c,p};
  }
  const alice=await client('alice');await alice.p.locator('#collection-view').waitFor();
  await alice.p.evaluate(()=>{entries=[{id:'private-fixture',status:'error',message:'Private fixture',thumbnail:'',createdAt:new Date().toISOString()}];save();render();});
  await alice.p.locator('#account-button').click();await alice.p.locator('#invite-friend').waitFor();
  let creates=0;alice.p.on('request',r=>{if(r.url().endsWith('/api/cloud/invite')&&r.method()==='POST')creates++;});
  await alice.p.locator('#invite-friend').click();await alice.p.locator('#friend-invite-qr').waitFor();
  await alice.p.locator('#friend-invite-qr').evaluate(im=>im.decode());assert(await alice.p.locator('#friend-invite-qr').evaluate(im=>im.naturalWidth>0));
  await alice.p.locator('#copy-friend-link').click();const first=await alice.p.evaluate(()=>copiedInvitation);assert.match(first,new RegExp('^'+base.replaceAll('.','\\.')+'/#join='));
  await alice.p.locator('#share-friend-link').click();assert.equal(await alice.p.evaluate(()=>sharedInvitation.url),first);
  await alice.p.screenshot({path:'/tmp/pokesift-friend-invite.png'});
  const bounds=await alice.p.locator('#friend-invite-view').boundingBox();assert(bounds.x>=23&&bounds.y>=23&&bounds.y+bounds.height<=821);assert(await alice.p.locator('#new-friend-invite').isVisible());
  await alice.p.locator('#close-friend-invite').click();await alice.p.locator('#invite-friend').click();await alice.p.locator('#copy-friend-link').click();assert.equal(await alice.p.evaluate(()=>copiedInvitation),first);assert.equal(creates,1,'Opening the same QR again must not consume another invitation');
  const bob=await client('bob',{signedIn:false,url:first});await bob.p.locator('#google-sign-in').waitFor();assert.equal(new URL(bob.p.url()).hash,'');assert(await bob.p.evaluate(()=>Boolean(sessionStorage.getItem('pokesift.join'))));
  let logins=0;await bob.c.route('**/api/account/sign-in',async r=>{logins++;await bob.c.addCookies([{name:'pokesift-account',value:sessions.bob,url:base,httpOnly:true,sameSite:'Strict'}]);return r.fulfill({json:{url:base+'/'} });});
  await bob.p.locator('#google-sign-in').click();await bob.p.waitForFunction(()=>document.querySelector('#scan-remaining')?.textContent.includes('Ongoing access'));assert.equal(logins,1);assert.equal(await bob.p.locator('.card-tile').count(),0,'Invitations must not share the inviter’s collection');
  const bobInfo=await bob.p.evaluate(()=>fetch('/api/session').then(r=>r.json()));assert.equal(bobInfo.account.role,'member');assert.equal(bobInfo.account.accessLevel,'approved');assert.equal(await bob.p.evaluate(()=>sessionStorage.getItem('pokesift.join')),null);
  const carol=await client('carol',{url:first});await carol.p.waitForFunction(()=>document.querySelector('#account-status')?.textContent.includes('used'));assert(await carol.p.locator('#invite-friend').isHidden());assert.match(await carol.p.locator('#scan-remaining').textContent(),/3 trial/);
  await bob.p.locator('#invite-friend').click();await bob.p.locator('#friend-invite-qr').waitFor();await bob.p.locator('#copy-friend-link').click();const second=await bob.p.evaluate(()=>copiedInvitation);
  await carol.p.goto(second);await carol.p.waitForFunction(()=>document.querySelector('#scan-remaining')?.textContent.includes('Ongoing access'));assert(await carol.p.locator('#invite-friend').isVisible(),'An invited friend inherits ongoing access and can invite friends');assert(await carol.p.locator('#owner-tools').isHidden());
  for(let n=0;n<4;n++){await bob.p.locator('#new-friend-invite').click();await bob.p.waitForFunction(()=>document.querySelector('#friend-invite-status').textContent.startsWith('One use'));}
  await bob.p.locator('#copy-friend-link').click();const unclaimed=await bob.p.evaluate(()=>copiedInvitation);
  await bob.p.locator('#new-friend-invite').click();await bob.p.waitForFunction(()=>document.querySelector('#friend-invite-status').textContent.includes('five friend invitations'));assert(await bob.p.locator('#friend-invite-qr').isVisible(),'The last valid QR must remain usable if creating another reaches the limit');
  await alice.p.locator('#close-friend-invite').click();await alice.p.locator('#owner-tools>summary').click();await alice.p.locator('#load-admin').click();await alice.p.locator('#admin-content').getByText(/from bob@example.test.*used by carol@example.test/).waitFor();
  const section=alice.p.locator('#admin-content section').filter({hasText:'bob@example.test'});await section.getByRole('button',{name:'Remove ongoing access',exact:true}).click();await section.getByRole('button',{name:'Approve ongoing access',exact:true}).waitFor();
  const dan=await client('dan',{url:unclaimed});await dan.p.waitForFunction(()=>document.querySelector('#account-status')?.textContent.includes('no longer active'));assert.match(await dan.p.locator('#scan-remaining').textContent(),/3 trial/);
  await bob.p.locator('#close-friend-invite').click();await bob.p.evaluate(()=>PokeSiftAccount.refresh());assert(await bob.p.locator('#invite-friend').isHidden());
  assert.deepEqual(errors,[]);assert.equal(paid,0);console.log('PASS: usable QR, copy/native sharing, cached invitations, sign-in continuation, ongoing access inheritance, separate collections, single-use claims, member invite limits, owner attribution and access revocation. Zero provider calls.');
 }finally{await browser?.close();server.kill();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
