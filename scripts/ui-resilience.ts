import {chromium} from '@playwright/test';
import {prediction,selectNextProbe,config} from '../src/lib/engine';
import {newtonian as pack} from '../src/lib/packs';
import type {SessionState} from '../src/lib/session-state';
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript({content:`window.SpeechRecognition = class {
 continuous=false; interimResults=false; lang=''; onresult=null; onend=null; onerror=null;
 start(){setTimeout(()=>this.onresult && this.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'The ball uses up the upward push as it rises.'}}]}),50);}
 stop(){if(this.onend)this.onend();} abort(){if(this.onend)this.onend();}
};`});
 await page.goto((process.env.TEST_URL||'http://localhost:3000')+'/session');await page.getByRole('button',{name:'Use your voice'}).click();await page.getByLabel('YOUR EXPLANATION · IGNORE AIR RESISTANCE').filter({hasText:/.*/}).waitFor();await page.waitForTimeout(200);
 const transcript=await page.getByLabel('YOUR EXPLANATION · IGNORE AIR RESISTANCE').inputValue();if(!transcript.includes('upward push'))throw new Error('Dictation did not populate editable transcript');await page.getByRole('button',{name:'Stop recording'}).click();
 // Abort every model-route request to simulate a lost connection mid-session.
 await page.route('**/api/**',route=>route.abort('internetdisconnected'));
 await page.getByRole('button',{name:'Let’s see what I taught'}).click();await page.getByRole('heading',{name:'Here’s what came through.'}).waitFor();await page.getByRole('button',{name:'Let’s fill in the picture'}).click();
 for(let i=0;i<6;i++){
  if(await page.getByRole('heading',{name:'Meet your student.'}).isVisible())break;
  const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('viva-session-v1')!) as SessionState);const p=selectNextProbe(pack.probes,saved.posterior,saved.observations.map(o=>o.probeId),config)!;
  await page.locator(`input[type=radio][value="${prediction('used-up',p)}"]`).check();await page.getByRole('button',{name:'That’s my answer'}).click();await page.waitForTimeout(150);
 }
 await page.getByRole('heading',{name:'Meet your student.'}).waitFor();for(let i=0;i<3;i++)await page.getByRole('button',{name:'Reveal the next answer'}).click();await page.getByRole('button',{name:'Let’s make the idea click'}).click();await page.getByRole('button',{name:'Use the suggested sentence'}).click();await page.getByRole('button',{name:'Let my student try again'}).click();await page.getByRole('link',{name:'Share your aha!'}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile repair overflow');
 if(errors.length)throw new Error(errors.join('\n'));console.log('PASS: editable voice transcript; complete mobile flow with every API connection aborted; no page errors.');await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
