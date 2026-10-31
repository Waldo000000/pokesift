// Follow the same drawers/disclosures a person uses to reach secondary tools.
async function openTools(page,{repairs=false}={}){
  if(!await page.locator('#workspace-tools').evaluate(el=>el.open))await page.locator('#workspace-tools-toggle').click();
  if(repairs&&!await page.locator('#workspace-repairs').evaluate(el=>el.open))await page.locator('#workspace-repairs>summary').click();
}
async function closeTools(page){if(await page.locator('#workspace-tools').evaluate(el=>el.open))await page.locator('#close-workspace-tools').click();}
async function reveal(page,selector){
  const target=page.locator(selector).first();
  if(await target.evaluate(el=>Boolean(el.closest('#workspace-tools'))))await openTools(page);
  for(let n=0;n<8;n++){
    const handle=await target.evaluateHandle(el=>{let closed=null;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)closed=p;return closed?.querySelector(':scope>summary')||null;});
    const summary=handle.asElement();if(!summary){await handle.dispose();break;}await summary.click();await handle.dispose();
  }
}
async function roomOptions(frame){if(!await frame.locator('#room-options').evaluate(el=>el.open))await frame.locator('#room-options-toggle').click();}
async function closeRoomOptions(frame){if(await frame.locator('#room-options').evaluate(el=>el.open))await frame.locator('#close-room-options').click();}
module.exports={openTools,closeTools,reveal,roomOptions,closeRoomOptions};
