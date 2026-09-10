import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];const requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(coverage|student-voice|repair)$/.test(r.url()))requests.push(r.url());});
 await page.goto(process.env.TEST_URL||'http://localhost:3000',{waitUntil:'networkidle'});
 mkdirSync('public/screenshots',{recursive:true});await page.screenshot({path:'public/screenshots/landing.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'public/screenshots/mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Mobile page has horizontal overflow');
 await page.setViewportSize({width:1440,height:1000});await page.goto((process.env.TEST_URL||'http://localhost:3000')+'/session?demo=1');
 await page.getByLabel('YOUR EXPLANATION · IGNORE AIR RESISTANCE').waitFor();
 await page.getByRole('button',{name:'Let’s see what I taught'}).focus();await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Here’s what came through.'}).waitFor();
 await page.getByRole('button',{name:'Let’s fill in the picture'}).focus();await page.keyboard.press('Enter');
 const path=JSON.parse(readFileSync('fixtures/demo-path.json','utf8')) as {asked:{probeId:string;answer:string}[]};
 for(const [i,answer] of path.asked.entries()){
  await page.getByRole('heading',{name:'A few questions. A clearer picture.'}).waitFor();
  if(i===0)await page.screenshot({path:'public/screenshots/posterior-before.png',fullPage:true});
  await page.locator(`input[type=radio][value="${answer.answer}"]`).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'That’s my answer'}).focus();await page.keyboard.press('Enter');
  if(i===1){await page.waitForTimeout(850);await page.screenshot({path:'public/screenshots/posterior-after.png',fullPage:true});}
 }
 await page.getByRole('heading',{name:'Meet your student.'}).waitFor({timeout:50000});
 await page.screenshot({path:'public/screenshots/reveal.png',fullPage:true});
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Reveal the next answer'}).click();
 await page.getByRole('button',{name:'Let’s make the idea click'}).click();
 await page.getByRole('button',{name:'What would your student have said if you’d covered this?'}).click();
 await page.getByText('A simulated what-if:',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Use the suggested sentence'}).click();
 await page.getByRole('button',{name:'Let my student try again'}).click();
 await page.getByText('The repair sentence is now explicitly included.',{exact:false}).waitFor();
 await page.screenshot({path:'public/screenshots/repair.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'One little sentence. One big shift.'}).waitFor();
 await page.getByRole('link',{name:'Share your aha!'}).click();
 await page.getByRole('heading',{name:'I taught it. Then it clicked.'}).waitFor();
 await page.getByRole('button',{name:'Copy result link'}).click();
 if(requests.length!==3)throw new Error(`Expected exactly 3 application model-route requests; got ${requests.length}`);
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS: keyboard Teach → Coverage → Probe → Reveal → Repair → Share; session restores; no page errors or mobile horizontal overflow.');await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
