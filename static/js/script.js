"use strict";

import { blankProgress, normalizeProgress, recordAnswer, schedulingPriority } from "./learning.mjs";

const STORAGE_KEY = "prefecture-minigame-v2";
const QUESTION_SECONDS = 15;
const SKILLS = {
  A: { name: "形", unlockAt: 0 },
  B: { name: "位置", unlockAt: 0 },
  C: { name: "県庁所在地", unlockAt: 10 },
  D: { name: "地方区分", unlockAt: 25 },
  E: { name: "名産・文化", unlockAt: 40 }
};

const $ = (id) => document.getElementById(id);
const screens = ["loading-screen", "error-screen", "home-screen", "game-screen", "result-screen"].map($);
const ui = {
  app: $("app"), loading: $("loading-screen"), error: $("error-screen"), errorMessage: $("error-message"),
  home: $("home-screen"), game: $("game-screen"), result: $("result-screen"), heroMap: $("hero-map"),
  learned: $("learned-count"), attempts: $("total-attempts"), highScore: $("high-score"), reviewHint: $("next-review-hint"),
  questionNumber: $("question-number"), combo: $("combo-count"), score: $("score-count"), timer: $("timer-bar"), timerRoot: $("timer"), timerText: $("timer-text"),
  type: $("quiz-type"), title: $("question-title"), help: $("question-help"), stage: $("visual-stage"),
  answerFieldset: $("answer-fieldset"), answerGrid: $("answer-grid"), submit: $("submit-answer-button"), keyboardHint: $("keyboard-hint"),
  feedback: $("feedback-dialog"), feedbackMark: $("feedback-mark"), feedbackKicker: $("feedback-kicker"),
  feedbackTitle: $("feedback-title"), feedbackDetail: $("feedback-detail"), feedbackPoints: $("feedback-points"),
  settings: $("settings-dialog"), progress: $("progress-dialog"), resetConfirm: $("confirm-reset-dialog")
};

let geoData = null;
let prefectures = [];
let facts = [];
let saved = loadSaved();
let timerFrame = 0;
let questionToken = 0;
let audioContext = null;
let session = null;

function freshSaved() {
  return { schema: 2, settings: { sound: false, answerMode: "confirm" }, progress: {}, highScore: 0, recent: [] };
}

function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object" || parsed.schema !== 2) return freshSaved();
    const progress = {};
    for (const [key, value] of Object.entries(parsed.progress || {})) {
      if (/^(0[1-9]|[1-3]\d|4[0-7]):[A-E]$/.test(key)) progress[key] = normalizeProgress(value);
    }
    return {
      ...freshSaved(), ...parsed,
      settings: {
        sound: parsed.settings?.sound === true,
        answerMode: ["confirm", "instant"].includes(parsed.settings?.answerMode) ? parsed.settings.answerMode : "confirm"
      },
      progress,
      highScore: finiteNumber(parsed.highScore, 0, 0, 1e9),
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((item) => item && typeof item.code === "string" && typeof item.type === "string").slice(0, 30) : []
    };
  } catch (_) {
    return freshSaved();
  }
}

function finiteNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (_) { /* Storage can be unavailable. */ }
}

