import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const base = "/pref_quiz_withGeoJson/";
const namesByCode = Object.fromEntries(JSON.parse(readFileSync("static/data/prefecture_facts.json", "utf8")).prefectures.map((item) => [item.code, item.name]));
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
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.text));
  cdp.on("Log.entryAdded", ({ entry }) => entry.level === "error" && !/net::ERR_BLOCKED_BY_CLIENT/.test(entry.text) && errors.push(entry.text));
  await cdp.command("Log.enable");
  await cdp.command("Page.navigate", { url: `http://127.0.0.1:4173${base}` });

  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  assert(await evaluate(cdp, `document.querySelectorAll('#hero-map path').length === 47`), "ホーム地図が47都道府県ではありません");
  assert(await evaluate(cdp, `document.documentElement.scrollWidth <= document.documentElement.clientWidth`), "スマートフォン幅で横スクロールが発生しています");
  assert(await evaluate(cdp, `[...document.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => button.getBoundingClientRect().height >= 44)`), "操作ボタンが44px未満です");
  assert(await evaluate(cdp, `!document.querySelector('#sound-setting').checked`), "効果音の初期値がOFFではありません");
  assert(await evaluate(cdp, `document.querySelector('#volume-setting').disabled && document.querySelector('#volume-setting').value === '0.5'`), "音量の初期値が不正です");
  assert(await evaluate(cdp, `fetch('./sources.html').then(r => r.ok)`), "出典ページを取得できません");

  await cdp.command("Network.setBlockedURLs", { urls: ["*prefecture_facts.json"] });
  await evaluate(cdp, `location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#error-screen:not([hidden])')`, 10_000);
  assert(await evaluate(cdp, `!document.querySelector('#retry-button').disabled`), "読込失敗後に再試行できません");
  await cdp.command("Network.setBlockedURLs", { urls: [] });
  await evaluate(cdp, `document.querySelector('#retry-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `localStorage.setItem('prefecture-minigame-v2', JSON.stringify({schema:2,settings:{sound:false,answerMode:'broken'},progress:{'01:A':{attempts:'bad',correct:99,mastery:4,recent:null}},highScore:'bad',recent:null})); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `globalThis.__nativeRandom=Math.random; Math.random=()=>0; document.querySelector('#start-ten-button').click()`);

  for (let question = 1; question <= 10; question++) {
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelectorAll('input[name="answer"]').length === 4`);
    assert(await evaluate(cdp, `document.querySelector('#question-number').textContent === '${question}/10'`), `問題番号${question}が不正です`);
    await waitFor(cdp, `document.querySelector('#timer-text').textContent !== '記憶中'`, 4_000);
    const code = await evaluate(cdp, `document.querySelector('#game-screen').dataset.code`);
    await evaluate(cdp, `(() => { const type=document.querySelector('#game-screen').dataset.quizType; if(['locate','locateJapan','mapMemory'].includes(type)){ document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); } else { const input=[...document.querySelectorAll('input[name="answer"]')].find(item=>item.value===${JSON.stringify(namesByCode[code])}); input.checked=true; input.dispatchEvent(new Event('change')); } document.querySelector('#submit-answer-button').click(); return true; })()`);
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'CORRECT'`), `問題${question}を正答として判定できません`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-detail').textContent.length > 5`), "解説が空です");
    await evaluate(cdp, `document.querySelector('#next-question-button').click()`);
  }

  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  await evaluate(cdp, `Math.random=globalThis.__nativeRandom; delete globalThis.__nativeRandom; true`);
  const state = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(state.schema === 2, "保存スキーマが不正です");
  assert(state.settings.sound === false && state.settings.volume === .5 && state.settings.answerMode === "confirm", "壊れた設定値を復旧できません");
  assert(Object.values(state.progress).reduce((sum, item) => sum + item.attempts, 0) === 10, "10問分の学習履歴を保存できません");
  assert(Object.values(state.progress).reduce((sum, item) => sum + item.correct, 0) === 10, "10問分の正答を記録できません");
  assert(Object.values(state.progress).filter((item) => item.attempts > 0).length === 4, "10問で新規項目がちょうど4件に制限されていません");
  assert(state.recent.slice(0, 10).filter((item) => item.newItem).length === 4, "新規項目の履歴を保存できません");
  assert(Object.values(state.progress).every((item) => Number.isFinite(item.mastery)), "習熟度に不正値があります");

  await evaluate(cdp, `(() => { const state=JSON.parse(localStorage.getItem('prefecture-minigame-v2')); state.settings.answerMode='instant'; localStorage.setItem('prefecture-minigame-v2',JSON.stringify(state)); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
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
  assert(Object.keys(resetState.progress).length === 0 && resetState.settings.sound === false && resetState.settings.volume === .5 && resetState.settings.answerMode === "confirm", "全消去で初期状態へ戻りません");

  const modes = [
    ["silhouette", "A", "01", "北海道"], ["reveal", "A", "01", "北海道"], ["spotlight", "A", "01", "北海道"],
    ["flash", "A", "01", "北海道"], ["silhouetteReverse", "A", "01", "北海道"],
    ["map", "B", "01", "北海道"], ["locate", "B", "01", "北海道"], ["locateJapan", "B", "01", "北海道"],
    ["mapMemory", "B", "01", "北海道"], ["mapFlash", "B", "01", "北海道"], ["compass", "B", "01", "北東"],
    ["capital", "C", "01", "札幌市"], ["capitalReverse", "C", "01", "北海道"], ["capitalMap", "C", "01", "札幌市"],
    ["region", "D", "02", "東北地方"], ["regionMember", "D", "02", "青森県"], ["regionMap", "D", "02", "東北地方"],
    ["dish", "E", "01", "北海道"], ["dishReverse", "E", "01", "ジンギスカン"],
  ];
  for (const [type, skill, code, correct] of modes) {
    await evaluate(cdp, `globalThis.__prefQuizTest=${JSON.stringify({ type, skill, code })}; document.querySelector('#start-endless-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelector('#game-screen').dataset.quizType === '${type}'`);
    assert(await evaluate(cdp, `document.querySelectorAll('input[name="answer"]').length === 4 && new Set([...document.querySelectorAll('input[name="answer"]')].map(input => input.value)).size === 4`), `${type}: 4つの一意な選択肢がありません`);
    assert(await evaluate(cdp, `document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll('.answer-option label')].filter(label => label.getClientRects().length).every(label => label.getBoundingClientRect().height >= 44)`), `${type}: スマートフォン表示またはタップ領域が不正です`);
    if (type === "silhouetteReverse") assert(await evaluate(cdp, `document.querySelectorAll('.shape-option svg').length === 4`), "逆シルエットの形が4つありません");
    if (type === "regionMap") assert(await evaluate(cdp, `document.querySelectorAll('.map-prefecture.target').length === 6`), "東北地方の6県が強調されていません");
    if (["locate", "locateJapan", "mapMemory"].includes(type)) {
      const expectedPaths = type === "locateJapan" ? 47 : 7;
      assert(await evaluate(cdp, `document.querySelectorAll('.map-prefecture[data-code]').length === ${expectedPaths}`), `${type}: 地図の選択肢数が不正です`);
      if (type === "locateJapan") assert(await evaluate(cdp, `(() => { const svg=document.querySelector('#visual-stage svg'); const tokyo=svg.querySelector('[data-code="13"]'); const point=new DOMPoint(Number(tokyo.dataset.centerX),Number(tokyo.dataset.centerY)).matrixTransform(svg.getScreenCTM()); svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y})); return svg.querySelector('[data-code="13"]').classList.contains('selected') && !document.querySelector('#submit-answer-button').disabled; })()`), "全国地図の余白タップで東京都本土を選べません");
    }
    if (["flash", "mapFlash", "mapMemory"].includes(type)) {
      assert(await evaluate(cdp, `(() => { document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true})); return !document.querySelector('input[name="answer"]:checked') && !document.querySelector('#feedback-dialog').open; })()`), `${type}: 記憶中にキー回答できてしまいます`);
      await waitFor(cdp, `document.querySelector('#timer-text').textContent !== '記憶中'`, 4_000);
    }
    if (["locate", "locateJapan", "mapMemory"].includes(type)) {
      if (type === "locate") {
        assert(await evaluate(cdp, `(() => { const paths=[...document.querySelectorAll('.map-prefecture[data-code]')]; paths[0].focus(); paths[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); const moved=document.activeElement!==paths[0]; document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return moved && !document.querySelector('#submit-answer-button').disabled; })()`), "地図を方角どおりの矢印・Enterで選択できません");
        await evaluate(cdp, `document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#submit-answer-button').click(); true`);
      } else {
        await evaluate(cdp, `document.querySelector('.map-prefecture[data-code="${code}"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#submit-answer-button').click(); true`);
      }
    } else {
      await evaluate(cdp, `(() => { const input=[...document.querySelectorAll('input[name="answer"]')].find(item => item.value === ${JSON.stringify(correct)}); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
    }
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'CORRECT' && document.querySelector('#feedback-detail').textContent.length > 5`), `${type}: 正答または解説が不正です`);
    await evaluate(cdp, `document.querySelector('#quit-game-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
    await evaluate(cdp, `document.querySelector('#result-home-button').click(); true`);
    await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`);
  }
  await evaluate(cdp, `delete globalThis.__prefQuizTest; true`);

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
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`, 22_000);
  assert(await evaluate(cdp, `document.querySelector('#feedback-kicker').textContent === 'TIME UP' && JSON.parse(localStorage.getItem('prefecture-minigame-v2')).recent[0].timedOut === true`), "時間切れを区別して記録できません");
  await evaluate(cdp, `document.querySelector('#quit-game-button').click(); document.querySelector('#result-home-button').click(); delete globalThis.__prefQuizTest; true`);
  assert(errors.length === 0, `Chromeでエラーが発生しました: ${errors.join(" / ")}`);
  console.log("Chromeで19形式、10問、即時・地図・キー操作、時間切れ、保存、通信復旧、全消去の確認に成功しました。");
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
