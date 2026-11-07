// End-to-end test: TV + host + phones against the local Firebase stand-in.
// Run from the repo root:  node tests/e2e/server.js . 8765 &  node tests/e2e/test.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8765';
const MAIN = '/3al_balcon_Game_Custom_127.html';
const MOCK_DB = fs.readFileSync(__dirname + '/mock-db.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0;
function check(name, cond, extra) { if (cond) { passes++; console.log('  ✔', name); } else { fails++; console.log('  ✘', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const dump = async () => (await fetch(BASE + '/dump')).json();
const write = (op, path, value) => fetch(BASE + '/write', { method: 'POST', body: JSON.stringify({ op, path, value }) });
async function waitFor(fn, ms = 15000, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; }
const visible = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);

async function newPage(ctx, url, { skew = 0, name } = {}) {
  const p = await ctx.newPage();
  if (skew) await p.addInitScript(s => { const n = Date.now; Date.now = () => n() + s; }, skew);
  await p.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    if (u.includes('firebase-app.js')) return route.fulfill({ contentType: 'application/javascript', body: 'export function initializeApp(){return {}}' });
    if (u.includes('firebase-database.js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK_DB });
    if (u.includes('workers.dev')) {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: /ok/i.test(body.answer || '') ? 'correct' : 'wrong' }) });
    }
    return route.abort();
  });
  p.on('pageerror', e => { fails++; console.log(`  ✘ [${name} page error]`, e.message); });
  await p.goto(BASE + url);
  return p;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext();

  console.log('\n# Setup: TV + host');
  const tv = await newPage(ctx, MAIN, { name: 'tv' });
  await sleep(2500);
  await tv.evaluate(() => {
    document.getElementById('team-a-name').textContent = 'Alpha';
    document.getElementById('team-b-name').textContent = 'Beta';
    G.questions.r3 = ['Q one', 'Q two', 'Q three', 'Q four', 'Q five'];
    G.media.r5 = [{ name: 'clip1.mp4' }, { name: 'clip2.mp4' }, { name: 'clip3.mp4' }, { name: 'clip4.mp4' }];
    G.questions.r5 = [{ v: 'clip1', q: 'What colour was the car?', a: 'Red' }, { v: 'clip2', q: 'Q2', a: 'A2' }];
    G.questions.r6 = [{ q: 'How many?', a: '10' }, { q: 'How tall?', a: '20' }];
    G.questions.r8 = ['Secret word', 'Other word'];
    startGame();
  });
  const session = await tv.evaluate(() => window._gameSession);
  await sleep(800);
  const host = await newPage(ctx, `/host.html?s=${session}&l=en`, { name: 'host', skew: -90000 }); // host clock 90s behind
  await waitFor(() => host.evaluate(() => document.getElementById('sc-na').textContent === 'Alpha'));

  // ════════════════ CATEGORY 3 ════════════════
  console.log('\n# Cat 3: host opens it, gates before phones connect');
  await host.click('.cat-btn:has-text("3.")');
  check('TV entered r3 from host (host clock 90s behind)', await waitFor(() => tv.evaluate(() => G.currentRound?.id === 'r3')));
  await host.click('#btn-next');
  check('TV on rules slide', await waitFor(() => tv.evaluate(() => G.currentQ === 0)));
  const room = await waitFor(() => tv.evaluate(() => cat3RoomId));
  await sleep(500);
  check('host Next disabled until both phones connect', await host.evaluate(() => document.getElementById('btn-next').disabled));
  await host.evaluate(() => c('next')); await sleep(500);
  check('TV ignores host Next before phones connect', await tv.evaluate(() => G.currentQ === 0));
  await tv.evaluate(() => renderSlide());
  check('re-rendering rules keeps the same room', (await tv.evaluate(() => cat3RoomId)) === room);

  console.log('\n# Cat 3: phones connect (phone B clock 7s fast)');
  const pa = await newPage(ctx, `/bid.html?t=a&r=${room}&s=${session}&l=en`, { name: 'phoneA' });
  const pb = await newPage(ctx, `/bid.html?t=b&r=${room}&s=${session}&l=en`, { name: 'phoneB', skew: 7000 });
  check('no minus button on phone', (await pa.$('#btn-minus')) === null);
  check('host Next enabled once both connected', await waitFor(() => host.evaluate(() => !document.getElementById('btn-next').disabled)));
  await host.click('#btn-next');
  check('TV on question 1', await waitFor(() => tv.evaluate(() => G.currentQ === 1)));
  await sleep(600);
  check('question hidden on phones before bidding', !(await visible(pa, '#q-box')));
  check('host Next blocked during auction', await host.evaluate(() => document.getElementById('btn-next').disabled));
  check('host Prev blocked on cat3 question', await host.evaluate(() => document.getElementById('btn-prev').disabled));
  await host.evaluate(() => c('prev')); await sleep(400);
  check('TV ignores host Prev on cat3 question', await tv.evaluate(() => G.currentQ === 1));

  console.log('\n# Cat 3: draw goes to whoever reached it first');
  await waitFor(() => host.evaluate(() => !!document.querySelector('button[onclick="c(\'startCat3\')"]')));
  await host.click('button[onclick="c(\'startCat3\')"]');
  check('phones reach bidding', await waitFor(() => pa.evaluate(() => document.getElementById('sec-bidding').classList.contains('active'))));
  await waitFor(() => pb.evaluate(() => document.getElementById('sec-bidding').classList.contains('active')));
  check('question shown on phones once bidding opens', await visible(pa, '#q-box'));
  await pa.click('#btn-plus'); await sleep(700);
  let d = (await dump()).rooms[room];
  const endAfterA = d.bidCountdownEnd;
  check('A bid 1, countdown ~10s in server time', Math.abs(endAfterA - Date.now() - 10000) < 1500, endAfterA - Date.now());
  await pb.click('#btn-plus'); await sleep(700);
  d = (await dump()).rooms[room];
  check('match does not restart countdown', d.bidCountdownEnd === endAfterA);
  const msgB = await pb.textContent('#bid-msg'), msgA = await pa.textContent('#bid-msg'), tvMsg = await tv.textContent('#bid-event-msg');
  check('phone B: matched but A got there first', /matched 1 — but they got there first/.test(msgB), msgB);
  check('phone A: still leads', /still lead/.test(msgA), msgA);
  check('TV shows draw message', /Beta (matched|عادل) 1 — Alpha/.test(tvMsg), tvMsg);
  await sleep(500);
  await pb.click('#btn-plus'); await sleep(700);
  d = (await dump()).rooms[room];
  const bLeadAt = Date.now();
  check('taking the lead restarts countdown', d.bidCountdownEnd > endAfterA && d.lastBidder === 'b');
  check('B (clock +7s) countdown still ~10s server time', Math.abs(d.bidCountdownEnd - bLeadAt - 10000) < 1500, d.bidCountdownEnd - bLeadAt);
  await pa.click('#btn-plus');
  const winRoom = await waitFor(async () => { const r = (await dump()).rooms[room]; return r.phase === 'answering' ? r : null; }, 15000);
  const elapsed = Date.now() - bLeadAt;
  check('auction closed ~10s after B took the lead', elapsed > 8500 && elapsed < 12500, elapsed);
  check('B wins the 2-2 draw', winRoom?.auctionWinner === 'b' && winRoom?.winningBid === 2);
  check('host Next still blocked while B writes', await host.evaluate(() => document.getElementById('btn-next').disabled));

  console.log('\n# Cat 3: writing — one confirm button, repeats blocked, big answers on TV');
  await waitFor(() => pb.evaluate(() => document.getElementById('sec-answering').classList.contains('active')));
  await pb.click('#btn-start');
  for (const a of ['ok paris', 'OK  Paris!', 'ok rome']) { await pb.fill('#ans-input', a); await pb.click('#btn-add'); await sleep(150); }
  check('duplicate rejected on phone', (await pb.$$eval('.ans-item', els => els.length)) === 2);
  const confirmBtns = await pb.$$eval('button', bs => bs.filter(b => /تأكيد الأجوبة|Confirm/.test(b.textContent) && b.offsetParent !== null).length);
  check('only ONE confirm button visible on phone', confirmBtns === 1, confirmBtns);
  await sleep(500);
  const fsz = await tv.evaluate(() => { const s = document.querySelector('#answers-display span:nth-child(2)'); return s ? parseFloat(getComputedStyle(s).fontSize) : 0; });
  check('TV answer text is large (≥22px for 2 answers)', fsz >= 22, fsz);
  await pb.click('#btn-confirm-sticky'); await pb.click('#btn-yes');
  check('AI judged all answers', !!(await waitFor(async () => { const r = (await dump()).rooms[room]; return (r.answers || []).every(a => a.status && a.status !== 'pending'); })));
  check('host Next enabled once settled', await waitFor(() => host.evaluate(() => !document.getElementById('btn-next').disabled)));
  await host.click('#btn-next');
  check('TV moved to question 2', await waitFor(() => tv.evaluate(() => G.currentQ === 2)));
  check('B got +4', await tv.evaluate(() => G.scoreB === 4));

  console.log('\n# Cat 3: winner phone closes mid-writing — TV locks answers itself');
  await waitFor(() => host.evaluate(() => !!document.querySelector('button[onclick="c(\'startCat3\')"]')));
  await host.click('button[onclick="c(\'startCat3\')"]');
  await waitFor(() => pa.evaluate(() => document.getElementById('sec-bidding').classList.contains('active')));
  await sleep(300);
  await pa.click('#btn-plus');
  await waitFor(async () => (await dump()).rooms[room].phase === 'answering', 15000);
  await waitFor(() => pa.evaluate(() => document.getElementById('sec-answering').classList.contains('active')));
  await pa.click('#btn-start');
  await pa.fill('#ans-input', '<img src=x onerror="window.__xss=1">'); await pa.click('#btn-add');
  await sleep(800);
  check('typed HTML not executed anywhere', !(await pa.evaluate(() => window.__xss)) && !(await tv.evaluate(() => window.__xss)) && !(await host.evaluate(() => window.__xss)));
  await pa.close();
  await write('update', `rooms/${room}`, { answerTimerEnd: Date.now() + 1500 });
  check('TV auto-confirmed after deadline', !!(await waitFor(async () => (await dump()).rooms[room].answersConfirmed === true, 10000)));
  check('host Next enabled after deadline', await waitFor(() => host.evaluate(() => !document.getElementById('btn-next').disabled), 8000));
  await pb.close();

  console.log('\n# Scores: undo reverses only what was applied');
  await tv.evaluate(() => { G.scoreA = 1; _resetScoreState(); });
  await host.evaluate(() => c('scoreTeam', { team: 'a', pts: -2 })); await sleep(500);
  check('-2 on 1 point → 0', await tv.evaluate(() => G.scoreA === 0));
  await host.evaluate(() => c('undoScoreTeam', { team: 'a' })); await sleep(500);
  check('undo → back to 1 (not 2)', await tv.evaluate(() => G.scoreA === 1));

  // ════════════════ CATEGORY 6 ════════════════
  console.log('\n# Cat 6: step-by-step, shared judging');
  await host.evaluate(() => c('menu')); await sleep(500);
  await host.click('.cat-btn:has-text("6.")');
  check('TV entered r5', await waitFor(() => tv.evaluate(() => G.currentRound?.id === 'r5')));
  await host.evaluate(() => c('next'));
  await waitFor(() => tv.evaluate(() => G.currentQ === 0));
  const room6 = await waitFor(() => tv.evaluate(() => window._cat6RoomId));
  const p6a = await newPage(ctx, `/answer.html?r=${room6}&t=a&m=text&s=${session}`, { name: 'cat6A' });
  const p6b = await newPage(ctx, `/answer.html?r=${room6}&t=b&m=text&s=${session}`, { name: 'cat6B' });
  await sleep(600);
  await host.evaluate(() => c('next'));
  check('TV on video 1', await waitFor(() => tv.evaluate(() => G.currentQ === 1)));
  await sleep(600);
  let hostTxt = await host.textContent('#dyn');
  check('host step 1: answer NOT shown before question', !hostTxt.includes('Red'), hostTxt.slice(0, 200));
  check('host Next blocked before reveal', await host.evaluate(() => document.getElementById('btn-next').disabled));
  check('no manual score panel on Cat 6 TV slide', !(await tv.$('.score-panel')));
  await host.evaluate(() => c('revealCat6Answer')); await sleep(400);
  check('reveal before question is ignored', await tv.evaluate(() => window._cat6Phase === 'video'));
  await host.click('button[onclick="c(\'videoReveal\')"]');
  check('TV shows question', await waitFor(() => tv.evaluate(() => window._cat6Phase === 'question')));
  await waitFor(() => host.evaluate(() => !!document.querySelector('button[onclick="c(\'revealCat6Answer\')"]')));
  hostTxt = await host.textContent('#dyn');
  check('host step 2: question shown, answer still hidden', hostTxt.includes('What colour') && !hostTxt.includes('Red'));
  await waitFor(() => p6a.evaluate(() => document.getElementById('input-section').style.display === 'flex'));
  await p6a.fill('#ans-input', 'red car'); await p6a.evaluate(() => submitAnswer());
  check('host sees A submitted', await waitFor(() => host.evaluate(() => /Submitted|أرسل/.test(document.getElementById('dyn').textContent))));
  await host.click('button[onclick="c(\'revealCat6Answer\')"]');
  check('TV revealed', await waitFor(() => tv.evaluate(() => window._cat6Phase === 'answer')));
  await sleep(700);
  check('B (no answer) auto wrong on TV', await tv.evaluate(() => window._cat6Judgement.b === false && /Wrong|خطأ/.test(document.getElementById('cat6-judge-b').textContent) && !document.querySelector('#cat6-judge-b button')));
  check('B phone locked after reveal', await p6b.evaluate(() => document.getElementById('submit-btn').disabled));
  check('host: B has no judge buttons', await waitFor(() => host.evaluate(() => /No answer — wrong|لا جواب — خطأ/.test(document.getElementById('dyn').textContent) && document.querySelectorAll('button[onclick^="hostJudge(\'b\'"]').length === 0)));
  check('host now shows the answer', (await host.textContent('#dyn')).includes('Red'));
  const ansW = await tv.evaluate(() => { const b = document.querySelector('#vq-answer-area .answer-box'); return [b.getBoundingClientRect().width, document.getElementById('vq-answer-area').getBoundingClientRect().width]; });
  check('yellow answer box is not screen-wide', ansW[0] < ansW[1] * 0.9, ansW);
  await host.evaluate(() => c('revealCat6Answer')); await sleep(400);
  check('second reveal does not reset judging', await tv.evaluate(() => window._cat6Judgement.b === false));
  const s0 = await tv.evaluate(() => [G.scoreA, G.scoreB]);
  await host.click('button[onclick="hostJudge(\'a\',true)"]'); await sleep(500);
  check('A judged right on host → A +3', (await tv.evaluate(() => G.scoreA)) === s0[0] + 3);
  check('TV shows the verdict, no judge buttons left for A', await tv.evaluate(() => !document.querySelector('#cat6-judge-a button[onclick^="cat6Judge"]')));
  check('TV highlights winner name (🏆, yellow)', await tv.evaluate(() => { const n = document.getElementById('cat6-name-a'); return n.textContent.includes('🏆') && n.style.color.replace(/\s/g,'') === 'rgb(255,230,0)'; }));
  check('host highlights winner too', await waitFor(() => host.evaluate(() => /🏆 Alpha/.test(document.getElementById('dyn').textContent))));
  check('host Next enabled after reveal', !(await host.evaluate(() => document.getElementById('btn-next').disabled)));
  await tv.evaluate(() => cat6UndoJudge('a')); await sleep(500);
  check('Change on TV → points reversed', (await tv.evaluate(() => G.scoreA)) === s0[0]);
  check('host shows judge buttons again for A', await waitFor(() => host.evaluate(() => !!document.querySelector('button[onclick="hostJudge(\'a\',true)"]'))));
  await tv.evaluate(() => cat6Judge('a', true)); await sleep(300);
  await tv.evaluate(() => cat6Judge('a', true)); await sleep(300);
  check('judging twice gives points once', (await tv.evaluate(() => G.scoreA)) === s0[0] + 3);
  await p6a.close(); await p6b.close();

  // ════════════════ CATEGORY 7-8 ════════════════
  console.log('\n# Cat 7: team cards with status, then answer under the name');
  await tv.evaluate(() => { G.done.delete('r6'); openRound('r6'); G.currentQ = 1; renderSlide(); });
  await sleep(500);
  const croom = await tv.evaluate(() => window._closestRoomId);
  check('cards show "waiting" for both teams', await tv.evaluate(() => /Waiting|بانتظار/.test(document.getElementById('sub-a').textContent) && /Waiting|بانتظار/.test(document.getElementById('sub-b').textContent)));
  await write('update', `closest/${croom}`, { answerA: '12', answeredAtA: Date.now() });
  check('A card says submitted', await waitFor(() => tv.evaluate(() => /submitted|إرسال/.test(document.getElementById('sub-a').textContent))));
  check('A answer still hidden until both / reveal', !(await visible(tv, '#ans-box-a')));
  await write('update', `closest/${croom}`, { answerB: '30', answeredAtB: Date.now() });
  check('answers appear inside the team cards', await waitFor(() => tv.evaluate(() => { const a = document.getElementById('ans-box-a'); return a.offsetParent !== null && a.textContent === '12' && a.closest('#closest-card-a'); })));

  // ════════════════ CATEGORY 9 ════════════════
  console.log('\n# Cat 9: QR hides on scan, timer stops on reveal');
  await tv.evaluate(() => { openRound('r8'); G.currentQ = 1; renderSlide(); });
  await sleep(400);
  check('QR visible at start', await visible(tv, '#qr-wrap'));
  const scanId = await tv.evaluate(() => window._charScanId);
  check('QR carries a scan id', !!scanId);
  const act = await newPage(ctx, `/act.html?n=Secret%20word&l=en&s=${session}&k=${scanId}`, { name: 'actor' });
  check('QR hides when the actor opens it', await waitFor(async () => !(await visible(tv, '#qr-wrap')), 5000));
  check('"show QR again" button appears', await visible(tv, '#qr-show-btn'));
  await tv.click('#qr-show-btn');
  check('QR can be shown again', await visible(tv, '#qr-wrap'));
  await tv.evaluate(() => startTimer(60)); await sleep(1200);
  await tv.evaluate(() => revealChar()); const t1 = await tv.textContent('#timer-num'); await sleep(1500);
  check('timer stops when answer revealed', (await tv.textContent('#timer-num')) === t1, [t1, await tv.textContent('#timer-num')]);
  await act.close();

  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