function showScreen(target) {
  screens.forEach((screen) => { screen.hidden = screen !== target; });
  const playing = target === ui.game;
  $("home-button").disabled = playing || !prefectures.length;
  $("settings-button").disabled = playing || !prefectures.length;
  $("progress-button").disabled = playing || !prefectures.length;
  requestAnimationFrame(() => ui.app.focus({ preventScroll: true }));
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

async function loadData() {
  showScreen(ui.loading);
  try {
    const [geoResponse, factsResponse] = await Promise.all([
      fetch("./static/data/low_prefectures.geojson"),
      fetch("./static/data/prefecture_facts.json")
    ]);
    if (!geoResponse.ok || !factsResponse.ok) throw new Error("問題データを取得できませんでした。");
    const [nextGeo, factData] = await Promise.all([geoResponse.json(), factsResponse.json()]);
    validateData(nextGeo, factData);
    geoData = nextGeo;
    facts = factData.prefectures;
    const byName = new Map(facts.map((fact) => [fact.name, fact]));
    prefectures = geoData.features.map((feature) => {
      const mainGeometry = largestPolygonGeometry(feature.geometry);
      return {
        ...byName.get(feature.properties.name), feature, mainGeometry,
        center: centerOfGeometry(mainGeometry), shape: shapeStats(mainGeometry)
      };
    }).sort((a, b) => Number(a.code) - Number(b.code));
    renderHeroMap();
    renderHome();
    showScreen(ui.home);
  } catch (error) {
    ui.errorMessage.textContent = error instanceof Error ? error.message : "問題データを読み込めませんでした。";
    showScreen(ui.error);
  }
}

function validateData(geo, factData) {
  if (geo?.type !== "FeatureCollection" || geo.features?.length !== 47) throw new Error("境界データが47都道府県分ではありません。");
  if (!Array.isArray(factData?.prefectures) || factData.prefectures.length !== 47) throw new Error("都道府県情報が47件ではありません。");
  const geoNames = new Set(geo.features.map((feature) => feature?.properties?.name));
  const factNames = new Set(factData.prefectures.map((fact) => fact.name));
  if (geoNames.size !== 47 || factNames.size !== 47 || [...factNames].some((name) => !geoNames.has(name))) {
    throw new Error("境界データと都道府県情報が一致しません。");
  }
}

function coordinatesOf(geometry, result = []) {
  const walk = (value) => {
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") result.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(geometry.coordinates);
  return result;
}

function boundsOf(items) {
  const points = items.flatMap((item) => coordinatesOf(item.geometry || item.feature?.geometry || item));
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function centerOfGeometry(geometry) {
  const bounds = boundsOf([geometry]);
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(area / 2);
}

function largestPolygonGeometry(geometry) {
  if (geometry.type === "Polygon") return geometry;
  const coordinates = geometry.coordinates.reduce((largest, polygon) => ringArea(polygon[0]) > ringArea(largest[0]) ? polygon : largest);
  return { type: "Polygon", coordinates };
}

function shapeStats(geometry) {
  const bounds = boundsOf([geometry]);
  const width = Math.max(.001, bounds.maxX - bounds.minX);
  const height = Math.max(.001, bounds.maxY - bounds.minY);
  return { aspect: width / height, fill: Math.min(1, ringArea(geometry.coordinates[0]) / (width * height)) };
}

function expandedBounds(bounds, factor = 1.5) {
  const width = Math.max(bounds.maxX - bounds.minX, .5);
  const height = Math.max(bounds.maxY - bounds.minY, .5);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { minX: cx - width * factor, maxX: cx + width * factor, minY: cy - height * factor, maxY: cy + height * factor };
}

function projector(bounds, width, height, padding = 18) {
  const dx = Math.max(bounds.maxX - bounds.minX, .001);
  const dy = Math.max(bounds.maxY - bounds.minY, .001);
  const scale = Math.min((width - padding * 2) / dx, (height - padding * 2) / dy);
  const offsetX = (width - dx * scale) / 2;
  const offsetY = (height - dy * scale) / 2;
  return ([lon, lat]) => [offsetX + (lon - bounds.minX) * scale, offsetY + (bounds.maxY - lat) * scale];
}

function geometryPath(geometry, project) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join("") + "Z")).join("");
}

function svgMap(features, viewBounds, { width = 700, height = 470, targetCode = "", clickable = false, label = "日本地図" } = {}) {
  const project = projector(viewBounds, width, height);
  const paths = features.map((prefecture) => {
    const isTarget = prefecture.code === targetCode;
    const attrs = clickable ? `tabindex="0" role="button" data-code="${prefecture.code}" aria-label="${prefecture.name}"` : "";
    return `<path class="map-prefecture${isTarget ? " target" : ""}${clickable ? " clickable" : ""}" d="${geometryPath(prefecture.feature.geometry, project)}" ${attrs}/>`;
  }).join("");
  const hits = clickable ? features.map((prefecture) => `<path class="map-hit" d="${geometryPath(prefecture.feature.geometry, project)}" data-code="${prefecture.code}" aria-hidden="true"/>`).join("") : "";
  return `<svg viewBox="0 0 ${width} ${height}" role="${clickable ? "group" : "img"}" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${paths}${hits}</svg>`;
}

