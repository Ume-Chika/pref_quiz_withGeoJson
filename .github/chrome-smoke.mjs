import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const base = "/pref_quiz_withGeoJson/";
const factsByCode = Object.fromEntries(JSON.parse(readFileSync("static/data/prefecture_facts.json", "utf8")).prefectures.map((item) => [item.code, item]));
const namesByCode = Object.fromEntries(Object.entries(factsByCode).map(([code, item]) => [code, item.name]));
const locationTypes = ["locate", "locateJapan", "mapMemory", "shapeLocate", "capitalLocate", "dishLocate"];
const nationwideLocationTypes = ["locateJapan", "shapeLocate", "capitalLocate", "dishLocate"];
const mime = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (!pathname.startsWith(base)) return send(response, 404, "Not found");
  const relative = decodeURIComponent(pathname.slice(base.length)) || "index.html";
  const file = resolve(root, normalize(relative));
  if (!file.startsWith(`${root}/`)) return send(response, 403, "Forbidden");
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
    response.end(readFileSync(file));
  } catch {
    send(response, 404, "Not found");
  }
});

function send(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

async function main() {
await new Promise((resolveListen) => server.listen(4173, "127.0.0.1", resolveListen));
const profile = mkdtempSync(join(tmpdir(), "pref-quiz-chrome-"));
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--window-size=390,844",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let cdp;
try {
  const browserSocket = await devToolsSocket(chrome, 30_000);
  const debugPort = new URL(browserSocket).port;
  const target = await retry(async () => {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    return targets.find((item) => item.type === "page");
  }, 30_000);
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.command("Runtime.enable");
  await cdp.command("Page.enable");
  await cdp.command("Network.enable");

  const errors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  cdp.on("Log.entryAdded", ({ entry }) => entry.level === "error" && !/net::ERR_BLOCKED_BY_CLIENT/.test(entry.text) && errors.push(entry.text));
  await cdp.command("Log.enable");
  await cdp.command("Page.navigate", { url: `http://127.0.0.1:4173${base}` });

  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await waitFor(cdp, `document.activeElement === document.querySelector('#app')`);
  assert(await evaluate(cdp, `getComputedStyle(document.querySelector('#app')).outlineStyle === 'none'`), "初期表示でアプリ本体に不要なフォーカス枠が出ています");
  assert(await evaluate(cdp, `document.querySelectorAll('#hero-map path').length === 47`), "ホーム地図が47都道府県ではありません");
  assert(await evaluate(cdp, `document.documentElement.scrollWidth <= document.documentElement.clientWidth`), "スマートフォン幅で横スクロールが発生しています");
  assert(await evaluate(cdp, `[...document.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => button.getBoundingClientRect().height >= 44)`), "操作ボタンが44px未満です");
  assert(await evaluate(cdp, `!document.querySelector('#sound-setting').checked`), "効果音の初期値がOFFではありません");
  assert(await evaluate(cdp, `document.querySelector('#volume-setting').disabled && document.querySelector('#volume-setting').value === '0.5'`), "音量の初期値が不正です");
  assert(await evaluate(cdp, `fetch('./sources.html').then(r => r.ok)`), "出典ページを取得できません");
  await evaluate(cdp, `document.querySelector('#progress-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#progress-dialog').open`);
  assert(await evaluate(cdp, `(() => { const text=[...document.querySelectorAll('#skill-progress .skill-name')].map(item=>item.textContent); return text.some(value=>value.includes('基本3県で解放')) && text.some(value=>value.includes('基本8県で解放')) && text.some(value=>value.includes('基本15県で解放')); })()`), "学習記録にC・D・Eの解放条件を表示できません");
  await evaluate(cdp, `document.querySelector('#progress-dialog .close-button').click(); true`);

  await cdp.command("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  for (const scenario of [{ type: "silhouetteReverse", skill: "A", code: "01" }, { type: "mapChoice", skill: "B", code: "01" }, { type: "capitalRegion", skill: "D", code: "01" }, { type: "locateJapan", skill: "B", code: "01" }]) {
    await evaluate(cdp, `globalThis.__prefQuizTest=${JSON.stringify(scenario)}; document.querySelector('#start-endless-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && (document.querySelectorAll('input[name="answer"]').length === 4 || document.querySelectorAll('.map-prefecture.clickable').length === 47)`);
    const desktopLayout = await evaluate(cdp, `(() => { const items=[document.querySelector('#visual-stage'),...document.querySelectorAll('.answer-option label'),document.querySelector('#submit-answer-button'),document.querySelector('#keyboard-hint')].filter(item=>item.getClientRects().length); return {height:innerHeight,items:items.map(item=>{const rect=item.getBoundingClientRect();return {id:item.id||item.tagName,top:Math.round(rect.top),height:Math.round(rect.height),bottom:Math.round(rect.bottom)}}),stageMinHeight:getComputedStyle(document.querySelector('#visual-stage')).minHeight,hint:getComputedStyle(document.querySelector('#keyboard-hint')).display}; })()`);
    assert(desktopLayout.items.every((item) => item.bottom <= desktopLayout.height) && desktopLayout.hint !== "none", `PCの短い画面で${scenario.type}が収まりません: ${JSON.stringify(desktopLayout)}`);
    await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);
  }
  await evaluate(cdp, `delete globalThis.__prefQuizTest; true`);
  await cdp.command("Emulation.clearDeviceMetricsOverride");

  await cdp.command("Network.setBlockedURLs", { urls: ["*prefecture_facts.json"] });
  await evaluate(cdp, `location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#error-screen:not([hidden])')`, 10_000);
  assert(await evaluate(cdp, `!document.querySelector('#retry-button').disabled`), "読込失敗後に再試行できません");
  await cdp.command("Network.setBlockedURLs", { urls: [] });
  await evaluate(cdp, `document.querySelector('#retry-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress:{},highScore:0,recent:Array.from({length:4},(_,index)=>({code:String(index+1).padStart(2,'0'),skill:'A',type:'silhouette',correct:true,timedOut:false,newItem:true,at:index}))})); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#start-ten-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelectorAll('input[name="answer"]').length===4`);
  assert(await evaluate(cdp, `['A','B'].includes(document.querySelector('#game-screen').dataset.skill)`), "履歴と進捗が不整合な保存値から問題を開始できません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);
  await evaluate(cdp, `localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress:{'01:C':{attempts:1,correct:1,streak:1,lastSeen:1,averageMs:5000,timeouts:0,nextDue:1,mastery:.6,recent:[1]}},highScore:0,recent:[]})); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])')`);
  const migratedUnlock = await evaluate(cdp, `({skill:document.querySelector('#game-screen').dataset.skill,unlockedBasic:JSON.parse(localStorage.getItem('prefecture-minigame-v2')).unlockedBasic,type:document.querySelector('#game-screen').dataset.quizType})`);
  assert(migratedUnlock.skill === "C" && migratedUnlock.unlockedBasic >= 3, `既存分野の解放移行が不正です: ${JSON.stringify(migratedUnlock)}`);
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);
  await evaluate(cdp, `(() => { const progress={}; const learned={attempts:1,correct:1,streak:1,lastSeen:1,averageMs:5000,timeouts:0,nextDue:Date.now()+864e5,mastery:.8,recent:[1]}; for(let number=1;number<=15;number++){const code=String(number).padStart(2,'0'); progress[code+':A']={...learned}; progress[code+':B']={...learned};} localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress,highScore:0,recent:[]})); location.reload(); return true; })()`);
  await waitFor(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2')).unlockedBasic===15`, 10_000);
  await evaluate(cdp, `(() => { const state=JSON.parse(localStorage.getItem('prefecture-minigame-v2')); state.progress={}; localStorage.setItem('prefecture-minigame-v2',JSON.stringify(state)); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#progress-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#progress-dialog').open`);
  assert(await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2')).unlockedBasic===15 && [...document.querySelectorAll('#skill-progress .skill-row')].slice(2).every(row=>row.querySelector('.skill-name span:last-child').textContent==='0問')`), "解放後に基本習熟が下がるとC・D・Eが再ロックされます");
  await evaluate(cdp, `document.querySelector('#progress-dialog .close-button').click(); true`);
  await evaluate(cdp, `localStorage.setItem('prefecture-minigame-v2', JSON.stringify({schema:2,settings:{sound:false,answerMode:'broken'},progress:{'01:A':{attempts:'bad',correct:99,mastery:4,recent:null}},highScore:'bad',recent:null})); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `globalThis.__nativeRandom=Math.random; Math.random=()=>0; document.querySelector('#start-ten-button').click()`);

  for (let question = 1; question <= 10; question++) {
    try {
      await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelectorAll('input[name="answer"]').length === 4`);
    } catch (error) {
      const state = await evaluate(cdp, `({gameHidden:document.querySelector('#game-screen').hidden,homeHidden:document.querySelector('#home-screen').hidden,errorHidden:document.querySelector('#error-screen').hidden,type:document.querySelector('#game-screen').dataset.quizType,inputs:document.querySelectorAll('input[name="answer"]').length,title:document.querySelector('#question-title').textContent,error:document.querySelector('#error-message').textContent})`);
      throw new Error(`問題${question}の表示待ちに失敗: ${JSON.stringify(state)} / ${errors.join(" / ")} / ${error.message}`);
    }
    assert(await evaluate(cdp, `document.querySelector('#question-number').textContent === '${question}/10'`), `問題番号${question}が不正です`);
    await waitFor(cdp, `document.querySelector('#timer-text').textContent !== '記憶中'`, 4_000);
    const code = await evaluate(cdp, `document.querySelector('#game-screen').dataset.code`);
    await evaluate(cdp, `(() => { const type=document.querySelector('#game-screen').dataset.quizType; if(${JSON.stringify(locationTypes)}.includes(type)){ document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); } else { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value===${JSON.stringify(namesByCode[code])}); input.checked=true; input.dispatchEvent(new Event('change')); } document.querySelector('#submit-answer-button').click(); return true; })()`);
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'CORRECT'`), `問題${question}を正答として判定できません`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-detail').textContent.length > 5`), "解説が空です");
    await evaluate(cdp, `document.querySelector('#next-question-button').click()`);
  }

  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  const resultSummary = await evaluate(cdp, `({score:Number(document.querySelector('#result-score').textContent),correct:document.querySelector('#result-correct').textContent,rate:document.querySelector('#result-rate').textContent,combo:document.querySelector('#result-combo').textContent,timeouts:document.querySelector('#result-timeouts').textContent,review:document.querySelector('#result-review').textContent,record:!document.querySelector('#result-record').hidden})`);
  assert(resultSummary.score > 0 && resultSummary.correct === "10/10" && resultSummary.rate === "100%" && resultSummary.combo === "10" && resultSummary.timeouts === "0" && resultSummary.review.length > 5 && resultSummary.record, "10問結果画面の集計またはハイスコア表示が不正です");
  await evaluate(cdp, `Math.random=globalThis.__nativeRandom; delete globalThis.__nativeRandom; true`);
  const state = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(state.schema === 2, "保存スキーマが不正です");
  assert(state.settings.sound === false && state.settings.volume === .5 && state.settings.answerMode === "confirm", "壊れた設定値を復旧できません");
  assert(Object.values(state.progress).reduce((sum, item) => sum + item.attempts, 0) === 10, "10問分の学習履歴を保存できません");
  assert(Object.values(state.progress).reduce((sum, item) => sum + item.correct, 0) === 10, "10問分の正答を記録できません");
  assert(Object.values(state.progress).filter((item) => item.attempts > 0).length === 4, "10問で新規項目がちょうど4件に制限されていません");
  assert(state.recent.slice(0, 10).filter((item) => item.newItem).length === 4, "新規項目の履歴を保存できません");
  assert(Object.values(state.progress).every((item) => Number.isFinite(item.mastery)), "習熟度に不正値があります");
  assert(state.highScore === resultSummary.score, "10問のハイスコアを保存できません");

  await evaluate(cdp, `(() => { const state=JSON.parse(localStorage.getItem('prefecture-minigame-v2')); state.settings.answerMode='instant'; localStorage.setItem('prefecture-minigame-v2',JSON.stringify(state)); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  const reloadedState = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(Object.values(reloadedState.progress).reduce((sum, item) => sum + item.attempts, 0) === 10 && reloadedState.recent.length === 10 && reloadedState.highScore === resultSummary.score && Number(await evaluate(cdp, `document.querySelector('#high-score').textContent`)) === resultSummary.score, "再読込後に学習履歴またはハイスコアを保持できません");
  await evaluate(cdp, `globalThis.__prefQuizTest={type:'mapMemory',skill:'B',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#quiz-type').textContent === '地図記憶'`);
  assert(await evaluate(cdp, `document.querySelector('#timer-text').textContent === '記憶中' && document.querySelector('#submit-answer-button').hidden`), "地図記憶の待機表示または即時回答設定が不正です");
  assert(await evaluate(cdp, `document.querySelectorAll('.map-prefecture[data-code]').length > 1`), "場所問題の地図が一択になっています");
  await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
  await evaluate(cdp, `document.querySelector('.map-prefecture[data-code]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  await evaluate(cdp, `document.querySelector('#quit-game-button').click()`);
  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  await evaluate(cdp, `delete globalThis.__prefQuizTest; document.querySelector('#result-home-button').click(); document.querySelector('#settings-button').click(); document.querySelector('#reset-data-button').click(); document.querySelector('#confirm-reset-button').click(); true`);
  await waitFor(cdp, `!document.querySelector('#settings-dialog').open`);
  const resetState = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(Object.keys(resetState.progress).length === 0 && resetState.recent.length === 0 && resetState.highScore === 0 && resetState.unlockedBasic === 0 && resetState.settings.sound === false && resetState.settings.volume === .5 && resetState.settings.answerMode === "confirm", "全消去で初期状態へ戻りません");
  await evaluate(cdp, `document.querySelector('#study-map-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#study-map-dialog').open`);
  assert(await evaluate(cdp, `document.querySelectorAll('#study-map-canvas .recent-correct, #study-map-canvas .recent-incorrect').length===0 && document.querySelector('#study-map-status').textContent.includes('未出題')`), "全消去後の白地図が中立状態ではありません");
  await evaluate(cdp, `document.querySelector('#study-map-dialog .close-button').click(); true`);

  await evaluate(cdp, `(() => { const state={schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress:{},highScore:0,recent:[{code:'01',skill:'A',type:'silhouette',correct:false,timedOut:false,at:4},{code:'02',skill:'B',type:'map',correct:true,timedOut:false,at:3},{code:'01',skill:'B',type:'map',correct:true,timedOut:false,at:2},{code:'13',skill:'A',type:'silhouette',correct:false,timedOut:true,at:1}]}; localStorage.setItem('prefecture-minigame-v2',JSON.stringify(state)); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#study-map-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#study-map-dialog').open`);
  assert(await evaluate(cdp, `(() => { const map=document.querySelector('#study-map-canvas'); const path=code=>map.querySelector('.map-prefecture[data-code="'+code+'"]'); return map.querySelectorAll('.map-prefecture[data-code]').length===47 && path('01').classList.contains('recent-incorrect') && !path('01').classList.contains('recent-correct') && path('02').classList.contains('recent-correct') && path('13').classList.contains('recent-incorrect') && !path('03').classList.contains('recent-correct') && !path('03').classList.contains('recent-incorrect'); })()`), "白地図の直近10問・最新回答優先の色分けが不正です");
  assert(await evaluate(cdp, `(() => { const path=document.querySelector('#study-map-canvas .map-prefecture[data-code="02"]'); path.dispatchEvent(new PointerEvent('pointerover',{bubbles:true})); path.dispatchEvent(new MouseEvent('click',{bubbles:true})); return document.querySelector('#study-map-name').textContent==='青森県' && document.querySelector('#study-map-status').textContent.includes('正解') && document.querySelector('#study-map-region').textContent===${JSON.stringify(factsByCode["02"].region)} && document.querySelector('#study-map-capital').textContent===${JSON.stringify(factsByCode["02"].capital)} && document.querySelector('#study-map-dish').textContent===${JSON.stringify(factsByCode["02"].dish)} && document.querySelector('#study-map-history').textContent.includes('2問前・位置') && path.classList.contains('selected') && path.getAttribute('aria-current')==='true'; })()`), "白地図のホバー・タップ・県詳細・選択表示が不正です");
  await clickCenter(cdp, '#study-map-canvas .map-prefecture[data-code="01"]');
  assert(await evaluate(cdp, `document.querySelector('#study-map-name').textContent==='北海道' && document.querySelector('#study-map-canvas .map-prefecture[data-code="01"]').classList.contains('selected')`), "白地図を実ポインタで選択できません");
  assert(await evaluate(cdp, `(() => { const svg=document.querySelector('#study-map-canvas svg'); const tokyo=svg.querySelector('.map-prefecture[data-code="13"]'); const point=new DOMPoint(Number(tokyo.dataset.centerX),Number(tokyo.dataset.centerY)).matrixTransform(svg.getScreenCTM()); svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y})); const blankSelected=document.querySelector('#study-map-name').textContent==='東京都' && tokyo.classList.contains('selected') && tokyo.getAttribute('aria-label').includes('時間切れ'); tokyo.focus(); tokyo.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); const moved=document.activeElement!==tokyo; document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return blankSelected && moved && document.activeElement.getAttribute('aria-current')==='true' && document.activeElement.getAttribute('aria-label').startsWith(document.querySelector('#study-map-name').textContent); })()`), "白地図の余白タップ・矢印・Enter・文字状態が不正です");
  await evaluate(cdp, `document.querySelector('#study-map-dialog .close-button').click(); localStorage.removeItem('prefecture-minigame-v2'); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);

  const modes = [
    ["shapeMemory", "A", "01", "北海道"],
    ["silhouette", "A", "47", "沖縄県"], ["reveal", "A", "01", "北海道"], ["spotlight", "A", "01", "北海道"],
    ["flash", "A", "01", "北海道"], ["silhouetteReverse", "A", "01", "北海道"], ["mapShape", "A", "01", "北海道"],
    ["map", "B", "01", "北海道"], ["locate", "B", "01", "北海道"], ["locateJapan", "B", "01", "北海道"],
    ["mapChoice", "B", "01", "北海道"], ["mapMemory", "B", "01", "北海道"], ["mapFlash", "B", "01", "北海道"], ["compass", "B", "01", "北東"], ["shapeLocate", "B", "01", "北海道"],
    ["capital", "C", "01", "札幌市"], ["capitalReverse", "C", "01", "北海道"], ["capitalMap", "C", "01", "札幌市"], ["capitalShape", "C", "01", "札幌市"], ["capitalLocate", "C", "01", "北海道"],
    ["region", "D", "02", "東北地方"], ["regionMember", "D", "02", "青森県"], ["regionMap", "D", "02", "東北地方"], ["shapeRegion", "D", "02", "東北地方"], ["capitalRegion", "D", "01", "北海道地方"],
    ["dish", "E", "01", "北海道"], ["dishReverse", "E", "01", "ジンギスカン"], ["dishMap", "E", "01", "ジンギスカン"], ["dishShapeChoice", "E", "01", "北海道"], ["dishLocate", "E", "01", "北海道"],
  ];
  for (const [type, skill, code, correct] of modes) {
    await evaluate(cdp, `globalThis.__prefQuizTest=${JSON.stringify({ type, skill, code })}; document.querySelector('#start-endless-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelector('#game-screen').dataset.quizType === '${type}'`);
    assert(await evaluate(cdp, `document.querySelectorAll('input[name="answer"]').length === 4 && new Set([...document.querySelectorAll('input[name="answer"]')].map(input => input.value)).size === 4`), `${type}: 4つの一意な選択肢がありません`);
    assert(await evaluate(cdp, `document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll('.answer-option label')].filter(label => label.getClientRects().length).every(label => label.getBoundingClientRect().height >= 44) && getComputedStyle(document.querySelector('#keyboard-hint')).display !== 'none'`), `${type}: スマートフォン表示、タップ領域、キー案内のいずれかが不正です`);
    if (type === "shapeMemory") assert(await evaluate(cdp, `document.querySelector('#timer-text').textContent==='記憶中' && document.querySelector('#answer-fieldset').hidden && document.querySelector('#visual-stage .silhouette') && document.querySelector('#visual-stage').textContent.includes('北海道')`), "初見の形と県名を同時に提示できません");
    if (type === "silhouette") assert(await evaluate(cdp, `(() => { const path=document.querySelector('#visual-stage .silhouette'); const box=path.getBBox(); return (path.getAttribute('d').match(/M/g)||[]).length>1 && box.x>=0 && box.y>=0 && box.x+box.width<=650 && box.y+box.height<=410 && box.width>150 && box.height>100; })()`), "離島を含む県のシルエットが表示範囲に収まっていません");
    if (type === "reveal") assert(await evaluate(cdp, `(() => { const circle=document.querySelector('#visual-stage #reveal-mask circle'); const animation=circle?.querySelector('animate[attributeName="r"]'); const x=Number(circle?.getAttribute('cx')); const y=Number(circle?.getAttribute('cy')); return circle && animation?.getAttribute('dur')==='12s' && Number(animation.getAttribute('to'))>0 && Number.isFinite(x) && Number.isFinite(y) && x>=0 && x<=650 && y>=0 && y<=410 && Math.hypot(x-325,y-205)>20; })()`), "じわじわ表示のランダム開始点または表示速度が不正です");
    if (type === "silhouetteReverse") assert(await evaluate(cdp, `document.querySelectorAll('.shape-option svg').length === 4`), "逆シルエットの形が4つありません");
    if (type === "mapShape") assert(await evaluate(cdp, `document.querySelectorAll('.shape-option svg').length === 4 && document.querySelectorAll('#visual-stage .target').length === 1`), "地図から選ぶ4つの形または対象位置がありません");
    if (type === "mapChoice") assert(await evaluate(cdp, `(() => { const maps=[...document.querySelectorAll('.map-option svg')]; const codes=maps.map(map=>map.querySelector('.target').dataset.mapCode); const basePaths=maps.map(map=>map.querySelector('.map-prefecture').getAttribute('d')); return maps.length===4 && new Set(codes).size===4 && codes.includes('${code}') && new Set(basePaths).size===1; })()`), "地図選択の4地図が同一縮尺でないか、正解県がありません");
    if (type === "shapeLocate") assert(await evaluate(cdp, `document.querySelector('.shape-location-preview .silhouette') && !document.querySelector('#visual-stage > svg').getAttribute('aria-label').includes('${namesByCode[code]}')`), "形→地図の記憶表示または答えの非露出が不正です");
    if (type === "regionMap") assert(await evaluate(cdp, `document.querySelectorAll('#visual-stage .map-prefecture.target').length === 6`), "東北地方の6県が強調されていません");
    if (type === "shapeRegion") assert(await evaluate(cdp, `(() => { const area=[document.querySelector('#question-title'),document.querySelector('#question-help'),document.querySelector('#visual-stage')]; const exposed=area.map(node=>node.textContent+[...node.querySelectorAll('[aria-label]')].map(item=>item.getAttribute('aria-label')).join('')).join(''); return document.querySelector('#visual-stage .silhouette') && !['青森県','東北地方'].some(value=>exposed.includes(value)); })()`), "形→地方が答えを露出しています");
    if (type === "capitalShape") assert(await evaluate(cdp, `(() => { const area=[document.querySelector('#question-title'),document.querySelector('#question-help'),document.querySelector('#visual-stage')]; const exposed=area.map(node=>node.textContent+[...node.querySelectorAll('[aria-label]')].map(item=>item.getAttribute('aria-label')).join('')).join(''); return document.querySelector('#visual-stage .silhouette') && !['北海道','札幌市'].some(value=>exposed.includes(value)); })()`), "形付き県庁所在地が答えを露出しています");
    if (type === "dishMap") assert(await evaluate(cdp, `(() => { const area=[document.querySelector('#question-title'),document.querySelector('#question-help'),document.querySelector('#visual-stage')]; const exposed=area.map(node=>node.textContent+[...node.querySelectorAll('[aria-label]')].map(item=>item.getAttribute('aria-label')).join('')).join(''); return document.querySelectorAll('#visual-stage .target[data-map-code="${code}"]').length===1 && !['北海道','ジンギスカン'].some(value=>exposed.includes(value)); })()`), "地図付き郷土料理の手がかりまたは答え露出が不正です");
    if (type === "dishShapeChoice") assert(await evaluate(cdp, `document.querySelectorAll('.shape-option svg').length === 4 && ![document.querySelector('#question-title').textContent,document.querySelector('#question-help').textContent,document.querySelector('#visual-stage').textContent].some(value=>value.includes('北海道'))`), "郷土料理→形の4択または答えの非露出が不正です");
    if (["capitalLocate", "dishLocate"].includes(type)) assert(await evaluate(cdp, `(() => { const svg=document.querySelector('#visual-stage svg'); return ![document.querySelector('#question-title').textContent,document.querySelector('#question-help').textContent,svg.getAttribute('aria-label')].some(value=>value.includes('${namesByCode[code]}')); })()`), `${type}: 正解県名が問題文または地図名に露出しています`);
    if (locationTypes.includes(type)) {
      const expectedPaths = nationwideLocationTypes.includes(type) ? 47 : 7;
      assert(await evaluate(cdp, `document.querySelectorAll('.map-prefecture[data-code]').length === ${expectedPaths}`), `${type}: 地図の選択肢数が不正です`);
      if (nationwideLocationTypes.includes(type) && type !== "shapeLocate") assert(await evaluate(cdp, `(() => { const svg=document.querySelector('#visual-stage svg'); const tokyo=svg.querySelector('[data-code="13"]'); const point=new DOMPoint(Number(tokyo.dataset.centerX),Number(tokyo.dataset.centerY)).matrixTransform(svg.getScreenCTM()); svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y})); return svg.querySelector('[data-code="13"]').classList.contains('selected') && !document.querySelector('#submit-answer-button').disabled; })()`), `${type}: 全国地図の余白タップで東京都本土を選べません`);
    }
    if (["shapeMemory", "flash", "mapFlash", "mapMemory", "shapeLocate"].includes(type)) {
      assert(await evaluate(cdp, `(() => { document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true})); return !document.querySelector('input[name="answer"]:checked') && !document.querySelector('#feedback-dialog').open; })()`), `${type}: 記憶中にキー回答できてしまいます`);
      await waitFor(cdp, `document.querySelector('#timer-text').textContent !== '記憶中'`, 4_000);
      if (type === "shapeMemory") assert(await evaluate(cdp, `!document.querySelector('#answer-fieldset').hidden && !document.querySelector('#visual-stage').textContent.includes('北海道')`), "形の見本終了後も正解県名が見えています");
      if (type === "shapeLocate") assert(await evaluate(cdp, `(() => { const svg=document.querySelector('#visual-stage svg'); const tokyo=svg.querySelector('[data-code="13"]'); const point=new DOMPoint(Number(tokyo.dataset.centerX),Number(tokyo.dataset.centerY)).matrixTransform(svg.getScreenCTM()); svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y})); return tokyo.classList.contains('selected') && !document.querySelector('#submit-answer-button').disabled; })()`), "shapeLocate: 記憶後に全国地図をタップできません");
    }
    if (locationTypes.includes(type)) {
      if (type === "locate") {
        assert(await evaluate(cdp, `(() => { const paths=[...document.querySelectorAll('.map-prefecture[data-code]')]; paths[0].focus(); paths[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); const moved=document.activeElement!==paths[0]; document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return moved && !document.querySelector('#submit-answer-button').disabled; })()`), "地図を方角どおりの矢印・Enterで選択できません");
        await evaluate(cdp, `document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#submit-answer-button').click(); true`);
      } else if (type === "locateJapan") {
        await clickCenter(cdp, `#visual-stage .map-prefecture[data-code="${code}"]`);
        assert(await evaluate(cdp, `document.querySelector('#visual-stage .map-prefecture[data-code="${code}"]').classList.contains('selected')`), "全国地図を実ポインタで選択できません");
        await evaluate(cdp, `document.querySelector('#submit-answer-button').click(); true`);
      } else {
        await evaluate(cdp, `document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#submit-answer-button').click(); true`);
      }
    } else {
      await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item => item.value === ${JSON.stringify(correct)}); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
    }
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'CORRECT' && document.querySelector('#feedback-detail').textContent.length > 5`), `${type}: 正答または解説が不正です`);
    assert(await evaluate(cdp, `(() => { const card=document.querySelector('#feedback-comparison .correct-answer[data-code="${code}"]'); return document.querySelectorAll('#feedback-comparison .feedback-shape-card').length===1 && card?.querySelectorAll('.map-prefecture').length===47 && card.querySelector('.map-prefecture.target[data-map-code="${code}"]'); })()`), `${type}: 正解県の形と周辺位置を1枚で再確認できません`);
    if (type === "shapeMemory") assert(await evaluate(cdp, `(() => { const paths=[...document.querySelectorAll('#feedback-comparison .feedback-map .map-prefecture')]; return paths.filter(path=>{const box=path.getBBox();return box.x<650&&box.x+box.width>0&&box.y<410&&box.y+box.height>0;}).length>1; })()`), "正解県と同じ拡大率で周辺県の輪郭を表示できません");
    await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
    await evaluate(cdp, `document.querySelector('#result-home-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);
  }
  await evaluate(cdp, `delete globalThis.__prefQuizTest; true`);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'shapeMemory',skill:'A',code:'03'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#timer-text').textContent !== '記憶中'`, 4_000);
  await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value==='岩手県'); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  assert(await evaluate(cdp, `(() => { const item=JSON.parse(localStorage.getItem('prefecture-minigame-v2')).progress['03:A']; return item.streak===0 && item.mastery>0 && item.mastery<.1; })()`), "見本付き正解を弱い学習証拠として記録できません");
  for (const code of ["04", "05", "06"]) {
    await evaluate(cdp, `globalThis.__prefQuizTest={type:'silhouette',skill:'A',code:'${code}'}; document.querySelector('#next-question-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#game-screen').dataset.code==='${code}' && !document.querySelector('#feedback-dialog').open`);
    await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value===${JSON.stringify(namesByCode[code])}); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  }
  await evaluate(cdp, `delete globalThis.__prefQuizTest; document.querySelector('#next-question-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen').dataset.code==='03' && document.querySelector('#game-screen').dataset.quizType==='silhouette' && !document.querySelector('#feedback-dialog').open`);
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  await evaluate(cdp, `document.querySelector('#result-home-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);

  await evaluate(cdp, `(() => { const progress={}; const practiced={attempts:1,correct:1,streak:1,lastSeen:1,averageMs:5000,timeouts:0,nextDue:Date.now()+864e5,mastery:.1,recent:[1]}; for(let number=1;number<=47;number++) progress[String(number).padStart(2,'0')+':A']={...practiced}; localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress,highScore:0,recent:[]})); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])')`);
  assert(await evaluate(cdp, `(() => { const game=document.querySelector('#game-screen'); return game.dataset.skill==='B' && game.dataset.quizType==='map' && document.querySelectorAll('#visual-stage .target').length===1 && !document.querySelector('#question-title').textContent.includes('北海道'); })()`), "未学習の位置問題が正解県名を露出しています");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); localStorage.removeItem('prefecture-minigame-v2'); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'locate',skill:'B',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelector('#game-screen').dataset.quizType === 'locate'`);
  await evaluate(cdp, `document.querySelector('.map-prefecture[data-code="02"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#submit-answer-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  assert(await evaluate(cdp, `(() => { const cards=[...document.querySelectorAll('#feedback-comparison .feedback-shape-card')]; const recent=JSON.parse(localStorage.getItem('prefecture-minigame-v2')).recent[0]; return document.querySelector('#feedback-kicker').textContent==='MISS' && cards.length===2 && cards[0].dataset.code==='02' && cards[1].dataset.code==='01' && cards.every(card=>card.querySelectorAll('.map-prefecture').length===47&&card.querySelector('.map-prefecture.target[data-map-code="'+card.dataset.code+'"]')) && recent.answer==='青森県' && recent.selectedCode==='02'; })()`), "誤答時に選択県と正解県の形・周辺位置を比較できません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); globalThis.__prefQuizTest={type:'map',skill:'B',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen').dataset.quizType==='map'`);
  assert(await evaluate(cdp, `[...document.querySelectorAll('input[name="answer"]')].some(input=>input.value==='青森県')`), "実際に混同した県を次回の位置問題へ再提示できません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); delete globalThis.__prefQuizTest; true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'capital',skill:'C',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelector('#game-screen').dataset.quizType === 'capital'`);
  await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value!=='札幌市'); globalThis.__wrongCapital=input.value; input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  assert(await evaluate(cdp, `(() => { const cards=[...document.querySelectorAll('#feedback-comparison .feedback-shape-card')]; const recent=JSON.parse(localStorage.getItem('prefecture-minigame-v2')).recent[0]; return cards.length===2 && cards[0].dataset.code && cards[0].dataset.code!=='01' && cards[1].dataset.code==='01' && recent.selectedCode===cards[0].dataset.code && cards.every(card=>card.querySelector('.map-prefecture.target[data-map-code="'+card.dataset.code+'"]')); })()`), "県庁所在地の誤答から選択県の形と場所を逆引きできません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); globalThis.__prefQuizTest={type:'capital',skill:'C',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen').dataset.quizType==='capital'`);
  assert(await evaluate(cdp, `[...document.querySelectorAll('input[name="answer"]')].some(input=>input.value===globalThis.__wrongCapital)`), "実際に混同した県庁所在地を次回の選択肢へ再提示できません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); delete globalThis.__prefQuizTest; delete globalThis.__wrongCapital; true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'region',skill:'D',code:'02'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelector('#game-screen').dataset.quizType === 'region'`);
  await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value!=='東北地方'); globalThis.__wrongRegion=input.value; input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  assert(await evaluate(cdp, `document.querySelectorAll('#feedback-comparison .feedback-shape-card').length===1 && document.querySelector('#feedback-comparison .correct-answer').dataset.code==='02' && document.querySelector('#feedback-comparison .correct-answer small').textContent.includes(globalThis.__wrongRegion)`), "地方の誤答に架空の選択県を表示しています");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); delete globalThis.__prefQuizTest; delete globalThis.__wrongRegion; true`);

  await evaluate(cdp, `(() => { const progress={}; const future=Date.now()+30*864e5; const learned={attempts:5,correct:5,streak:3,lastSeen:1,averageMs:5000,timeouts:0,nextDue:future,mastery:.8,recent:[1]}; for(let number=1;number<=15;number++){const code=String(number).padStart(2,'0'); progress[code+':A']={...learned}; progress[code+':B']={...learned};} progress['01:C']={...learned,nextDue:1}; localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress,highScore:0,recent:[]})); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `Math.random=()=>.999999; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])')`);
  assert(await evaluate(cdp, `globalThis.__prefQuizTest===undefined && document.querySelector('#game-screen').dataset.skill==='C' && document.querySelector('#game-screen').dataset.quizType==='capitalLocate'`), "習熟条件成立後に県庁所在地→地図が通常選択されません");

  await evaluate(cdp, `(() => { const progress={}; const future=Date.now()+30*864e5; const learned={attempts:5,correct:5,streak:3,lastSeen:1,averageMs:5000,timeouts:0,nextDue:future,mastery:.8,recent:[1]}; for(let number=1;number<=15;number++){const code=String(number).padStart(2,'0'); progress[code+':A']={...learned}; progress[code+':B']={...learned};} progress['01:E']={...learned,nextDue:1}; localStorage.setItem('prefecture-minigame-v2',JSON.stringify({schema:2,settings:{sound:false,volume:.5,answerMode:'confirm'},progress,highScore:0,recent:[]})); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `Math.random=()=>.999999; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])')`);
  assert(await evaluate(cdp, `globalThis.__prefQuizTest===undefined && document.querySelector('#game-screen').dataset.skill==='E' && document.querySelector('#game-screen').dataset.quizType==='dishShapeChoice'`), "習熟条件成立後に郷土料理→形が通常選択されません");
  await evaluate(cdp, `localStorage.removeItem('prefecture-minigame-v2'); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'silhouette',skill:'A',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  for (let round = 1; round <= 2; round++) {
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && !document.querySelector('#feedback-dialog').open`);
    await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item => item.value === '北海道'); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    if (round === 1) await evaluate(cdp, `document.querySelector('#next-question-button').click(); true`);
  }
  assert(await evaluate(cdp, `document.querySelector('#combo-count').textContent === '2' && Number(document.querySelector('#score-count').textContent) > 200`), "コンボまたはスコア加算が不正です");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); delete globalThis.__prefQuizTest; true`);

  await evaluate(cdp, `globalThis.__prefQuizTest={type:'silhouette',skill:'A',code:'01'}; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])')`);
  await cdp.command("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolveWait) => setTimeout(resolveWait, 16_000));
  await cdp.command("Page.setWebLifecycleState", { state: "active" });
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`, 5_000);
  assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'TIME UP' && JSON.parse(localStorage.getItem('prefecture-minigame-v2')).recent[0].timedOut === true && document.querySelectorAll('#feedback-comparison .feedback-shape-card').length===1 && document.querySelector('#feedback-comparison .correct-answer').dataset.code==='01' && document.querySelector('#feedback-comparison .correct-answer .map-prefecture.target[data-map-code="01"]') && document.querySelector('#feedback-comparison .correct-answer small').textContent.includes('時間切れ')`), "時間切れの記録または正解県の形・場所表示が不正です");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); delete globalThis.__prefQuizTest; true`);
  assert(errors.length === 0, `Chromeでエラーが発生しました: ${errors.join(" / ")}`);
  console.log("Chromeで30形式、見本後の遅延検索、白地図、形比較、10問、即時・地図・キー操作、時間切れ、保存、通信復旧、全消去の確認に成功しました。");
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  if (chrome.exitCode === null) await Promise.race([once(chrome, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
  await new Promise((resolveClose) => server.close(resolveClose));
}
}

function devToolsSocket(chrome, timeout) {
  return new Promise((resolveSocket, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chromeの起動がタイムアウトしました\n${log}`)), timeout);
    const finish = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    chrome.once("error", (error) => finish(reject, error));
    chrome.once("exit", (code, signal) => finish(reject, new Error(`Chromeが起動前に終了しました (${code ?? signal})\n${log}`)));
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) finish(resolveSocket, match[1]);
    });
  });
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function retry(task, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await task();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError || new Error("Chromeへの接続がタイムアウトしました");
}

async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function clickCenter(client, selector) {
  const point = await evaluate(client, `(() => { const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function waitFor(client, expression, timeout = 5_000) {
  return retry(async () => await evaluate(client, `Boolean(${expression})`), timeout);
}

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      }
    });
  }

  command(method, params = {}) {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, reject) => this.pending.set(id, { resolve: resolveCommand, reject }));
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  close() {
    this.socket.close();
  }
}

await main();
