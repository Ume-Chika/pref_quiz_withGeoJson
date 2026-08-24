import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const base = "/pref_quiz_withGeoJson/";
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

  const errors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.text));
  cdp.on("Log.entryAdded", ({ entry }) => entry.level === "error" && errors.push(entry.text));
  await cdp.command("Log.enable");
  await cdp.command("Page.navigate", { url: `http://127.0.0.1:4173${base}` });

  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  assert(await evaluate(cdp, `document.querySelectorAll('#hero-map path').length === 47`), "ホーム地図が47都道府県ではありません");
  assert(await evaluate(cdp, `!document.querySelector('#sound-setting').checked`), "効果音の初期値がOFFではありません");
  assert(await evaluate(cdp, `fetch('./sources.html').then(r => r.ok)`), "出典ページを取得できません");

  await evaluate(cdp, `localStorage.setItem('prefecture-minigame-v2', JSON.stringify({schema:2,settings:{sound:false,answerMode:'broken'},progress:{'01:A':{attempts:'bad',correct:99,mastery:4,recent:null}},highScore:'bad',recent:null})); location.reload(); true`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `document.querySelector('#start-ten-button').click()`);

  for (let question = 1; question <= 10; question++) {
    await waitFor(cdp, `document.querySelector('#game-screen:not([hidden])') && document.querySelectorAll('input[name="answer"]').length === 4`);
    assert(await evaluate(cdp, `document.querySelector('#question-number').textContent === '${question}/10'`), `問題番号${question}が不正です`);
    await evaluate(cdp, `(() => { const input=document.querySelector('input[name="answer"]'); input.checked=true; input.dispatchEvent(new Event('change')); document.querySelector('#submit-answer-button').click(); return true; })()`);
    await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
    assert(await evaluate(cdp, `document.querySelector('#feedback-detail').textContent.length > 5`), "解説が空です");
    await evaluate(cdp, `document.querySelector('#next-question-button').click()`);
  }

  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  const state = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(state.schema === 2, "保存スキーマが不正です");
  assert(state.settings.sound === false && state.settings.answerMode === "confirm", "壊れた設定値を復旧できません");
  assert(Object.values(state.progress).reduce((sum, item) => sum + item.attempts, 0) === 10, "10問分の学習履歴を保存できません");
  assert(Object.values(state.progress).every((item) => Number.isFinite(item.mastery)), "習熟度に不正値があります");

  await evaluate(cdp, `(() => { const state=JSON.parse(localStorage.getItem('prefecture-minigame-v2')); for(let i=1;i<=47;i++){ const code=String(i).padStart(2,'0'); state.progress[code+':B']={attempts:1,correct:1,streak:1,lastSeen:1,averageMs:1000,timeouts:0,nextDue:1,mastery:1,recent:[1]}; } state.settings.answerMode='instant'; localStorage.setItem('prefecture-minigame-v2',JSON.stringify(state)); location.reload(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#home-screen:not([hidden])')`, 10_000);
  await evaluate(cdp, `Math.random=()=>0.99; document.querySelector('#start-endless-button').click(); true`);
  await waitFor(cdp, `document.querySelector('#quiz-type').textContent === '地図記憶'`);
  assert(await evaluate(cdp, `document.querySelector('#timer-text').textContent === '記憶中' && document.querySelector('#submit-answer-button').hidden`), "地図記憶の待機表示または即時回答設定が不正です");
  await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
  await evaluate(cdp, `document.querySelector('.map-prefecture[data-code]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await waitFor(cdp, `document.querySelector('#feedback-dialog').open`);
  await evaluate(cdp, `document.querySelector('#quit-game-button').click()`);
  await waitFor(cdp, `document.querySelector('#result-screen:not([hidden])')`);
  await evaluate(cdp, `document.querySelector('#result-home-button').click(); document.querySelector('#settings-button').click(); document.querySelector('#reset-data-button').click(); document.querySelector('#confirm-reset-button').click(); true`);
  await waitFor(cdp, `!document.querySelector('#settings-dialog').open`);
  const resetState = await evaluate(cdp, `JSON.parse(localStorage.getItem('prefecture-minigame-v2'))`);
  assert(Object.keys(resetState.progress).length === 0 && resetState.settings.sound === false && resetState.settings.answerMode === "confirm", "全消去で初期状態へ戻りません");
  assert(errors.length === 0, `Chromeでエラーが発生しました: ${errors.join(" / ")}`);
  console.log("Chromeで10問、即時場所回答、結果、保存、全消去の確認に成功しました。");
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