function silhouetteSvg(prefecture, effect = "plain") {
  const width = 650;
  const height = 410;
  const project = projector(boundsOf([prefecture.mainGeometry]), width, height, 38);
  const path = geometryPath(prefecture.mainGeometry, project);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) effect = "plain";
  if (effect === "spotlight") {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="暗闇を動くスポットライトで照らされた都道府県の形">
      <defs><mask id="moving-spot"><rect width="100%" height="100%" fill="black"/><circle cy="205" r="92" fill="white"><animate attributeName="cx" values="40;610;150;500;40" dur="7s" repeatCount="indefinite"/><animate attributeName="cy" values="90;260;330;100;90" dur="5.3s" repeatCount="indefinite"/></circle></mask></defs>
      <path class="spotlight-path" d="${path}" mask="url(#moving-spot)"/>
    </svg>`;
  }
  if (effect === "reveal") {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="徐々に姿を現す都道府県の形">
      <defs><mask id="reveal-mask"><rect width="100%" height="100%" fill="black"/><circle cx="325" cy="205" r="0" fill="white"><animate attributeName="r" from="0" to="430" dur="8s" fill="freeze"/></circle></mask></defs>
      <path class="silhouette" d="${path}" mask="url(#reveal-mask)"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="都道府県のシルエット"><path class="silhouette" d="${path}" fill-rule="evenodd"/></svg>`;
}

function renderHeroMap() {
  ui.heroMap.innerHTML = svgMap(prefectures, boundsOf(prefectures), { width: 500, height: 500, label: "" });
}

function progressKey(code, skill) { return `${code}:${skill}`; }
function getProgress(code, skill) {
  const key = progressKey(code, skill);
  return { ...blankProgress(), ...(saved.progress[key] || {}) };
}

function totalAttempts() {
  return Object.values(saved.progress).reduce((sum, item) => sum + (Number(item.attempts) || 0), 0);
}

function renderHome() {
  const attempts = totalAttempts();
  const learned = prefectures.filter((prefecture) => {
    const a = getProgress(prefecture.code, "A").mastery || 0;
    const b = getProgress(prefecture.code, "B").mastery || 0;
    return (a + b) / 2 >= .6;
  }).length;
  ui.learned.textContent = learned;
  ui.attempts.textContent = attempts;
  ui.highScore.textContent = saved.highScore || 0;
  const now = Date.now();
  const due = Object.values(saved.progress).filter((item) => item.attempts && item.nextDue <= now).length;
  ui.reviewHint.textContent = due ? `復習のタイミングが来た問題が${due}件あります。` : attempts ? "学習状況に合わせて次の問題を選びます。" : "最初は基本の形と位置から出題します。";
}

function unlockedSkills() {
  const attempts = totalAttempts();
  return Object.entries(SKILLS).filter(([, skill]) => attempts >= skill.unlockAt).map(([code]) => code);
}

function chooseQuestion() {
  const dueRetryIndex = session.retries.findIndex((retry) => retry.dueAt <= session.answers.length + 1);
  if (dueRetryIndex >= 0) {
    const retry = session.retries.splice(dueRetryIndex, 1)[0];
    return buildQuestion(prefectures.find((prefecture) => prefecture.code === retry.code), retry.skill);
  }
  const now = Date.now();
  const recentCodes = session.recentCodes.slice(-3);
  const recentTypes = session.recentTypes.slice(-2);
  const candidates = unlockedSkills().flatMap((skill) => prefectures.map((prefecture) => {
    const item = getProgress(prefecture.code, skill);
    const bucket = item.attempts && item.nextDue <= now ? 3 : item.attempts ? 1 : 2;
    return { prefecture, skill, bucket, priority: schedulingPriority(item, { now, recentlyShown: recentCodes.includes(prefecture.code) }) };
  }));
  candidates.sort((a, b) => b.bucket - a.bucket || b.priority - a.priority);
  const pool = candidates.slice(0, Math.min(12, candidates.length));
  let question = null;
  for (const candidate of shuffle(pool)) {
    const built = buildQuestion(candidate.prefecture, candidate.skill);
    if (!recentTypes.includes(built.type)) { question = built; break; }
    question ||= built;
  }
  return question;
}

