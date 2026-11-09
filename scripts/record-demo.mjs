#!/usr/bin/env node
/**
 * npm ci && npx playwright install chromium
 * node scripts/record-demo.mjs OUTPUT_DIR [--scene=1,2,3,4,5]
 * Builds, starts an isolated Vite preview at /cpr-pace-coach/, records Chromium,
 * then converts to silent 1920x1080, 30fps H.264. Requires ffmpeg and ffprobe.
 * Optional env: FFMPEG, FFPROBE, DEMO_PORT, DEMO_FONT_FILE (TTF/OTF).
 * All UI selectors and timing live in SCENES below. No camera or clock mocking.
 * Scene 3 waits the full two minutes, cutting out the middle (never speeding up).
 * Editorial cards are visibly labelled; detector output is never replaced.
 * scenes.json is the separate storyboard/caption source for assemble-demo.sh.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv[2];
if (!outputArg || outputArg.startsWith('--')) throw new Error('Usage: node scripts/record-demo.mjs OUTPUT_DIR [--scene=1,2,3,4,5]');
const output = path.resolve(outputArg);
const selected = (process.argv.find(a => a.startsWith('--scene='))?.split('=')[1] || '1,2,3,4,5').split(',').map(Number);
if (selected.some(n => ![1,2,3,4,5].includes(n))) throw new Error('Invalid scene number');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const port = Number(process.env.DEMO_PORT || 4178);
const origin = `http://127.0.0.1:${port}`;
const safety = 'Practice tool only. In a real emergency, call your local emergency number and follow the dispatcher.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (cmd,args,options={}) => new Promise((resolve,reject) => {
  const child=spawn(cmd,args,{cwd:root,stdio:'inherit',...options});
  child.on('error',reject); child.on('exit',code => code===0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}`)));
});
const duration = file => Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'}).trim());
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const font = process.env.DEMO_FONT_FILE ? await readFile(process.env.DEMO_FONT_FILE) : null;
const fontCSS = font ? "@font-face{font-family:DemoSans;src:url('/__demo_font__.ttf')}" : '';
const shell = `<!doctype html><html lang="en"><meta charset="utf-8"><style>
${fontCSS}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#252a31;font-family:DemoSans,'DejaVu Sans',Arial,sans-serif}
#stage{height:900px;overflow:hidden}iframe{border:0;width:1920px;height:900px;display:block}
#safety{position:fixed;top:900px;width:100%;height:76px;padding:22px 40px;text-align:center;background:#fbecef;color:#93263b;font-size:22px;line-height:32px;border-top:1px solid #e9cbd1}
#caption-rail{position:fixed;top:976px;width:100%;height:104px;background:#1b2027}
#pointer{position:fixed;left:100px;top:80px;width:30px;height:30px;border:3px solid #c9364f;border-radius:50%;background:#c9364f28;box-shadow:0 0 0 3px #fff9;transform:translate(-50%,-50%);pointer-events:none;z-index:99999}
.card{padding:70px 125px;height:900px}.brand{font-size:27px;font-weight:700;letter-spacing:-1px}.eyebrow{font-size:17px;letter-spacing:2px;color:#8c3042;margin:28px 0 20px}.card h1{font-size:60px;letter-spacing:-2px;line-height:1.13;max-width:1350px;margin:0 0 35px}.card h2{font-size:30px;margin:0 0 18px}.card p{font-size:25px;line-height:1.6;color:#59616d;margin:0 0 20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:64px}.panel{padding:30px;border:1px solid #d8dde3;border-radius:16px;background:#f8f9fa}.tag{display:inline-block;padding:10px 18px;background:#fbecef;color:#a42e44;border-radius:8px;font-size:20px}.card li{font-size:24px;line-height:1.6;margin-bottom:12px}.card a{color:#a42e44;text-decoration:underline}.card table{width:100%;border-collapse:collapse;font-size:21px}.card td{padding:15px 0;border-bottom:1px solid #d8dde3}.card td:last-child{text-align:right;color:#a42e44}.small{font-size:18px!important}.flow{display:flex;align-items:center;gap:25px;font-size:26px;margin:30px 0}.flow b{padding:22px 26px;border:1px solid #d8dde3;border-radius:12px;background:#fafafb}pre{font-size:24px;line-height:1.5;margin:0} .cta{font-size:34px;color:#a42e44;font-weight:700}
</style><div id="stage"></div><div id="safety">${safety}</div><div id="caption-rail"></div><div id="pointer"></div></html>`;
const card = (label,body) => `<section class="card"><div class="brand">CPR Pace Coach <span style="font-weight:400;color:#777;font-size:18px"> / DSH Hacks V2</span></div><div class="eyebrow">${label} · DEMO EXPLAINER / NOT APP UI</div>${body}</section>`;
const intro = card('01 / THE PRACTICE PROBLEM', `<div class="grid" style="align-items:center"><div><h1>A little practice.<br>A steadier rhythm.</h1><p>Practicing alone can make pace<br>and rhythm hard to judge.</p><p>Pace may drift.<br>Pauses may go unnoticed.</p><span class="tag">Practice on a manikin or cushion</span></div><div class="panel"><svg viewBox="0 0 650 420" role="img" aria-label="Illustrated forearms and hands above a practice cushion">
<rect x="75" y="300" width="500" height="80" rx="35" fill="#fbecef" stroke="#c9364f" stroke-width="3"/><path d="M100 340 Q325 370 550 340" fill="none" stroke="#e0b5be" stroke-width="3"/>
<g fill="#fff" stroke="#59616d" stroke-width="5" stroke-linejoin="round"><path d="M180 40h65l45 200 50 35q20 15 5 30h-75q-25-5-31-32Z"/><path d="M400 40h65l-51 225q-5 25-30 30h-75q-20-5-5-24l53-34Z"/></g>
<g fill="none" stroke="#c9364f" stroke-width="5" stroke-linecap="round"><path d="M30 135h30m20 0h5m35 0h20m350 0h15m18 0h40m25 0h20"/><path d="M325 165v60m-15-15 15 15 15-15"/></g><text x="325" y="410" text-anchor="middle" fill="#59616d" font-size="19">Illustration only · no patient · no camera</text></svg></div></div>`);
const boundaries = card('04 / EVIDENCE & SAFETY', `<h1>Useful feedback. Clear limits.</h1><div class="grid"><div><div class="panel" id="boundaries"><h2>Three practice boundaries</h2><ul><li>Practice on a cushion or manikin only.</li><li>No compression depth or recoil measurement.</li><li>No certification or clinical validation.</li></ul></div><p class="small" style="margin-top:24px">Generated motion is demonstration data, not clinical evidence.</p><p class="small">The repo includes synthetic detector tests.<br>The clinical and real-video benchmarks at right remain unmeasured.</p></div><div><div class="panel" id="evaluation"><h2>Real-world validation</h2><table><tr><td>Annotated-video pace error</td><td>Not measured</td></tr><tr><td>Annotated-video pause F1</td><td>Not measured</td></tr><tr><td>Clinical outcomes</td><td>Not measured</td></tr></table></div><div id="sources" style="margin-top:25px"><p class="small"><a href="https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support">AHA 2025 · Adult basic life support</a></p><p class="small"><a href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker">MediaPipe · Pose Landmarker documentation</a></p><p class="small"><a href="https://modelcontextprotocol.io/specification">Model Context Protocol · Specification</a></p></div></div></div>`);
const proposal = card('05 / A POSSIBLE NEXT INTERFACE', `<h1 style="font-size:49px">“Summarize my practice session.”</h1><span class="tag" id="proposed">Proposed • Not connected</span><div class="flow"><b>AI agent</b><span>→</span><b>Local MCP adapter</b><span>→</span><b>Aggregate summary</b></div><div class="grid"><div class="panel" id="schema"><pre>{
  "tool": "get_practice_summary",
  "pace_error_cpm": null,
  "pause_f1": null,
  "clinical_validation": null
}</pre></div><div><h2>Opt-in summaries only</h2><p>No video shared. Missing values stay null.</p><p class="small">Schematic proposal, separate from the repo’s existing<br><b>summarize_session</b> / <b>compare_sessions</b> local tools.<br>No agent is connected in this recording.</p><p class="small">Next: validate with consent and annotated practice clips.</p><div class="cta" id="cta">Try the synthetic demo.</div></div></div>`);

// Editing boundary: update these scene actions/selectors when the UI changes.
const SCENES = {
  1: async s => {
    await s.card(intro); const begin=s.mark();
    await s.at(begin,4); await s.point(s.page.locator('h1'));
    await s.at(begin,10); await s.point(s.page.locator('svg'));
    await s.at(begin,16); await s.point(s.page.locator('.tag'));
    await s.at(begin,20); return [[begin,20]];
  },
  2: async s => {
    const app=await s.app(); const begin=s.mark();
    await s.at(begin,3); await s.point(app.getByRole('button',{name:'Start with camera'}));
    await s.at(begin,5); await s.click(app.getByRole('button',{name:'Start with camera'}));
    await s.point(app.getByText('Allow camera access',{exact:true}));
    await s.at(begin,10); await s.click(app.getByRole('button',{name:'Back',exact:true}));
    await s.at(begin,13); await s.point(app.getByRole('button',{name:/Try demo/}));
    await s.at(begin,16); await s.click(app.getByRole('button',{name:/Try demo/}));
    await app.getByText('Simulated motion',{exact:true}).waitFor();
    await s.at(begin,19); await s.point(app.getByText('Simulated motion',{exact:true}));
    await s.at(begin,22); await s.point(app.locator('.gauge-reading'));
    await s.at(begin,25); return [[begin,25]];
  },
  3: async s => {
    const app=await s.app(); await s.click(app.getByRole('button',{name:/Try demo/}));
    await app.getByText('On target',{exact:true}).waitFor();
    const begin=s.mark();
    await s.point(app.locator('.gauge-reading'));
    await s.at(begin,7); await s.point(app.locator('.metrics > div').nth(0));
    await s.at(begin,12); await s.point(app.locator('.metrics > div').nth(1));
    await s.at(begin,17); await s.point(app.locator('.metrics > div').nth(2));
    await s.at(begin,22); await s.point(app.locator('.pose-card'));
    await s.at(begin,27);
    console.log('Scene 03: waiting for the real two-minute session to finish; middle will be cut.');
    await app.getByRole('heading',{name:'A little practice, in perspective.'}).waitFor({timeout:130000});
    await app.getByText('Completed',{exact:true}).waitFor();
    await app.getByText('02:00 recorded',{exact:true}).waitFor();
    await sleep(500);
    const result=s.mark();
    await s.page.screenshot({path:path.join(output,'scene_03_completed.png')});
    await s.point(app.locator('.result-top .badge'));
    await s.at(result,6); await s.point(app.locator('.result-metrics'));
    await s.at(result,12); await s.point(app.locator('.target-result > .badge'));
    await s.at(result,18); return [[begin,27],[result,18]];
  },
  4: async s => {
    await s.card(boundaries); const begin=s.mark();
    await s.at(begin,2); await s.point(s.page.locator('#boundaries'));
    await s.at(begin,8); await s.point(s.page.locator('#evaluation'));
    for(let i=0;i<3;i++){await s.at(begin,13+i*3); await s.point(s.page.locator('#sources a').nth(i));}
    await s.at(begin,24); await s.point(s.page.locator('#safety'));
    await s.at(begin,30); return [[begin,30]];
  },
  5: async s => {
    const app=await s.app();
    await app.getByText('For AI agents',{exact:false}).click();
    await app.locator('.agent-access').scrollIntoViewIfNeeded();
    const begin=s.mark();
    await s.point(app.locator('.agent-content'));
    await s.at(begin,6); await s.card(proposal);
    await s.at(begin,9); await s.point(s.page.locator('#proposed'));
    await s.at(begin,14); await s.point(s.page.locator('#schema'));
    await s.at(begin,24); await s.point(s.page.locator('#cta'));
    await s.at(begin,30); return [[begin,30]];
  },
};

await mkdir(output,{recursive:true});
execFileSync(ffmpeg,['-version'],{stdio:'ignore'});
execFileSync(ffprobe,['-version'],{stdio:'ignore'});
await run('npm',['run','build']);
const work=await mkdtemp(path.join(tmpdir(),'cpr-demo-'));
const server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(port),'--strictPort','--base','/cpr-pace-coach/'],{cwd:root,stdio:['ignore','pipe','pipe']});
let serverLog='',serverExited=false;
server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
server.on('exit',()=>serverExited=true);
let browser;
let checks=[];
try { checks=JSON.parse(await readFile(path.join(output,'recording-checks.json'),'utf8')).checks.filter(c=>!selected.includes(c.scene)); } catch (e) { if(e.code!=='ENOENT')throw e; }
const abort=()=>{server.kill('SIGTERM');process.exitCode=1;void browser?.close();};
process.once('SIGINT',abort);process.once('SIGTERM',abort);
try {
  let ready=false;
  for(let i=0;i<100;i++){
    if(serverExited) throw new Error(`Preview failed: ${serverLog}`);
    try{ready=(await fetch(origin+'/cpr-pace-coach/')).ok;}catch{}
    if(ready)break; await sleep(100);
  }
  if(!ready)throw new Error('Preview did not become ready');
  // Ensure that the process we launched owns the port (strictPort can exit just after a fetch).
  await sleep(300);if(serverExited)throw new Error(`Preview failed: ${serverLog}`);
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  for(const number of selected){
    console.log(`Recording scene ${String(number).padStart(2,'0')}…`);
    const errors=[],blocked=[];
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC',colorScheme:'light',permissions:[],recordVideo:{dir:work,size:{width:1920,height:1080}}});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){blocked.push(url.origin);return route.abort();}
      if(url.pathname==='/__demo_capture__')return route.fulfill({contentType:'text/html',body:shell});
      if(url.pathname==='/__demo_font__.ttf' && font)return route.fulfill({contentType:'font/ttf',body:font});
      return route.continue();
    });
    await context.addInitScript(()=>{
      // Fail closed if future scene edits accidentally request camera/microphone input.
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Capture prohibits camera and microphone');};
      window.addEventListener('mousemove',e=>{
        const pointer=window.top.document.getElementById('pointer');
        if(pointer){pointer.style.left=e.clientX+'px';pointer.style.top=e.clientY+'px';}
      });
      window.addEventListener('mousedown',()=>{const p=window.top.document.getElementById('pointer');if(p)p.style.background='#c9364f99';});
      window.addEventListener('mouseup',()=>{const p=window.top.document.getElementById('pointer');if(p)p.style.background='#c9364f28';});
    });
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/__demo_capture__');
    const mark=()=>performance.now()/1000;
    const state={page,mark,at:async(begin,sec)=>{const remaining=(begin+sec-mark())*1000;if(remaining<-750)throw new Error('Scene action overran its timing budget');if(remaining>0)await sleep(remaining);},
      card:async html=>{await page.locator('#stage').evaluate((el,html)=>el.innerHTML=html,html);await page.evaluate(()=>document.fonts.ready);await sleep(150);},
      app:async()=>{
        await page.locator('#stage').evaluate((el,src)=>el.innerHTML=`<iframe name="app" src="${src}" title="CPR Pace Coach application"></iframe>`,origin+'/cpr-pace-coach/');
        const frame=page.frameLocator('iframe'); await frame.getByRole('button',{name:/Try demo/}).waitFor();
        const appFrame=page.frame({name:'app'});
        await appFrame.addStyleTag({content:`${fontCSS} :root{font-family:DemoSans,'DejaVu Sans',Arial,sans-serif}.app{min-height:900px}.footer{display:none}.practice .gauge{max-width:420px}.practice{padding-top:20px}.welcome{padding-top:35px}.site-header{height:80px}`});
        await appFrame.evaluate(()=>document.fonts.ready); return frame;
      },
      point:async locator=>{
        const b=await locator.boundingBox();if(!b || b.y<0 || b.y+b.height>977)throw new Error('Pointer target is outside the capture safe area');
        await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:35});await sleep(450);
      },
      click:async locator=>{await state.point(locator);await page.mouse.down();await sleep(130);await page.mouse.up();},
    };
    const segments=await SCENES[number](state);
    const stem=`scene_${String(number).padStart(2,'0')}`;
    await page.screenshot({path:path.join(output,stem+'_keyframe.png')});
    const end=mark();const video=page.video();await context.close();
    const raw=await video.path(),rawDuration=duration(raw);
    // Playwright video begins before navigation. Align scene marks back from its end.
    const offset=rawDuration-end;
    const trims=segments.map(([start,length],i)=>`[0:v]trim=start=${Math.max(0,start+offset).toFixed(5)}:duration=${length},setpts=PTS-STARTPTS[v${i}]`).join(';');
    const total=segments.reduce((sum,s)=>sum+s[1],0);
    const filter=trims+';'+segments.map((_,i)=>`[v${i}]`).join('')+`concat=n=${segments.length}:v=1:a=0,fps=30,tpad=stop_mode=clone:stop_duration=1,trim=duration=${total},setsar=1[out]`;
    await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',raw,'-filter_complex',filter,'-map','[out]','-an','-c:v','libx264','-crf','18','-preset','fast','-threads','4','-pix_fmt','yuv420p','-r','30','-fps_mode','cfr','-movflags','+faststart',path.join(output,stem+'.mp4')]);
    if(errors.length || blocked.length)throw new Error(`Scene ${number}: ${JSON.stringify({errors,blocked})}`);
    checks.push({scene:number,duration_seconds:duration(path.join(output,stem+'.mp4')),errors,blocked_external_origins:blocked,segments:segments.map(([,duration])=>({duration_seconds:duration})),camera_used:false});
    await rm(raw,{force:true});
    await writeFile(path.join(output,'recording-checks.json'),JSON.stringify({capture:'Playwright Chromium; real-time synthetic demo; no clock acceleration; editorial cards labelled separately',checks},null,2));
  }
} finally {
  await browser?.close();server.kill('SIGTERM');await rm(work,{recursive:true,force:true});
}
console.log('Recording complete. Use assemble-demo.sh with scenes.json to add captions.');