function buildQuestion(prefecture, skill) {
  const item = getProgress(prefecture.code, skill);
  const mastery = item.mastery || 0;
  let type;
  if (skill === "A") {
    const modes = mastery < .15 ? ["silhouette", "reveal"] : mastery < .45 ? ["silhouette", "reveal", "spotlight"] : ["spotlight", "flash", "reveal", "silhouette"];
    type = randomOf(modes);
  } else if (skill === "B") {
    type = mastery < .2 ? "map" : randomOf(["map", "locate", "mapMemory"]);
  } else if (skill === "C") {
    type = randomOf(["capital", "capitalReverse"]);
  } else if (skill === "D") {
    type = randomOf(["region", "regionMember"]);
  } else {
    type = randomOf(["dish", "dishReverse"]);
  }

  const question = { prefecture, skill, type, choices: [], correct: "" };
  if (["silhouette", "reveal", "spotlight", "flash", "map", "locate", "mapMemory"].includes(type)) {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, skill === "A" ? "shape" : "geo");
  } else if (type === "capital") {
    question.correct = prefecture.capital;
    question.choices = valueChoices(prefecture, "capital");
  } else if (type === "capitalReverse") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery);
  } else if (type === "region") {
    question.correct = prefecture.region;
    question.choices = shuffle([prefecture.region, ...shuffle([...new Set(facts.map((fact) => fact.region))].filter((region) => region !== prefecture.region)).slice(0, 3)]);
  } else if (type === "regionMember") {
    question.correct = prefecture.name;
    question.choices = shuffle([prefecture.name, ...shuffle(prefectures.filter((item) => item.region !== prefecture.region)).slice(0, 3).map((item) => item.name)]);
  } else if (type === "dish") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery);
  } else if (type === "dishReverse") {
    question.correct = prefecture.dish;
    question.choices = valueChoices(prefecture, "dish");
  }
  return question;
}

function nameChoices(target, mastery, strategy = "geo") {
  const candidates = prefectures.filter((item) => item.code !== target.code).map((item) => ({
    item,
    regionPenalty: item.region === target.region ? 0 : 12,
    distance: Math.hypot(item.center[0] - target.center[0], item.center[1] - target.center[1]),
    shapeDistance: Math.abs(Math.log(item.shape.aspect / target.shape.aspect)) + Math.abs(item.shape.fill - target.shape.fill) * 2
  }));
  if (mastery > .25) candidates.sort((a, b) => strategy === "shape" ? a.shapeDistance - b.shapeDistance : (a.regionPenalty + a.distance) - (b.regionPenalty + b.distance));
  else candidates.sort(() => Math.random() - .5);
  return shuffle([target.name, ...candidates.slice(0, 3).map(({ item }) => item.name)]);
}

function valueChoices(target, field) {
  const sameRegion = shuffle(prefectures.filter((item) => item.code !== target.code && item.region === target.region));
  const others = shuffle(prefectures.filter((item) => item.code !== target.code && item.region !== target.region));
  return shuffle([target[field], ...[...sameRegion, ...others].slice(0, 3).map((item) => item[field])]);
}

function renderQuestion() {
  cancelAnimationFrame(timerFrame);
  const token = ++questionToken;
  session.current = chooseQuestion();
  const question = session.current;
  session.selectedLocation = "";
  session.locationLocked = false;
  session.recentCodes.push(question.prefecture.code);
  session.recentTypes.push(question.type);
  ui.questionNumber.textContent = session.limit ? `${session.answers.length + 1}/${session.limit}` : `${session.answers.length + 1}/∞`;
  ui.combo.textContent = session.combo;
  ui.score.textContent = session.score;
  ui.submit.disabled = true;
  ui.submit.hidden = false;
  ui.answerFieldset.hidden = false;
  ui.keyboardHint.innerHTML = "<kbd>1</kbd>–<kbd>4</kbd> 選択　<kbd>Enter</kbd> 決定";
  ui.stage.className = "visual-stage";
  setQuestionCopy(question);
  renderVisual(question, token);
  renderAnswers(question);
  showScreen(ui.game);
  requestAnimationFrame(() => ui.title.focus({ preventScroll: true }));
  session.startedAt = performance.now();
  session.deadline = performance.now() + QUESTION_SECONDS * 1000;
  updateTimer(token);
}

function setQuestionCopy(question) {
  const copy = {
    silhouette: ["シルエット", "この都道府県はどこ？", "輪郭を見て答えてください。"],
    reveal: ["じわじわ表示", "だんだん見える県はどこ？", "早く分かるほど高得点です。"],
    spotlight: ["スポットライト", "暗闇に隠れた県はどこ？", "動く光から輪郭をつかんでください。"],
    flash: ["フラッシュ記憶", "さっき見えた県はどこ？", "形は一瞬だけ表示されます。"],
    map: ["周辺地図", "黄色く光る都道府県はどこ？", "周りの県との位置関係も手がかりです。"],
    locate: ["場所タップ", `${question.prefecture.name}はどこ？`, "日本地図から直接タップしてください。"],
    mapMemory: ["地図記憶", `${question.prefecture.name}はどこ？`, "最初の2秒だけ正解の場所が光ります。"],
    capital: ["県庁所在地", `${question.prefecture.name}の県庁所在地は？`, "正しい市区を選んでください。"],
    capitalReverse: ["逆・県庁所在地", `${question.prefecture.capital}が県庁所在地なのは？`, "都道府県名を選んでください。"],
    region: ["地方区分", `${question.prefecture.name}が属する地方は？`, "本アプリでは内閣府資料の8区分を使います。"],
    regionMember: ["地方区分", `${question.prefecture.region}に含まれるのは？`, "当てはまる都道府県を選んでください。"],
    dish: ["郷土料理", `${question.prefecture.dish}で選ばれた都道府県は？`, "農林水産省の郷土料理百選を基準にします。"],
    dishReverse: ["郷土料理", `${question.prefecture.name}で選ばれた郷土料理は？`, "農林水産省の郷土料理百選から選んでください。"]
  }[question.type];
  if (["locate", "mapMemory"].includes(question.type)) copy[2] = `${question.prefecture.region}周辺の地図から選んでください。`;
  [ui.type.textContent, ui.title.textContent, ui.help.textContent] = copy;
}

function renderVisual(question, token) {
  const { prefecture, type } = question;
  if (["silhouette", "reveal", "spotlight", "flash"].includes(type)) {
    ui.stage.classList.toggle("dark", type === "spotlight" || type === "flash");
    ui.stage.innerHTML = silhouetteSvg(prefecture, type === "spotlight" ? "spotlight" : type === "reveal" ? "reveal" : "plain");
    if (type === "flash") {
      const curtain = document.createElement("div");
      curtain.className = "memory-curtain";
      curtain.textContent = "思い出して答えよう";
      ui.stage.append(curtain);
    }
  } else if (type === "map") {
    const localBounds = expandedBounds(boundsOf([prefecture.feature]), 1.65);
    ui.stage.innerHTML = svgMap(prefectures, localBounds, { targetCode: prefecture.code, label: "対象の都道府県を強調した周辺地図" }) + '<span class="stage-corner-label">周辺の位置関係</span>';
  } else if (["locate", "mapMemory"].includes(type)) {
    const regional = prefectures.filter((item) => item.region === prefecture.region);
    const visiblePrefectures = regional.length > 1 ? regional : prefectures;
    const viewBounds = expandedBounds(boundsOf(visiblePrefectures), regional.length > 1 ? .62 : .55);
    const targetCode = type === "mapMemory" ? prefecture.code : "";
    ui.stage.innerHTML = svgMap(visiblePrefectures, viewBounds, { targetCode, clickable: true, label: `${prefecture.name}の位置を選ぶ${prefecture.region}周辺の地図` });
    ui.answerFieldset.hidden = true;
    ui.submit.hidden = saved.settings.answerMode === "instant";
    ui.submit.disabled = true;
    ui.keyboardHint.textContent = saved.settings.answerMode === "instant" ? "地図をタップして回答" : "地図を選択してから「これで決定」";
    session.locationLocked = type === "mapMemory";
    ui.stage.querySelectorAll("[data-code]").forEach((path) => {
      path.addEventListener("click", () => selectLocation(path.dataset.code));
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectLocation(path.dataset.code); }
      });
    });
    if (type === "mapMemory") setTimeout(() => {
      if (token === questionToken) {
        ui.stage.querySelector(".target")?.classList.remove("target");
        session.locationLocked = false;
      }
    }, 2000);
  } else {
    const prompt = type === "capital" ? prefecture.name : type === "capitalReverse" ? prefecture.capital : type === "region" ? prefecture.name : type === "regionMember" ? prefecture.region : type === "dish" ? prefecture.dish : prefecture.name;
    ui.stage.innerHTML = `<div class="fact-prompt"><span>${question.skill}</span><strong>${prompt}</strong></div>`;
  }
}

function renderAnswers(question) {
  ui.answerGrid.innerHTML = "";
  question.choices.forEach((choice, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "answer-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "answer";
    input.id = `answer-${index}`;
    input.value = choice;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.dataset.key = String(index + 1);
    label.textContent = choice;
    input.addEventListener("change", () => {
      ui.submit.disabled = false;
      if (saved.settings.answerMode === "instant") submitSelectedAnswer();
    });
    wrapper.append(input, label);
    ui.answerGrid.append(wrapper);
  });
}

function updateTimer(token) {
  if (token !== questionToken || !session || session.answered) return;
  const remaining = Math.max(0, session.deadline - performance.now());
  const ratio = remaining / (QUESTION_SECONDS * 1000);
  const seconds = Math.ceil(remaining / 1000);
  ui.timer.style.transform = `scaleX(${ratio})`;
  ui.timerRoot.setAttribute("aria-valuenow", String(seconds));
  ui.timerText.textContent = `残り${seconds}秒`;
  ui.timer.classList.toggle("warning", ratio <= .5 && ratio > .2);
  ui.timer.classList.toggle("danger", ratio <= .2);
  if (remaining <= 0) completeAnswer("時間切れ", true);
  else timerFrame = requestAnimationFrame(() => updateTimer(token));
}

function submitSelectedAnswer() {
  if (!session || session.answered) return;
  if (["locate", "mapMemory"].includes(session.current.type)) {
    if (session.selectedLocation) answerLocation(session.selectedLocation);
    return;
  }
  const selected = ui.answerGrid.querySelector('input[name="answer"]:checked');
  if (selected) completeAnswer(selected.value, false);
}

function selectLocation(code) {
  if (!session || session.answered || session.locationLocked) return;
  if (saved.settings.answerMode === "instant") { answerLocation(code); return; }
  session.selectedLocation = code;
  ui.stage.querySelectorAll(".map-prefecture.selected").forEach((path) => path.classList.remove("selected"));
  ui.stage.querySelector(`.map-prefecture[data-code="${code}"]`)?.classList.add("selected");
  ui.submit.disabled = false;
}

function answerLocation(code) {
  if (!session || session.answered) return;
  completeAnswer(prefectures.find((prefecture) => prefecture.code === code)?.name || "", false);
}

function completeAnswer(answer, timedOut) {
  if (!session || session.answered) return;
  const answeredAt = performance.now();
  if (!timedOut && answeredAt >= session.deadline) { timedOut = true; answer = "時間切れ"; }
  session.answered = true;
  cancelAnimationFrame(timerFrame);
  const question = session.current;
  const correct = !timedOut && answer === question.correct;
  const responseMs = Math.min(QUESTION_SECONDS * 1000, Math.round(answeredAt - session.startedAt));
  const previousCombo = session.combo;
  session.combo = correct ? session.combo + 1 : 0;
  session.maxCombo = Math.max(session.maxCombo, session.combo);
  const remainingSeconds = Math.max(0, Math.ceil((session.deadline - answeredAt) / 1000));
  const points = correct ? 100 + remainingSeconds * 10 + previousCombo * 25 : 0;
  session.score += points;
  session.answers.push({ code: question.prefecture.code, skill: question.skill, type: question.type, correct, timedOut, responseMs });
  updateLearning(question, correct, timedOut, responseMs);
  if (!correct) session.retries.push({ code: question.prefecture.code, skill: question.skill, dueAt: session.answers.length + 4 });
  ui.combo.textContent = session.combo;
  ui.score.textContent = session.score;
  playTone(correct ? "correct" : "incorrect");
  showFeedback(question, correct, timedOut, points);
}

function updateLearning(question, correct, timedOut, responseMs) {
  const key = progressKey(question.prefecture.code, question.skill);
  const item = recordAnswer(getProgress(question.prefecture.code, question.skill), { correct, timedOut, responseMs });
  saved.progress[key] = item;
  saved.recent.unshift({ code: question.prefecture.code, skill: question.skill, type: question.type, correct, timedOut, at: Date.now() });
  saved.recent = saved.recent.slice(0, 30);
  persist();
}

function showFeedback(question, correct, timedOut, points) {
  ui.feedback.classList.toggle("incorrect", !correct);
  ui.feedbackMark.textContent = correct ? "○" : timedOut ? "⌛" : "×";
  ui.feedbackKicker.textContent = correct ? "CORRECT" : timedOut ? "TIME UP" : "MISS";
  ui.feedbackTitle.textContent = correct ? randomOf(["正解！", "やった！", "その調子！"]) : timedOut ? "時間切れ" : "おしい！";
  ui.feedbackDetail.textContent = feedbackDetail(question);
  const canRetryThisRound = !session.limit || session.answers.length + 3 < session.limit;
  ui.feedbackPoints.textContent = points ? `+${points}点${session.combo >= 2 ? `・${session.combo}コンボ` : ""}` : canRetryThisRound ? "3問はさんで、もう一度出題します" : "次回、優先して復習します";
  $("next-question-button").textContent = session.limit && session.answers.length >= session.limit ? "結果を見る" : "次の問題";
  ui.feedback.showModal();
}

function feedbackDetail(question) {
  const pref = question.prefecture;
  if (question.skill === "A") return `正解は「${pref.name}」。輪郭をもう一度確認しましょう。`;
  if (question.skill === "B") return `${pref.name}は${pref.region}にあります。`;
  if (question.skill === "C") return `${pref.name}の県庁所在地は${pref.capital}です。`;
  if (question.skill === "D") return `${pref.name}は本アプリの区分では${pref.region}です。`;
  return `農林水産省の郷土料理百選では、${pref.name}から${pref.dish}が選ばれています。`;
}

function nextAfterFeedback() {
  ui.feedback.close();
  if (session.limit && session.answers.length >= session.limit) finishGame();
  else { session.answered = false; renderQuestion(); }
}

function startGame(limit) {
  session = {
    limit, answers: [], retries: [],
    recentCodes: saved.recent.slice(0, 3).map((item) => item.code),
    recentTypes: saved.recent.slice(0, 2).map((item) => item.type),
    score: 0, combo: 0, maxCombo: 0, answered: false, current: null, deadline: 0, startedAt: 0,
    selectedLocation: "", locationLocked: false
  };
  renderQuestion();
}

function finishGame() {
  cancelAnimationFrame(timerFrame);
  questionToken += 1;
  if (ui.feedback.open) ui.feedback.close();
  if (!session?.answers.length) { session = null; renderHome(); showScreen(ui.home); return; }
  const correct = session.answers.filter((answer) => answer.correct).length;
  const timeouts = session.answers.filter((answer) => answer.timedOut).length;
  const isRecord = session.limit === 10 && session.answers.length === 10 && session.score > saved.highScore;
  if (isRecord) { saved.highScore = session.score; persist(); playTone("record"); }
  $("result-title").textContent = `${session.answers.length}問おつかれさま！`;
  $("result-score").textContent = session.score;
  $("result-record").hidden = !isRecord;
  $("result-correct").textContent = `${correct}/${session.answers.length}`;
  $("result-rate").textContent = `${Math.round(correct / session.answers.length * 100)}%`;
  $("result-combo").textContent = session.maxCombo;
  $("result-timeouts").textContent = timeouts;
  const weakest = weakestItems(1)[0];
  $("result-review").textContent = weakest ? `${weakest.prefecture.name}の「${SKILLS[weakest.skill].name}」を優先して復習します。` : "次は新しい都道府県に挑戦します。";
  showScreen(ui.result);
  renderHome();
}

function weakestItems(limit = 8) {
  return Object.entries(saved.progress).filter(([, item]) => item.attempts).map(([key, item]) => {
    const [code, skill] = key.split(":");
    return { prefecture: prefectures.find((prefecture) => prefecture.code === code), skill, ...item };
  }).filter((item) => item.prefecture).sort((a, b) => a.mastery - b.mastery || b.attempts - a.attempts).slice(0, limit);
}

function renderProgress() {
  const container = $("skill-progress");
  container.innerHTML = "";
  Object.entries(SKILLS).forEach(([code, skill]) => {
    const items = prefectures.map((prefecture) => getProgress(prefecture.code, code));
    const attempts = items.reduce((sum, item) => sum + item.attempts, 0);
    const correct = items.reduce((sum, item) => sum + item.correct, 0);
    const mastery = items.reduce((sum, item) => sum + (item.mastery || 0), 0) / 47;
    const row = document.createElement("div");
    row.className = "skill-row";
    const status = totalAttempts() < skill.unlockAt ? `${skill.unlockAt}問で解放` : `${attempts}問`;
    row.innerHTML = `<span class="skill-code">${code}</span><div><div class="skill-name"><span>${skill.name}</span><span>${status}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.round(mastery * 100)}%"></div></div></div><span class="skill-rate">${attempts ? `${Math.round(correct / attempts * 100)}%` : "—"}</span>`;
    container.append(row);
  });
  const weak = weakestItems();
  $("weak-prefectures").innerHTML = weak.length ? weak.map((item) => `<span>${item.prefecture.name}・${SKILLS[item.skill].name}</span>`).join("") : '<p class="empty-note">まだ記録がありません。まずは10問遊んでみましょう。</p>';
}

function playTone(kind) {
  if (!saved.settings.sound) return;
  try {
    audioContext ||= new AudioContext();
    const notes = kind === "correct" ? [523, 659, 784] : kind === "record" ? [523, 659, 784, 1047] : [220, 185];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = kind === "incorrect" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, audioContext.currentTime + index * .08);
      gain.gain.exponentialRampToValueAtTime(.09, audioContext.currentTime + index * .08 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + index * .08 + .14);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(audioContext.currentTime + index * .08);
      oscillator.stop(audioContext.currentTime + index * .08 + .15);
    });
  } catch (_) { saved.settings.sound = false; persist(); }
}

function randomOf(items) { return items[Math.floor(Math.random() * items.length)]; }
function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}

$("retry-button").addEventListener("click", loadData);
$("start-ten-button").addEventListener("click", () => startGame(10));
$("start-endless-button").addEventListener("click", () => startGame(null));
ui.submit.addEventListener("click", submitSelectedAnswer);
$("next-question-button").addEventListener("click", nextAfterFeedback);
$("quit-game-button").addEventListener("click", finishGame);
$("replay-button").addEventListener("click", () => startGame(10));
$("result-home-button").addEventListener("click", () => { session = null; showScreen(ui.home); });
$("home-button").addEventListener("click", () => { cancelAnimationFrame(timerFrame); questionToken += 1; if (ui.feedback.open) ui.feedback.close(); session = null; renderHome(); showScreen(ui.home); });

$("settings-button").addEventListener("click", () => {
  if (!ui.game.hidden) return;
  $("sound-setting").checked = saved.settings.sound;
  $("answer-mode-setting").value = saved.settings.answerMode;
  ui.settings.showModal();
});
$("sound-setting").addEventListener("change", (event) => { saved.settings.sound = event.target.checked; persist(); if (event.target.checked) playTone("correct"); });
$("answer-mode-setting").addEventListener("change", (event) => { saved.settings.answerMode = event.target.value; persist(); });
$("progress-button").addEventListener("click", () => { if (!ui.game.hidden) return; renderProgress(); ui.progress.showModal(); });
$("reset-data-button").addEventListener("click", () => ui.resetConfirm.showModal());
$("cancel-reset-button").addEventListener("click", () => ui.resetConfirm.close());
$("confirm-reset-button").addEventListener("click", () => {
  saved = freshSaved(); persist(); ui.resetConfirm.close(); ui.settings.close(); renderHome();
});

document.addEventListener("keydown", (event) => {
  if (ui.feedback.open || ui.settings.open || ui.progress.open || ui.resetConfirm.open || ui.game.hidden || !session || session.answered) return;
  const number = Number(event.key);
  if (number >= 1 && number <= 4) {
    const input = ui.answerGrid.querySelectorAll('input[name="answer"]')[number - 1];
    if (input) { input.checked = true; input.dispatchEvent(new Event("change")); }
  } else if (event.key === "Enter" && !ui.submit.hidden) {
    event.preventDefault(); submitSelectedAnswer();
  }
});

ui.feedback.addEventListener("cancel", (event) => event.preventDefault());

loadData();
