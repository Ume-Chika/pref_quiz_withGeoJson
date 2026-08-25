"use strict";

import { blankProgress, canIntroduceNewItem, canUseIntegratedMode, compassVector, deadlinePassed, examScore, geometryRepresentativePoint, hasBasicMastery, normalizeProgress, prefectureUnderstanding, recordAnswer, schedulingPriority, skillsForMastery, understandingIndex, understandingMilestone } from "./learning.mjs";

const STORAGE_KEY = "prefecture-minigame-v2";
const QUESTION_SECONDS = 15;
const SKILLS = {
  A: { name: "形", unlockAt: 0 }, B: { name: "位置", unlockAt: 0 }, C: { name: "県庁所在地", unlockAt: 3 }, D: { name: "地方区分", unlockAt: 8 }, E: { name: "郷土料理", unlockAt: 15 }
};
const LOCATION_TYPES = ["locate", "locateJapan", "mapMemory", "shapeLocate", "capitalLocate", "dishLocate"];
const NATIONWIDE_LOCATION_TYPES = ["locateJapan", "shapeLocate", "capitalLocate", "dishLocate"];
const ANIMATED_TYPES = ["spotlight", "reveal", "flash", "slitFlow", "mapMemory", "mapFlash", "shapeLocate"];
const EXAM_TYPES = { A: "silhouette", B: "mapChoice", C: "capital", D: "region", E: "dishReverse" };
const EXAM_REGION_COUNTS = { "北海道地方": 1, "東北地方": 4, "関東地方": 4, "中部地方": 6, "近畿地方": 4, "中国地方": 3, "四国地方": 3, "九州地方": 5 };

const $ = (id) => document.getElementById(id);
const screens = ["loading-screen", "error-screen", "home-screen", "game-screen", "result-screen"].map($);
const ui = {
  app: $("app"), loading: $("loading-screen"), error: $("error-screen"), errorMessage: $("error-message"),
  home: $("home-screen"), game: $("game-screen"), result: $("result-screen"), heroMap: $("hero-map"),
  understanding: $("understanding-index"), understandingStage: $("understanding-stage"), challenged: $("challenged-count"), learning: $("learning-count"), reviewCount: $("review-count"), examSummary: $("exam-summary"), reviewHint: $("next-review-hint"),
  questionNumber: $("question-number"), comboLabel: $("combo-label"), combo: $("combo-count"), scoreLabel: $("score-label"), score: $("score-count"), timer: $("timer-bar"), timerRoot: $("timer"), timerText: $("timer-text"),
  type: $("quiz-type"), title: $("question-title"), help: $("question-help"), stage: $("visual-stage"),
  answerFieldset: $("answer-fieldset"), answerGrid: $("answer-grid"), submit: $("submit-answer-button"), keyboardHint: $("keyboard-hint"),
  feedback: $("feedback-dialog"), feedbackMark: $("feedback-mark"), feedbackKicker: $("feedback-kicker"),
  feedbackTitle: $("feedback-title"), feedbackDetail: $("feedback-detail"), feedbackComparison: $("feedback-comparison"), feedbackPoints: $("feedback-points"),
  settings: $("settings-dialog"), progress: $("progress-dialog"), studyMap: $("study-map-dialog"), studyMapCanvas: $("study-map-canvas"), resetConfirm: $("confirm-reset-dialog")
};

let geoData = null;
let prefectures = [];
let facts = [];
let saved = loadSaved();
let timerFrame = 0;
let questionToken = 0;
let audioContext = null;
let session = null;
let studyMapZoom = 1;

function freshSaved() {
  return { schema: 2, settings: { sound: false, volume: .5, answerMode: "confirm", visualEffects: true }, progress: {}, examScores: [], unlockedBasic: 0, recent: [], pendingReviews: [] };
}

function normalizePendingReviews(value) {
  if (!Array.isArray(value)) return [];
  const reviews = [];
  value.forEach((item) => {
    if (!item || !/^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.code) || !SKILLS[item.skill]) return;
    const review = { code: item.code, skill: item.skill, type: ["silhouette", "map"].includes(item.type) ? item.type : "", remaining: Math.floor(finiteNumber(item.remaining, 0, 0, 3)) };
    const previous = reviews.find((candidate) => candidate.code === review.code && candidate.skill === review.skill);
    if (!previous) reviews.push(review);
    else if (review.remaining < previous.remaining) Object.assign(previous, review);
  });
  return reviews.slice(0, 20);
}

function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object" || parsed.schema !== 2) return freshSaved();
    const progress = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed.progress || {})) {
      if (/^(0[1-9]|[1-3]\d|4[0-7]):[A-E]$/.test(key)) {
        const item = normalizeProgress(value);
        if (item.lastSeen > now) {
          item.nextDue = now + Math.max(0, item.nextDue - item.lastSeen);
          item.lastSeen = now;
        }
        item.nextDue = Math.min(item.nextDue, now + 30 * 86_400_000);
        progress[key] = item;
      }
    }
    const inferredUnlock = Object.entries(progress).some(([key, item]) => key.endsWith(":E") && item.attempts) ? 15
      : Object.entries(progress).some(([key, item]) => key.endsWith(":D") && item.attempts) ? 8
      : Object.entries(progress).some(([key, item]) => key.endsWith(":C") && item.attempts) ? 3 : 0;
    return {
      ...freshSaved(), ...parsed,
      settings: {
        sound: parsed.settings?.sound === true,
        volume: finiteNumber(parsed.settings?.volume, .5, .1, 1),
        answerMode: ["confirm", "instant"].includes(parsed.settings?.answerMode) ? parsed.settings.answerMode : "confirm",
        visualEffects: parsed.settings?.visualEffects !== false
      },
      progress,
      highScore: undefined,
      examScores: Array.isArray(parsed.examScores) ? parsed.examScores.map((score) => Math.round(finiteNumber(score, 0, 0, 1000))).slice(0, 3) : [],
      unlockedBasic: Math.max(inferredUnlock, Math.floor(finiteNumber(parsed.unlockedBasic, 0, 0, 47))),
      pendingReviews: normalizePendingReviews(parsed.pendingReviews),
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((item) => item && /^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.code) && SKILLS[item.skill] && typeof item.type === "string").slice(0, 30).map((item) => ({
        code: item.code, skill: item.skill, type: item.type.slice(0, 40), correct: item.correct === true, timedOut: item.timedOut === true,
        newItem: item.newItem === true, at: finiteNumber(item.at, 0, 0, Date.now() + 86_400_000),
        answer: typeof item.answer === "string" ? item.answer.slice(0, 80) : "",
        selectedCode: /^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.selectedCode) ? item.selectedCode : ""
      })) : []
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

function applyVisualEffects() {
  document.documentElement.classList.toggle("reduce-motion", !saved.settings.visualEffects);
}

applyVisualEffects();

function showScreen(target) {
  screens.forEach((screen) => { screen.hidden = screen !== target; });
  const playing = target === ui.game;
  $("home-button").disabled = playing || !prefectures.length;
  $("settings-button").disabled = playing || !prefectures.length;
  $("progress-button").disabled = playing || !prefectures.length;
  $("study-map-button").disabled = playing || !prefectures.length;
  $("start-exam-button").disabled = !prefectures.length;
  requestAnimationFrame(() => ui.app.focus({ preventScroll: true }));
  window.scrollTo({ top: 0, behavior: saved.settings.visualEffects ? "smooth" : "auto" });
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
        center: geometryRepresentativePoint(mainGeometry), shape: shapeStats(mainGeometry)
      };
    }).sort((a, b) => Number(a.code) - Number(b.code));
    unlockedBasicCount();
    persist();
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

function silhouetteGeometry(prefecture) {
  const geometry = prefecture.feature.geometry;
  if (geometry.type === "Polygon") return geometry;
  const mainBounds = boundsOf([prefecture.mainGeometry]);
  const nearbyBounds = expandedBounds(mainBounds, 2.5);
  const coordinates = geometry.coordinates.filter((polygon) => {
    const center = geometryRepresentativePoint({ type: "Polygon", coordinates: polygon });
    return center[0] >= nearbyBounds.minX && center[0] <= nearbyBounds.maxX
      && center[1] >= nearbyBounds.minY && center[1] <= nearbyBounds.maxY;
  });
  return { type: "MultiPolygon", coordinates };
}

function silhouetteViewBounds(prefecture) {
  return expandedBounds(boundsOf([silhouetteGeometry(prefecture)]), .62);
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

function svgMap(features, viewBounds, { width = 700, height = 470, targetCode = "", targetCodes = [], clickable = false, label = "日本地図" } = {}) {
  const project = projector(viewBounds, width, height);
  const paths = features.map((prefecture, index) => {
    const isTarget = prefecture.code === targetCode || targetCodes.includes(prefecture.code);
    const [centerX, centerY] = project(prefecture.center);
    const attrs = clickable ? `tabindex="${index ? -1 : 0}" role="button" data-code="${prefecture.code}" data-center-x="${centerX.toFixed(2)}" data-center-y="${centerY.toFixed(2)}" aria-label="${prefecture.name}"` : `data-map-code="${prefecture.code}"`;
    return `<path class="map-prefecture${isTarget ? " target" : ""}${clickable ? " clickable" : ""}" d="${geometryPath(prefecture.feature.geometry, project)}" ${attrs}/>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="${clickable ? "group" : "img"}" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

function silhouetteSvg(prefecture, effect = "plain") {
  const width = 650;
  const height = 410;
  const geometry = silhouetteGeometry(prefecture);
  const project = projector(silhouetteViewBounds(prefecture), width, height, 38);
  const path = geometryPath(geometry, project);
  if (!saved.settings.visualEffects) effect = "plain";
  if (effect === "spotlight") {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="暗闇を動くスポットライトで照らされた都道府県の形">
      <defs><mask id="moving-spot"><rect width="100%" height="100%" fill="black"/><circle cy="205" r="92" fill="white"><animate attributeName="cx" values="40;610;150;500;40" dur="7s" repeatCount="indefinite"/><animate attributeName="cy" values="90;260;330;100;90" dur="5.3s" repeatCount="indefinite"/></circle></mask></defs>
      <path class="spotlight-path" d="${path}" mask="url(#moving-spot)"/>
    </svg>`;
  }
  if (effect === "reveal") {
    const [revealX, revealY] = randomOf(coordinatesOf(prefecture.mainGeometry).map(project));
    const revealRadius = Math.max(...coordinatesOf(geometry).map((point) => {
      const [x, y] = project(point);
      return Math.hypot(x - revealX, y - revealY);
    })) + 8;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="徐々に姿を現す都道府県の形">
      <defs><mask id="reveal-mask"><rect width="100%" height="100%" fill="black"/><circle cx="${revealX.toFixed(2)}" cy="${revealY.toFixed(2)}" r="0" fill="white"><animate attributeName="r" from="0" to="${revealRadius.toFixed(2)}" dur="12s" fill="freeze"/></circle></mask></defs>
      <path class="silhouette" d="${path}" mask="url(#reveal-mask)"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="都道府県のシルエット"><path class="silhouette" d="${path}" fill-rule="evenodd"/></svg>`;
}

function renderHeroMap() {
  ui.heroMap.innerHTML = svgMap(prefectures, boundsOf(prefectures), { width: 500, height: 500, label: "" });
}

function renderStudyMap() {
  const recent = saved.recent.slice(0, 10);
  const canvas = ui.studyMapCanvas;
  canvas.innerHTML = svgMap(prefectures, boundsOf(prefectures), { width: 700, height: 540, clickable: true, label: "都道府県ごとの現在習熟度を示す日本白地図" });
  setStudyMapZoom(1);
  const svg = canvas.querySelector("svg");
  const paths = [...svg.querySelectorAll(".map-prefecture[data-code]")];
  const statusMap = getStudyMapMasteryStatuses();
  paths.forEach((path) => {
    const prefecture = prefectures.find((item) => item.code === path.dataset.code);
    const status = prefectureMasteryStatus(prefecture, statusMap);
    path.dataset.mastery = status.kind;
    path.setAttribute("aria-label", `${prefecture.name}、${status.label}、理解度${status.index}`);
  });
  renderStudyMapColors(paths);

  let isDragging = false;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;

  canvas.onpointerdown = (event) => {
    if (studyMapZoom <= 1 || event.button !== 0) return;
    isDragging = true;
    hasDragged = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    scrollStartX = canvas.scrollLeft;
    scrollStartY = canvas.scrollTop;
    canvas.classList.add("is-dragging");
  };

  window.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasDragged = true;
    }
    canvas.scrollLeft = scrollStartX - dx;
    canvas.scrollTop = scrollStartY - dy;
  });

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    canvas.classList.remove("is-dragging");
  };
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);

  const showCode = (code) => {
    const prefecture = prefectures.find((item) => item.code === code);
    if (!prefecture) return;
    paths.forEach((path) => {
      path.classList.toggle("selected", path.dataset.code === code);
      if (path.dataset.code === code) path.setAttribute("aria-current", "true");
      else path.removeAttribute("aria-current");
    });
    renderStudyMapDetail(prefecture, recent);
  };
  svg.addEventListener("pointerover", (event) => {
    if (isDragging) return;
    showCode(event.target.closest?.("[data-code]")?.dataset.code);
  });
  svg.addEventListener("focusin", (event) => showCode(event.target.closest?.(".map-prefecture[data-code]")?.dataset.code));
  svg.addEventListener("click", (event) => {
    if (hasDragged) { hasDragged = false; return; }
    const hitCode = event.target.closest?.(".map-prefecture[data-code]")?.dataset.code;
    if (hitCode) { showCode(hitCode); return; }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const nearest = paths.map((path) => ({ code: path.dataset.code, distance: Math.hypot(point.x - Number(path.dataset.centerX), point.y - Number(path.dataset.centerY)) })).sort((a, b) => a.distance - b.distance)[0];
    if (nearest) showCode(nearest.code);
  });
  paths.forEach((path) => path.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showCode(path.dataset.code); }
    else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const nextCode = spatialNeighbor(path.dataset.code, event.key, prefectures);
      const next = paths.find((item) => item.dataset.code === nextCode);
      if (next) {
        paths.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
        next.focus();
      }
    }
  }));
  const initial = prefectures.find((item) => item.code === recent[0]?.code) || prefectures[0];
  const initialPath = paths.find((path) => path.dataset.code === initial.code);
  if (initialPath) paths.forEach((path) => { path.tabIndex = path === initialPath ? 0 : -1; });
  showCode(initial.code);
}

function setStudyMapZoom(nextZoom) {
  const canvas = ui.studyMapCanvas;
  const svg = canvas.querySelector("svg");
  studyMapZoom = Math.max(1, Math.min(2.5, nextZoom));
  canvas.classList.toggle("is-zoomed", studyMapZoom > 1);
  if (svg) {
    const centerX = canvas.scrollWidth ? (canvas.scrollLeft + canvas.clientWidth / 2) / canvas.scrollWidth : .5;
    const centerY = canvas.scrollHeight ? (canvas.scrollTop + canvas.clientHeight / 2) / canvas.scrollHeight : .5;
    const isMobile = matchMedia("(max-width: 620px)").matches;
    if (isMobile) {
      svg.style.width = `${studyMapZoom * 100}%`;
      svg.style.height = `${studyMapZoom * 300}px`;
    } else {
      svg.style.width = `${studyMapZoom * 100}%`;
      svg.style.height = `${studyMapZoom * 100}%`;
    }
    requestAnimationFrame(() => {
      canvas.scrollLeft = centerX * canvas.scrollWidth - canvas.clientWidth / 2;
      canvas.scrollTop = centerY * canvas.scrollHeight - canvas.clientHeight / 2;
    });
  }
  $("study-map-zoom-value").textContent = `${Math.round(studyMapZoom * 100)}%`;
  $("study-map-zoom").value = String(studyMapZoom);
  $("study-map-zoom-out").disabled = studyMapZoom <= 1;
  $("study-map-zoom-in").disabled = studyMapZoom >= 2.5;
  $("study-map-zoom-reset").disabled = studyMapZoom === 1;
}

function getStudyMapMasteryStatuses() {
  const statusMap = new Map();
  const attemptedList = [];
  for (const prefecture of prefectures) {
    const items = Object.keys(SKILLS).map((skill) => getProgress(prefecture.code, skill));
    const attempted = items.some((item) => item.attempts > 0);
    const score = prefectureUnderstanding(saved.progress, prefecture.code);
    const index = Math.round(score * 1000);
    if (attempted) {
      attemptedList.push({ prefecture, score, index });
    } else {
      statusMap.set(prefecture.code, { kind: "unlearned", label: "未学習", index });
    }
  }
  const N = attemptedList.length;
  if (N > 0) {
    attemptedList.sort((a, b) => b.score - a.score);
    const k = Math.floor(N * 0.2);
    if (k === 0) {
      for (const item of attemptedList) {
        statusMap.set(item.prefecture.code, { kind: "learning", label: "学習中", index: item.index });
      }
    } else {
      const topThreshold = attemptedList[k - 1].score;
      const bottomThreshold = attemptedList[N - k].score;
      for (let i = 0; i < N; i++) {
        const item = attemptedList[i];
        if (topThreshold > bottomThreshold && i < k) {
          statusMap.set(item.prefecture.code, { kind: "strong", label: "得意", index: item.index });
        } else if (topThreshold > bottomThreshold && i >= N - k) {
          statusMap.set(item.prefecture.code, { kind: "weak", label: "苦手", index: item.index });
        } else {
          statusMap.set(item.prefecture.code, { kind: "learning", label: "学習中", index: item.index });
        }
      }
    }
  }
  return statusMap;
}

function prefectureMasteryStatus(prefecture, statusMap = getStudyMapMasteryStatuses()) {
  return statusMap.get(prefecture.code) || { kind: "unlearned", label: "未学習", index: 0 };
}

function renderStudyMapColors(paths = [...ui.studyMapCanvas.querySelectorAll(".map-prefecture[data-code]")]) {
  const showStrong = $("study-map-show-strong").checked;
  const showWeak = $("study-map-show-weak").checked;
  paths.forEach((path) => {
    path.classList.toggle("mastery-strong", showStrong && path.dataset.mastery === "strong");
    path.classList.toggle("mastery-weak", showWeak && path.dataset.mastery === "weak");
  });
}

function renderStudyMapDetail(prefecture, recent) {
  const history = recent.map((item, index) => ({ ...item, ago: index + 1 })).filter((item) => item.code === prefecture.code);
  const status = prefectureMasteryStatus(prefecture);
  $("study-map-status").textContent = `${status.label}・理解度 ${status.index}/1000`;
  $("study-map-status").className = `study-map-status ${status.kind}`;
  $("study-map-name").textContent = prefecture.name;
  $("study-map-region").textContent = prefecture.region;
  $("study-map-capital").textContent = prefecture.capital;
  $("study-map-dish").textContent = prefecture.dish;
  const list = $("study-map-history");
  list.replaceChildren();
  if (!history.length) {
    const item = document.createElement("li");
    item.textContent = "この県の記録はまだありません";
    list.append(item);
  } else history.forEach((record) => {
    const item = document.createElement("li");
    const result = document.createElement("strong");
    result.textContent = record.correct ? "○ 正解" : record.timedOut ? "× 時間切れ" : "× 不正解";
    item.append(result, `${record.ago}問前・${SKILLS[record.skill].name}`);
    list.append(item);
  });
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
  const learning = new Set(Object.entries(saved.progress).filter(([, item]) => item.attempts).map(([key]) => key.slice(0, 2))).size;
  const index = understandingIndex(saved.progress);
  const now = Date.now();
  const dueKeys = new Set(Object.entries(saved.progress).filter(([, item]) => item.attempts && item.nextDue <= now).map(([key]) => key));
  saved.pendingReviews.forEach((review) => dueKeys.add(`${review.code}:${review.skill}`));
  const due = dueKeys.size;
  const examAverage = saved.examScores.length ? Math.round(saved.examScores.reduce((sum, score) => sum + score, 0) / saved.examScores.length) : null;
  ui.understanding.textContent = index;
  ui.understandingStage.textContent = index ? index < 250 ? "学び始め" : index < 500 ? "基礎形成中" : index < 750 ? "定着中" : index < 900 ? "応用中" : "総仕上げ" : "未学習";
  ui.challenged.textContent = learning;
  ui.learning.textContent = `基本を習得 ${basicMasteredCount()}県`;
  ui.reviewCount.textContent = due;
  ui.examSummary.textContent = examAverage === null ? "全5分野・約8分・答え合わせは最後" : `直近${saved.examScores.length}回平均 ${examAverage}/1000`;
  ui.reviewHint.textContent = due ? `復習のタイミングが来た問題が${due}件あります。` : attempts ? "学習状況に合わせて次の問題を選びます。" : "最初は基本の形と位置から出題します。";
}

function unlockedSkills() {
  return skillsForMastery(unlockedBasicCount());
}

function basicMasteredCount() {
  return prefectures.filter((prefecture) => hasBasicMastery(getProgress(prefecture.code, "A").mastery, getProgress(prefecture.code, "B").mastery)).length;
}

function unlockedBasicCount() {
  const count = Math.max(saved.unlockedBasic, basicMasteredCount());
  if (count !== saved.unlockedBasic) { saved.unlockedBasic = count; persist(); }
  return count;
}

function chooseQuestion() {
  const forced = ["localhost", "127.0.0.1"].includes(location.hostname) ? globalThis.__prefQuizTest : null;
  if (forced?.type && SKILLS[forced.skill]) {
    const prefecture = prefectures.find((item) => item.code === forced.code) || prefectures[0];
    return buildQuestion(prefecture, forced.skill, forced.type);
  }
  const dueRetryIndex = session.retries.findIndex((retry) => retry.dueAt <= session.answers.length + 1);
  if (dueRetryIndex >= 0) {
    const retry = session.retries.splice(dueRetryIndex, 1)[0];
    const question = buildQuestion(prefectures.find((prefecture) => prefecture.code === retry.code), retry.skill, retry.type || "");
    question.pendingReview = retry;
    return question;
  }
  const now = Date.now();
  const recentCodes = session.recentCodes.slice(-3);
  const recentTypes = session.recentTypes.slice(-2);
  const skills = unlockedSkills();
  const hasEligiblePractice = skills.some((skill) => prefectures.some((prefecture) => getProgress(prefecture.code, skill).attempts));
  const hasRetryRoom = !session.limit || session.answers.length + 4 < session.limit;
  const allowUnseen = hasRetryRoom && (canIntroduceNewItem(saved.recent) || !hasEligiblePractice);
  const candidates = skills.flatMap((skill) => prefectures.map((prefecture) => {
    const item = getProgress(prefecture.code, skill);
    const basicReady = ["A", "B"].includes(skill) || hasBasicMastery(getProgress(prefecture.code, "A").mastery, getProgress(prefecture.code, "B").mastery);
    const waiting = saved.pendingReviews.some((review) => review.code === prefecture.code && review.skill === skill && review.remaining > 0);
    const bucket = waiting ? 0 : item.attempts && item.nextDue <= now ? 3 : item.attempts ? 1 : allowUnseen && basicReady ? 2 : 0;
    return { prefecture, skill, bucket, priority: schedulingPriority(item, { now, recentlyShown: recentCodes.includes(prefecture.code) }) };
  })).filter(({ bucket }) => bucket > 0);
  if (!candidates.length) {
    const retry = session.retries.sort((a, b) => a.dueAt - b.dueAt).shift();
    const question = retry ? buildQuestion(prefectures.find((prefecture) => prefecture.code === retry.code), retry.skill, retry.type) : buildQuestion(prefectures[0], "A");
    if (retry) question.pendingReview = retry;
    return question;
  }
  const alternatives = candidates.filter(({ prefecture }) => prefecture.code !== recentCodes.at(-1));
  const eligible = alternatives.length ? alternatives : candidates;
  eligible.sort((a, b) => b.bucket - a.bucket || b.priority - a.priority);
  const bestBucket = eligible[0]?.bucket;
  const pool = eligible.filter(({ bucket }) => bucket === bestBucket).slice(0, 12);
  let question = null;
  for (const candidate of shuffle(pool)) {
    const built = buildQuestion(candidate.prefecture, candidate.skill);
    if (!recentTypes.includes(built.type)) { question = built; break; }
    question ||= built;
  }
  return question;
}

function buildExamQuestions() {
  const skills = Array.from({ length: 6 }, () => shuffle(Object.keys(SKILLS))).flat();
  const sample = shuffle(Object.entries(EXAM_REGION_COUNTS).flatMap(([region, count]) => shuffle(prefectures.filter((prefecture) => prefecture.region === region)).slice(0, count)));
  return sample.map((prefecture, index) => {
    const skill = skills[index];
    return buildQuestion(prefecture, skill, EXAM_TYPES[skill], 1);
  });
}

function buildQuestion(prefecture, skill, forcedType = "", masteryOverride = null) {
  const item = getProgress(prefecture.code, skill);
  const mastery = masteryOverride ?? item.mastery ?? 0;
  let type;
  if (skill === "A") {
    const modes = !item.attempts ? ["shapeMemory"] : mastery < .15 ? ["silhouette", "reveal"] : mastery < .45 ? ["silhouette", "reveal", "slitFlow", "spotlight", "silhouetteReverse"] : ["spotlight", "flash", "slitFlow", "reveal", "silhouette", "silhouetteReverse"];
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "B").mastery)) modes.push("mapShape");
    type = randomMode(modes, "silhouette");
  } else if (skill === "B") {
    const modes = !item.attempts ? ["map"] : mastery < .2 ? ["map", "mapMemory"] : mastery < .55 ? ["map", "mapChoice", "locate", "mapMemory", "mapFlash"] : ["map", "mapChoice", "locate", "locateJapan", "mapMemory", "mapFlash", "compass"];
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "A").mastery)) modes.push("shapeLocate");
    type = randomMode(modes, "map");
  } else if (skill === "C") {
    const modes = ["capital", "capitalReverse"];
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "A").mastery)) modes.push("capitalShape");
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "B").mastery)) modes.push("capitalMap", "capitalLocate");
    type = randomMode(modes, "capital");
  } else if (skill === "D") {
    const modes = ["region", "regionMember"];
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "A").mastery)) modes.push("shapeRegion");
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "B").mastery)) modes.push("regionMap", "regionShape");
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "C").mastery)) modes.push("capitalRegion");
    type = randomMode(modes, "region");
  } else {
    const modes = ["dish", "dishReverse"];
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "B").mastery)) modes.push("dishMap", "dishLocate");
    if (canUseIntegratedMode(mastery, getProgress(prefecture.code, "A").mastery)) modes.push("dishShapeChoice");
    type = randomMode(modes, "dish");
  }
  type = forcedType || type;

  const question = { prefecture, skill, type, isNew: masteryOverride === null && !item.attempts, choices: [], correct: "" };
  if (["shapeMemory", "silhouette", "reveal", "spotlight", "flash", "slitFlow", "silhouetteReverse", "mapShape", "map", "mapChoice", "mapFlash", ...LOCATION_TYPES].includes(type)) {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, type === "mapChoice" ? Math.max(.3, mastery) : mastery, skill === "A" ? "shape" : "geo", skill);
  } else if (["capital", "capitalMap", "capitalShape"].includes(type)) {
    question.correct = prefecture.capital;
    question.choices = valueChoices(prefecture, "capital", mastery);
  } else if (type === "capitalReverse") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "C");
  } else if (["region", "regionMap", "regionShape", "capitalRegion", "shapeRegion"].includes(type)) {
    question.correct = prefecture.region;
    question.choices = shuffle([prefecture.region, ...shuffle([...new Set(facts.map((fact) => fact.region))].filter((region) => region !== prefecture.region)).slice(0, 3)]);
  } else if (type === "regionMember") {
    question.correct = prefecture.name;
    question.choices = shuffle([prefecture.name, ...shuffle(prefectures.filter((item) => item.region !== prefecture.region)).slice(0, 3).map((item) => item.name)]);
  } else if (type === "dish") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "E");
  } else if (type === "dishShapeChoice") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "shape", "E");
  } else if (["dishReverse", "dishMap"].includes(type)) {
    question.correct = prefecture.dish;
    question.choices = valueChoices(prefecture, "dish", mastery);
  } else if (type === "compass") {
    const candidates = prefectures.filter((item) => item.code !== prefecture.code);
    const ranked = candidates.map((item) => ({ item, ...compassVector(prefecture.center, item.center) })).sort((a, b) => a.distance - b.distance);
    question.reference = ranked.find(({ margin }) => margin >= 7.5)?.item || ranked[0].item;
    const { dx, dy } = compassVector(prefecture.center, question.reference.center);
    const directions = ["東", "北東", "北", "北西", "西", "南西", "南", "南東"];
    question.correct = directions[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    question.choices = shuffle([question.correct, ...shuffle(directions.filter((direction) => direction !== question.correct)).slice(0, 3)]);
  }
  return question;
}

function recentConfusion(target, skill) {
  if (session?.mode === "exam") return null;
  const latest = saved.recent.find((item) => item.code === target.code && item.skill === skill);
  return latest && !latest.correct && latest.selectedCode && latest.selectedCode !== target.code ? prefectures.find((item) => item.code === latest.selectedCode) : null;
}

function nameChoices(target, mastery, strategy = "geo", skill = "") {
  const candidates = prefectures.filter((item) => item.code !== target.code).map((item) => ({
    item,
    regionPenalty: item.region === target.region ? 0 : 12,
    distance: Math.hypot(item.center[0] - target.center[0], item.center[1] - target.center[1]),
    shapeDistance: Math.abs(Math.log(item.shape.aspect / target.shape.aspect)) + Math.abs(item.shape.fill - target.shape.fill) * 2
  }));
  if (mastery > .25) candidates.sort((a, b) => strategy === "shape" ? a.shapeDistance - b.shapeDistance : (a.regionPenalty + a.distance) - (b.regionPenalty + b.distance));
  else candidates.sort(() => Math.random() - .5);
  const confusion = recentConfusion(target, skill);
  const ordered = confusion ? [{ item: confusion }, ...candidates.filter(({ item }) => item.code !== confusion.code)] : candidates;
  return shuffle([target.name, ...ordered.slice(0, 3).map(({ item }) => item.name)]);
}

function valueChoices(target, field, mastery = 0) {
  const sameRegion = shuffle(prefectures.filter((item) => item.code !== target.code && item.region === target.region));
  const others = shuffle(prefectures.filter((item) => item.code !== target.code && item.region !== target.region));
  const candidates = mastery > .35 ? [...sameRegion, ...others] : shuffle([...sameRegion, ...others]);
  const confusion = recentConfusion(target, field === "capital" ? "C" : "E");
  const ordered = confusion ? [confusion, ...candidates.filter((item) => item.code !== confusion.code)] : candidates;
  return shuffle([target[field], ...ordered.slice(0, 3).map((item) => item[field])]);
}

function regionPrefectures(prefecture) {
  return prefectures.filter((item) => prefecture.region === "北海道地方" ? ["北海道地方", "東北地方"].includes(item.region) : item.region === prefecture.region);
}

function renderQuestion() {
  cancelAnimationFrame(timerFrame);
  const token = ++questionToken;
  session.current = session.mode === "exam" ? session.examQuestions[session.answers.length] : chooseQuestion();
  const question = session.current;
  ui.game.dataset.quizType = question.type;
  ui.game.dataset.code = question.prefecture.code;
  ui.game.dataset.skill = question.skill;
  session.selectedLocation = "";
  session.locationLocked = false;
  if (session.mode !== "exam") {
    session.recentCodes.push(question.prefecture.code);
    session.recentTypes.push(question.type);
  }
  ui.questionNumber.textContent = session.limit ? `${session.answers.length + 1}/${session.limit}` : `${session.answers.length + 1}/∞`;
  ui.comboLabel.textContent = session.mode === "exam" ? "分野" : "連続正解";
  ui.combo.textContent = session.mode === "exam" ? question.skill : session.combo;
  ui.scoreLabel.textContent = session.mode === "exam" ? "回答済み" : "正解";
  ui.score.textContent = session.mode === "exam" ? session.answers.length : session.answers.filter((answer) => answer.correct).length;
  ui.submit.disabled = true;
  ui.submit.hidden = saved.settings.answerMode === "instant";
  ui.answerFieldset.hidden = false;
  ui.keyboardHint.innerHTML = saved.settings.answerMode === "instant" ? "<kbd>1</kbd>–<kbd>4</kbd> で回答" : "<kbd>1</kbd>–<kbd>4</kbd> 選択　<kbd>Enter</kbd> 決定";
  ui.stage.className = "visual-stage";
  setQuestionCopy(question);
  const inputDelay = session.mode === "exam" && session.answers.length ? 350 : 0;
  session.inputReadyAt = Date.now() + inputDelay;
  renderAnswers(question);
  if (session.inputReadyAt > Date.now()) {
    ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = true; });
    setTimeout(() => {
      if (token === questionToken) ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = false; });
    }, inputDelay);
  }
  session.startedAt = session.inputReadyAt;
  session.answerClockStartedAt = session.startedAt;
  session.deadline = session.startedAt + QUESTION_SECONDS * 1000;
  session.timerHoldUntil = 0;
  renderVisual(question, token);
  showScreen(ui.game);
  requestAnimationFrame(() => ui.title.focus({ preventScroll: true }));
  updateTimer(token);
}

function setQuestionCopy(question) {
  const copy = {
    shapeMemory: ["形の見本", "県名と形をセットで覚えよう", "見本が消えたら、4択で答えてください。"],
    silhouette: ["シルエット", "この都道府県はどこ？", "輪郭を見て答えてください。"],
    reveal: ["じわじわ表示", "だんだん見える県はどこ？", "輪郭上のどこかから、ゆっくり形が広がります。"],
    spotlight: ["スポットライト", "暗闇に隠れた県はどこ？", "動く光から輪郭をつかんでください。"],
    flash: ["フラッシュ記憶", "さっき見えた県はどこ？", "形は一瞬だけ表示されます。"],
    slitFlow: ["隙間シルエット", "隙間を流れていったのはどの県？", "細い隙間を通る輪郭を目で追ってください。"],
    silhouetteReverse: ["形を選ぶ", `${question.prefecture.name}の形はどれ？`, "4つの輪郭から選んでください。"],
    mapShape: ["地図→形", "黄色く光る県の形はどれ？", "位置と形を結びつけましょう。"],
    map: ["周辺地図", "黄色く光る都道府県はどこ？", "周りの県との位置関係も手がかりです。"],
    mapChoice: ["地図を選ぶ", `${question.prefecture.name}はどの地図？`, "4つの周辺地図から選んでください。"],
    locate: ["場所タップ", `${question.prefecture.name}はどこ？`, "日本地図から直接タップしてください。"],
    locateJapan: ["全国地図タップ", `${question.prefecture.name}はどこ？`, "日本全体の地図で、県の中心付近をタップしてください。"],
    mapMemory: ["地図記憶", `${question.prefecture.name}はどこ？`, "最初の2秒だけ正解の場所が光ります。"],
    shapeLocate: ["形→地図", "この形の都道府県はどこ？", "形を覚えて、全国地図から選んでください。"],
    mapFlash: ["地図フラッシュ", "さっき光った都道府県はどこ？", "位置を短時間で記憶してください。"],
    compass: ["方角", `${question.reference?.name || "基準の県"}から見て${question.prefecture.name}はどちら？`, "中心位置を基準にした、おおよその方角です。"],
    capital: ["県庁所在地", `${question.prefecture.name}の県庁所在地は？`, "正しい市区を選んでください。"],
    capitalReverse: ["逆・県庁所在地", `${question.prefecture.capital}が県庁所在地なのは？`, "都道府県名を選んでください。"],
    capitalMap: ["地図＋県庁所在地", "地図で光る県の県庁所在地は？", "位置と県庁所在地を結びつけましょう。"],
    capitalShape: ["形＋県庁所在地", "この形の県の県庁所在地は？", "形と県庁所在地を結びつけましょう。"],
    capitalLocate: ["県庁所在地→地図", `${question.prefecture.capital}が県庁所在地の都道府県はどこ？`, "日本地図から場所を選んでください。"],
    region: ["地方区分", `${question.prefecture.name}が属する地方は？`, "本アプリでは内閣府資料の8区分を使います。"],
    regionMember: ["地方区分", `${question.prefecture.region}に含まれるのは？`, "当てはまる都道府県を選んでください。"],
    regionMap: ["地方地図", "黄色い県が属する地方はどこ？", "日本全体の中の位置から地方名を答えてください。"],
    regionShape: ["地方の形", "黄色い県を含む地方はどこ？", "県境を残した地方全体の形から答えてください。"],
    shapeRegion: ["形→地方", "この形の都道府県は何地方？", "形から地方まで結びつけましょう。"],
    capitalRegion: ["県庁所在地→地方", `${question.prefecture.capital}が県庁所在地の都道府県は何地方？`, "県庁所在地から地方まで思い出してください。"],
    dish: ["郷土料理", `農林水産省の郷土料理百選で「${question.prefecture.dish}」が選ばれた都道府県は？`, "正しい都道府県を選んでください。"],
    dishReverse: ["郷土料理", `${question.prefecture.name}で選ばれた郷土料理は？`, "農林水産省の郷土料理百選から選んでください。"],
    dishMap: ["地図＋郷土料理", "地図で光る県の郷土料理は？", "位置と郷土料理を結びつけましょう。"],
    dishShapeChoice: ["郷土料理→形", `「${question.prefecture.dish}」が選ばれた都道府県の形は？`, "4つの輪郭から選んでください。"],
    dishLocate: ["郷土料理→地図", `農林水産省の郷土料理百選で「${question.prefecture.dish}」が選ばれた都道府県は？`, "日本地図から場所を選んでください。"]
  }[question.type];
  if (["locate", "mapMemory"].includes(question.type)) copy[2] = `${question.prefecture.region}周辺の地図から選んでください。`;
  if (!saved.settings.visualEffects && ["spotlight", "reveal", "flash", "mapFlash"].includes(question.type)) {
    copy[2] = question.type === "mapFlash" ? "設定で視覚効果がOFFのため、位置を静止表示しています。" : "設定で視覚効果がOFFのため、輪郭を静止表示しています。";
  }
  [ui.type.textContent, ui.title.textContent, ui.help.textContent] = copy;
}

function renderVisual(question, token) {
  const { prefecture, type } = question;
  const reducedMotion = !saved.settings.visualEffects;
  if (type === "shapeMemory") {
    const islandCount = prefecture.feature.geometry.type === "MultiPolygon" ? prefecture.feature.geometry.coordinates.length : 1;
    const previewMs = Math.min(4000, Math.round(2500 + (1 - getProgress(prefecture.code, "A").mastery) * 700 + (islandCount - 1) * 150));
    ui.stage.innerHTML = `${silhouetteSvg(prefecture)}<div class="memory-teach"><span>形の見本</span><strong>${prefecture.name}</strong></div><div class="memory-curtain">思い出して答えよう</div>`;
    ui.stage.querySelector(".memory-curtain").style.animationDelay = `${previewMs}ms`;
    ui.answerFieldset.hidden = true;
    ui.submit.hidden = true;
    const unlock = () => {
      ui.stage.querySelector(".memory-teach")?.remove();
      ui.stage.querySelector(".memory-ready-button")?.remove();
      ui.type.textContent = "形を思い出す";
      ui.title.textContent = `${prefecture.name}の形はどれ？`;
      ui.help.textContent = "見本で見た輪郭を4つから選んでください。";
      ui.answerFieldset.hidden = false;
      ui.submit.hidden = saved.settings.answerMode === "instant";
      ui.keyboardHint.innerHTML = saved.settings.answerMode === "instant" ? "<kbd>1</kbd>–<kbd>4</kbd> で回答" : "<kbd>1</kbd>–<kbd>4</kbd> 選択　<kbd>Enter</kbd> 決定";
    };
    if (reducedMotion) {
      ui.stage.querySelector(".memory-curtain").remove();
      ui.help.textContent = "形を確認して、覚えたらボタンを押してください。";
      ui.keyboardHint.textContent = "時間は減りません";
      ui.stage.insertAdjacentHTML("beforeend", '<button class="memory-ready-button" type="button">覚えた</button>');
      session.locationLocked = true;
      session.lockLabel = "確認中";
      ui.stage.querySelector(".memory-ready-button").addEventListener("click", () => {
        if (token !== questionToken) return;
        unlock();
        session.locationLocked = false;
        session.lockLabel = "";
        session.startedAt = Date.now();
        session.answerClockStartedAt = session.startedAt;
        session.deadline = session.startedAt + QUESTION_SECONDS * 1000;
      });
    } else {
      ui.keyboardHint.textContent = `${(previewMs / 1000).toFixed(1)}秒だけ見本を表示します`;
      lockPreview(token, previewMs, unlock);
    }
  } else if (["silhouette", "reveal", "spotlight", "flash"].includes(type)) {
    ui.stage.classList.toggle("dark", type === "spotlight" || type === "flash");
    ui.stage.innerHTML = silhouetteSvg(prefecture, type === "spotlight" ? "spotlight" : type === "reveal" ? "reveal" : "plain");
    if (type === "flash" && !reducedMotion) {
      const curtain = document.createElement("div");
      curtain.className = "memory-curtain";
      curtain.textContent = "思い出して答えよう";
      ui.stage.append(curtain);
      lockPreview(token, 1750);
    }
    if (type === "reveal" && !reducedMotion) {
      ui.keyboardHint.textContent = "わかった時点ですぐ回答できます";
      session.timerHoldUntil = Date.now() + 6000;
      session.answerClockStartedAt = session.timerHoldUntil;
      session.deadline += 6000;
    }
  } else if (type === "slitFlow") {
    if (reducedMotion) {
      ui.type.textContent = "シルエット";
      ui.title.textContent = "この都道府県はどこ？";
      ui.help.textContent = "視覚効果を使わず、静止した輪郭を表示しています。";
      ui.stage.innerHTML = silhouetteSvg(prefecture);
    }
    else {
      const reverse = Math.random() < .5 ? " reverse" : "";
      ui.stage.innerHTML = `<div class="slit-flow"><div class="slit-moving${reverse}">${silhouetteSvg(prefecture)}</div><div class="slit-cover" aria-hidden="true"></div></div><div class="memory-curtain">どの県だった？</div>`;
      ui.stage.querySelector(".memory-curtain").style.animationDelay = "5.2s";
      ui.keyboardHint.textContent = "隙間を通る形を記憶します";
      ui.answerFieldset.hidden = true;
      ui.submit.hidden = true;
      lockPreview(token, 5200, () => {
        ui.answerFieldset.hidden = false;
        ui.submit.hidden = saved.settings.answerMode === "instant";
        ui.keyboardHint.innerHTML = saved.settings.answerMode === "instant" ? "<kbd>1</kbd>–<kbd>4</kbd> で回答" : "<kbd>1</kbd>–<kbd>4</kbd> 選択　<kbd>Enter</kbd> 決定";
      });
    }
  } else if (type === "silhouetteReverse") {
    ui.stage.innerHTML = `<div class="fact-prompt"><span>A</span><strong>${prefecture.name}</strong></div>`;
  } else if (["map", "mapShape"].includes(type)) {
    const localBounds = expandedBounds(boundsOf([prefecture.mainGeometry]), 1.65);
    ui.stage.innerHTML = svgMap(prefectures, localBounds, { targetCode: prefecture.code, label: "対象の都道府県を強調した周辺地図" }) + '<span class="stage-corner-label">周辺の位置関係</span>';
  } else if (type === "mapChoice") {
    ui.stage.innerHTML = `<div class="fact-prompt"><span>B</span><strong>${prefecture.name}</strong></div>`;
  } else if (type === "mapFlash") {
    const regional = regionPrefectures(prefecture);
    const viewBounds = expandedBounds(boundsOf(regional.map((item) => item.mainGeometry)), regional.length > 1 ? .54 : .55);
    ui.stage.innerHTML = svgMap(regional, viewBounds, { targetCode: prefecture.code, label: "短時間だけ対象を強調する地方地図" });
    if (!reducedMotion) {
      ui.stage.insertAdjacentHTML("beforeend", '<span class="memory-status" aria-live="polite">1.5秒だけ記憶</span>');
      lockPreview(token, 1500, () => {
        ui.stage.querySelector(".target")?.classList.remove("target");
        ui.stage.querySelector(".memory-status")?.remove();
      });
    }
  } else if (LOCATION_TYPES.includes(type)) {
    const regional = regionPrefectures(prefecture);
    const nationwide = NATIONWIDE_LOCATION_TYPES.includes(type);
    const visiblePrefectures = nationwide ? prefectures : regional;
    const viewBounds = expandedBounds(boundsOf(visiblePrefectures.map((item) => item.mainGeometry)), nationwide ? .62 : regional.length > 1 ? .54 : .55);
    const targetCode = type === "mapMemory" ? prefecture.code : "";
    const label = type === "capitalLocate" ? "県庁所在地を手がかりに都道府県を選ぶ日本地図" : type === "dishLocate" ? "郷土料理を手がかりに都道府県を選ぶ日本地図" : type === "shapeLocate" ? "シルエットを手がかりに都道府県を選ぶ日本地図" : nationwide ? `${prefecture.name}の位置を選ぶ日本地図` : `${prefecture.name}の位置を選ぶ${prefecture.region}周辺の地図`;
    ui.stage.innerHTML = svgMap(visiblePrefectures, viewBounds, { targetCode, clickable: true, label });
    ui.stage.classList.toggle("nationwide-stage", nationwide);
    if (type === "mapMemory") ui.stage.insertAdjacentHTML("beforeend", '<span class="memory-status" aria-live="polite">2秒だけ記憶</span>');
    if (type === "shapeLocate") ui.stage.insertAdjacentHTML("beforeend", `<div class="shape-location-preview">${silhouetteSvg(prefecture)}<span class="memory-status" aria-live="polite">1.5秒だけ形を記憶</span></div>`);
    ui.answerFieldset.hidden = true;
    ui.submit.hidden = saved.settings.answerMode === "instant";
    ui.submit.disabled = true;
    ui.keyboardHint.textContent = saved.settings.answerMode === "instant" ? "タップ／Tab・矢印で移動、Enterで回答" : "タップ／Tab・矢印で選び、Enterまたは「これで決定」";
    session.locationLocked = ["mapMemory", "shapeLocate"].includes(type);
    ui.stage.querySelectorAll("[data-code]").forEach((path) => {
      path.addEventListener("click", () => selectLocation(path.dataset.code));
    });
    const keyboardPaths = [...ui.stage.querySelectorAll(".map-prefecture[data-code]")];
    ui.stage.querySelector("svg").addEventListener("click", (event) => {
      if (event.target.closest(".map-prefecture[data-code]")) return;
      const svg = event.currentTarget;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      const nearest = keyboardPaths.map((path) => ({
        code: path.dataset.code,
        distance: Math.hypot(point.x - Number(path.dataset.centerX), point.y - Number(path.dataset.centerY))
      })).sort((a, b) => a.distance - b.distance)[0];
      if (nearest) selectLocation(nearest.code);
    });
    keyboardPaths.forEach((path) => {
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectLocation(path.dataset.code); }
        else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const nextCode = spatialNeighbor(path.dataset.code, event.key, visiblePrefectures);
          const next = keyboardPaths.find((item) => item.dataset.code === nextCode);
          if (next) {
            keyboardPaths.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
            next.focus();
          }
        }
      });
    });
    if (["mapMemory", "shapeLocate"].includes(type)) setTimeout(() => {
      if (token === questionToken) {
        ui.stage.querySelector(".target")?.classList.remove("target");
        ui.stage.querySelector(".memory-status")?.remove();
        ui.stage.querySelector(".shape-location-preview")?.remove();
        session.locationLocked = false;
        session.startedAt = Date.now();
        session.answerClockStartedAt = session.startedAt;
        session.deadline = session.startedAt + QUESTION_SECONDS * 1000;
      }
    }, type === "shapeLocate" ? 1500 : 2000);
  } else if (["capitalMap", "dishMap"].includes(type)) {
    const localBounds = expandedBounds(boundsOf([prefecture.mainGeometry]), 1.65);
    ui.stage.innerHTML = svgMap(prefectures, localBounds, { targetCode: prefecture.code, label: type === "capitalMap" ? "県庁所在地を答える対象都道府県の周辺地図" : "郷土料理を答える対象都道府県の周辺地図" });
  } else if (["capitalShape", "shapeRegion"].includes(type)) {
    ui.stage.innerHTML = silhouetteSvg(prefecture);
  } else if (type === "regionMap") {
    ui.stage.innerHTML = svgMap(prefectures, boundsOf(prefectures.map((item) => item.mainGeometry)), { targetCode: prefecture.code, label: "対象県を黄色く示した日本地図" });
  } else if (type === "regionShape") {
    const regional = prefectures.filter((item) => item.region === prefecture.region);
    ui.stage.innerHTML = svgMap(regional, expandedBounds(boundsOf(regional.map((item) => item.mainGeometry)), .54), { targetCode: prefecture.code, label: "対象県を黄色く示した地方のまとまり" });
  } else if (type === "compass") {
    ui.stage.innerHTML = `<div class="compass-prompt"><span>基準<br><strong>${question.reference.name}</strong></span><b aria-hidden="true">→</b><span>どちら？<br><strong>${prefecture.name}</strong></span></div>`;
  } else {
    const prompt = type === "capital" ? prefecture.name : type === "capitalReverse" || type === "capitalRegion" ? prefecture.capital : type === "region" ? prefecture.name : type === "regionMember" ? prefecture.region : ["dish", "dishShapeChoice"].includes(type) ? prefecture.dish : prefecture.name;
    ui.stage.innerHTML = `<div class="fact-prompt"><span>${question.skill}</span><strong>${prompt}</strong></div>`;
  }
}

function spatialNeighbor(code, key, items) {
  const current = items.find((item) => item.code === code);
  if (!current) return code;
  const vertical = key === "ArrowUp" || key === "ArrowDown";
  const sign = key === "ArrowRight" || key === "ArrowUp" ? 1 : -1;
  const candidates = items.filter((item) => item !== current).map((item) => {
    const dx = item.center[0] - current.center[0];
    const dy = item.center[1] - current.center[1];
    const forward = (vertical ? dy : dx) * sign;
    const sideways = vertical ? dx : dy;
    return { item, forward, score: Math.hypot(dx, dy) * (1 + Math.abs(sideways) / Math.max(.01, forward)) };
  }).filter(({ forward, item }) => {
    const sideways = vertical ? item.center[0] - current.center[0] : item.center[1] - current.center[1];
    return forward > 0 && Math.abs(sideways) <= forward * 1.5;
  }).sort((a, b) => a.score - b.score);
  return candidates[0]?.item.code || code;
}

function lockPreview(token, duration, beforeUnlock = () => {}, label = "記憶中") {
  session.locationLocked = true;
  session.lockLabel = label;
  ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  ui.submit.disabled = true;
  setTimeout(() => {
    if (token !== questionToken) return;
    beforeUnlock();
    session.locationLocked = false;
    session.lockLabel = "";
    ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = false; });
    session.startedAt = Date.now();
    session.answerClockStartedAt = session.startedAt;
    session.deadline = session.startedAt + QUESTION_SECONDS * 1000;
  }, duration);
}

function renderAnswers(question) {
  ui.answerGrid.innerHTML = "";
  const shapeChoices = ["shapeMemory", "silhouetteReverse", "mapShape", "dishShapeChoice"].includes(question.type);
  const mapChoices = question.type === "mapChoice";
  const mapChoicePrefectures = mapChoices ? question.choices.map((choice) => prefectures.find((item) => item.name === choice)) : [];
  const mapChoiceFeatures = mapChoices ? [...new Map(mapChoicePrefectures.flatMap(regionPrefectures).map((item) => [item.code, item])).values()] : [];
  const mapChoiceBounds = mapChoices ? expandedBounds(boundsOf(mapChoicePrefectures.map((item) => item.mainGeometry)), .5) : null;
  ui.answerGrid.classList.toggle("shape-grid", shapeChoices || mapChoices);
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
    if (shapeChoices) {
      const choicePrefecture = prefectures.find((item) => item.name === choice);
      label.className = "shape-option";
      label.setAttribute("aria-label", `${index + 1}番の形`);
      label.innerHTML = silhouetteSvg(choicePrefecture);
    } else if (mapChoices) {
      const choicePrefecture = prefectures.find((item) => item.name === choice);
      label.className = "map-option";
      label.setAttribute("aria-label", `${index + 1}番の地図`);
      label.innerHTML = svgMap(mapChoiceFeatures, mapChoiceBounds, { targetCode: choicePrefecture.code, label: `${index + 1}番の周辺地図` });
    } else {
      label.textContent = choice;
    }
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
  if (session.inputReadyAt > Date.now()) {
    ui.timer.style.transform = "scaleX(1)";
    ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
    ui.timerText.textContent = "次の問題";
    timerFrame = requestAnimationFrame(() => updateTimer(token));
    return;
  }
  if (session.timerHoldUntil > Date.now()) {
    ui.timer.style.transform = "scaleX(1)";
    ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
    ui.timerText.textContent = "見えたら回答";
    timerFrame = requestAnimationFrame(() => updateTimer(token));
    return;
  }
  if (session.locationLocked) {
    ui.timer.style.transform = "scaleX(1)";
    ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
    ui.timerText.textContent = session.lockLabel || "記憶中";
    timerFrame = requestAnimationFrame(() => updateTimer(token));
    return;
  }
  const remaining = Math.max(0, session.deadline - Date.now());
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

function resumeTimer() {
  if (!session || session.answered) return;
  cancelAnimationFrame(timerFrame);
  updateTimer(questionToken);
}

document.addEventListener("resume", resumeTimer);
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeTimer(); });
window.addEventListener("pageshow", resumeTimer);
window.addEventListener("focus", resumeTimer);

function submitSelectedAnswer() {
  if (!session || session.answered || session.locationLocked || Date.now() < session.inputReadyAt) return;
  if (LOCATION_TYPES.includes(session.current.type)) {
    if (session.selectedLocation) answerLocation(session.selectedLocation);
    return;
  }
  const selected = ui.answerGrid.querySelector('input[name="answer"]:checked');
  if (selected) completeAnswer(selected.value, false);
}

function selectLocation(code) {
  if (!session || session.answered || session.locationLocked || Date.now() < session.inputReadyAt) return;
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
  const answeredAt = Date.now();
  if (!timedOut && deadlinePassed(answeredAt, session.deadline)) { timedOut = true; answer = "時間切れ"; }
  session.answered = true;
  cancelAnimationFrame(timerFrame);
  const question = session.current;
  const correct = !timedOut && answer === question.correct;
  const responseMs = Math.max(0, Math.min(QUESTION_SECONDS * 1000, Math.round(answeredAt - session.answerClockStartedAt)));
  session.combo = correct ? session.combo + 1 : 0;
  session.maxCombo = Math.max(session.maxCombo, session.combo);
  const selectedCode = prefectures.find((prefecture) => [prefecture.name, prefecture.capital, prefecture.dish].includes(answer))?.code || "";
  session.answers.push({ code: question.prefecture.code, skill: question.skill, type: question.type, correct, timedOut, responseMs, answer, correctAnswer: question.correct, selectedCode });
  if (session.mode === "exam") {
    if (session.answers.length >= session.limit) finishGame();
    else { session.answered = false; renderQuestion(); }
    return;
  }
  if (question.pendingReview) saved.pendingReviews = saved.pendingReviews.filter((review) => review.code !== question.prefecture.code || review.skill !== question.skill);
  saved.pendingReviews.forEach((review) => { review.remaining = Math.max(0, review.remaining - 1); });
  updateLearning(question, correct, timedOut, responseMs, answer, selectedCode);
  let retry = null;
  if (question.isNew && (question.type === "shapeMemory" || question.skill === "B")) {
    retry = { code: question.prefecture.code, skill: question.skill, type: question.skill === "A" ? "silhouette" : "map" };
  } else if (!correct) {
    retry = { code: question.prefecture.code, skill: question.skill, type: "" };
  }
  if (retry) queueReview(retry);
  persist();
  ui.combo.textContent = session.combo;
  ui.score.textContent = session.answers.filter((item) => item.correct).length;
  playTone(correct ? "correct" : "incorrect");
  showFeedback(question, correct, timedOut, answer);
}

function updateLearning(question, correct, timedOut, responseMs, answer, selectedCode) {
  const key = progressKey(question.prefecture.code, question.skill);
  const evidence = questionEvidence(question.type, correct);
  const previous = getProgress(question.prefecture.code, question.skill);
  const item = recordAnswer(previous, { correct, timedOut, responseMs, evidence });
  saved.progress[key] = item;
  saved.recent.unshift({ code: question.prefecture.code, skill: question.skill, type: question.type, correct, timedOut, newItem: !previous.attempts, at: Date.now(), answer, selectedCode });
  saved.recent = saved.recent.slice(0, 30);
}

function queueReview(review) {
  saved.pendingReviews = saved.pendingReviews.filter((item) => item.code !== review.code || item.skill !== review.skill);
  saved.pendingReviews.push({ ...review, remaining: 3 });
  session.retries = session.retries.filter((item) => item.code !== review.code || item.skill !== review.skill);
  session.retries.push({ ...review, dueAt: session.answers.length + 4 });
}

function questionEvidence(type, correct = true) {
  return ["shapeMemory", "flash", "mapMemory", "mapFlash"].includes(type) ? correct ? .4 : 1 : ["slitFlow", "mapShape", "shapeLocate", "capitalMap", "capitalShape", "capitalLocate", "regionMap", "regionShape", "shapeRegion", "capitalRegion", "dishMap", "dishShapeChoice", "dishLocate"].includes(type) ? .65 : 1;
}

function showFeedback(question, correct, timedOut, answer) {
  ui.feedback.classList.toggle("incorrect", !correct);
  ui.feedbackMark.textContent = correct ? "○" : timedOut ? "⌛" : "×";
  ui.feedbackKicker.textContent = correct ? "正解" : timedOut ? "時間切れ" : "不正解";
  ui.feedbackTitle.textContent = correct ? randomOf(["正解！", "やった！", "その調子！"]) : timedOut ? "時間切れ" : "おしい！";
  ui.feedbackDetail.textContent = feedbackDetail(question);
  renderFeedbackComparison(question, answer, correct, timedOut);
  const canRetryThisRound = !session.limit || session.answers.length + 3 < session.limit;
  ui.feedbackPoints.textContent = correct ? session.combo >= 2 ? `${session.combo}連続正解` : "学習記録を更新しました" : canRetryThisRound ? "3問はさんで再出題" : "次回優先して復習";
  $("next-question-button").textContent = session.limit && session.answers.length >= session.limit ? "結果を見る" : "次の問題";
  ui.feedback.showModal();
  ui.feedback.scrollTop = 0;
  requestAnimationFrame(() => {
    ui.feedback.scrollTop = 0;
    ui.feedbackTitle.focus({ preventScroll: true });
  });
}

function renderFeedbackComparison(question, answer, correct, timedOut) {
  const selectedPrefecture = prefectures.find((prefecture) => [prefecture.name, prefecture.capital, prefecture.dish].includes(answer));
  const canCompare = !correct && !timedOut && selectedPrefecture && selectedPrefecture.code !== question.prefecture.code;
  ui.feedbackComparison.classList.toggle("is-single", !canCompare);
  const correctNote = question.correct === question.prefecture.name ? `${question.prefecture.region}・県庁所在地 ${question.prefecture.capital}` : `答え：${question.correct}`;
  if (correct) {
    ui.feedbackComparison.replaceChildren(feedbackShapeCard("形と場所を再確認", question.prefecture, question.prefecture.name, correctNote, "correct-answer"));
    return;
  }
  if (!canCompare) {
    const result = timedOut ? "時間切れ" : `あなたの回答：${answer}`;
    const title = question.correct === question.prefecture.name ? "正解の都道府県" : "問題の都道府県";
    ui.feedbackComparison.replaceChildren(feedbackShapeCard(title, question.prefecture, question.prefecture.name, `${result}／正解：${question.correct}`, "correct-answer"));
    return;
  }
  ui.feedbackComparison.replaceChildren(
    feedbackShapeCard("あなたの回答", selectedPrefecture, selectedPrefecture.name, answer === selectedPrefecture.name ? selectedPrefecture.region : `回答：${answer}`, "selected-wrong"),
    feedbackShapeCard("正解の都道府県", question.prefecture, question.prefecture.name, correctNote, "correct-answer")
  );
}

function feedbackShapeCard(title, prefecture, value, note, className) {
  const card = document.createElement("article");
  card.className = `feedback-shape-card ${className}`;
  card.dataset.code = prefecture?.code || "";
  const label = document.createElement("span");
  label.textContent = title;
  const visual = document.createElement("div");
  if (prefecture) {
    visual.className = "feedback-map";
    visual.innerHTML = svgMap(prefectures, silhouetteViewBounds(prefecture), { width: 650, height: 410, targetCode: prefecture.code, label: `${prefecture.name}と周辺県の位置` });
  }
  else { visual.className = "feedback-no-shape"; visual.textContent = "？"; }
  const name = document.createElement("strong");
  name.textContent = value;
  const detail = document.createElement("small");
  detail.textContent = note;
  card.append(label, visual, name, detail);
  return card;
}

function feedbackDetail(question) {
  const pref = question.prefecture;
  if (question.skill === "A") return `正解は「${pref.name}」。輪郭と周辺県に対する位置を確認しましょう。`;
  if (question.type === "compass") return `${question.reference.name}から見て${pref.name}は、おおよそ${question.correct}です。`;
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

function startGame(limit, mode = "learn") {
  session = {
    mode, limit, answers: [], retries: mode === "exam" ? [] : saved.pendingReviews.map((review) => ({ ...review, dueAt: review.remaining + 1 })),
    recentCodes: saved.recent.slice(0, 3).reverse().map((item) => item.code),
    recentTypes: saved.recent.slice(0, 2).reverse().map((item) => item.type),
    combo: 0, maxCombo: 0, answered: false, current: null, deadline: 0, startedAt: 0, answerClockStartedAt: 0, timerHoldUntil: 0, inputReadyAt: 0,
    understandingBefore: understandingIndex(saved.progress), examQuestions: [],
    selectedLocation: "", locationLocked: false, lockLabel: ""
  };
  if (mode === "exam") session.examQuestions = buildExamQuestions();
  renderQuestion();
}

function finishGame() {
  cancelAnimationFrame(timerFrame);
  questionToken += 1;
  if (ui.feedback.open) ui.feedback.close();
  if (session?.mode === "exam" && session.answers.length < session.limit) { session = null; renderHome(); showScreen(ui.home); return; }
  if (!session?.answers.length) { session = null; renderHome(); showScreen(ui.home); return; }
  const isExam = session.mode === "exam";
  const correct = session.answers.filter((answer) => answer.correct).length;
  const timeouts = session.answers.filter((answer) => answer.timedOut).length;
  const score = isExam ? examScore(correct, session.limit) : understandingIndex(saved.progress);
  if (isExam) { saved.examScores = [score, ...saved.examScores].slice(0, 3); persist(); }
  $("result-title").textContent = isExam ? "実力テスト結果" : `${session.answers.length}問おつかれさま！`;
  $("result-score-label").textContent = isExam ? "偶然正解を補正した実力スコア" : "全47県・5分野の都道府県理解度";
  $("result-score").textContent = score;
  $("result-score-unit").textContent = "/1000";
  const examAverage = isExam ? Math.round(saved.examScores.reduce((sum, value) => sum + value, 0) / saved.examScores.length) : 0;
  const reachedLevel = isExam ? 0 : understandingMilestone(session.understandingBefore, score, session.answers.length);
  $("result-record").textContent = isExam ? `直近${saved.examScores.length}回平均 ${examAverage}` : `理解度指数 ${reachedLevel}台に到達！`;
  $("result-record").hidden = !isExam && !reachedLevel;
  $("result-correct").textContent = `${correct}/${session.answers.length}`;
  $("result-rate").textContent = `${Math.round(correct / session.answers.length * 100)}%`;
  $("result-combo-label").textContent = isExam ? "平均回答時間" : "最大連続正解";
  $("result-combo").textContent = isExam ? `${(session.answers.reduce((sum, answer) => sum + answer.responseMs, 0) / session.answers.length / 1000).toFixed(1)}秒` : session.maxCombo;
  $("result-timeouts").textContent = timeouts;
  const weakest = weakestItems(1)[0];
  const scheduled = Object.entries(saved.progress).filter(([, item]) => item.attempts).sort(([, a], [, b]) => a.nextDue - b.nextDue)[0];
  const next = [...saved.pendingReviews].sort((a, b) => a.remaining - b.remaining)[0] || (scheduled && { code: scheduled[0].slice(0, 2), skill: scheduled[0].slice(3), remaining: null });
  const nextPrefecture = next && prefectures.find((prefecture) => prefecture.code === next.code);
  const nextTiming = next?.remaining === null ? "" : next?.remaining ? `${next.remaining}問後に` : "最初に";
  const nextText = nextPrefecture ? `次の復習候補：${nextPrefecture.name}の「${SKILLS[next.skill].name}」${nextTiming ? `（${nextTiming}）` : ""}。` : "次の復習候補：新しい都道府県。";
  const weakestText = weakest ? `現在の苦手：${weakest.prefecture.name}の「${SKILLS[weakest.skill].name}」。` : "現在の苦手：まだ判定できません。";
  if (isExam) {
    const skillResults = Object.keys(SKILLS).map((skill) => ({ skill, correct: session.answers.filter((answer) => answer.skill === skill && answer.correct).length }));
    const minimum = Math.min(...skillResults.map((item) => item.correct));
    const weakNames = skillResults.filter((item) => item.correct === minimum).map((item) => SKILLS[item.skill].name);
    const weaknessText = minimum === 6 ? "弱かった分野：ありません（全分野満点）。" : `弱かった分野：${weakNames.join("・")}。`;
    $("result-review").textContent = `${weaknessText} 通常学習で復習できます。試験結果は理解度指数へ影響しません。`;
  } else $("result-review").textContent = `${weakestText} ${nextText} 次の10問も苦手・復習時期・未学習を優先します。`;
  const mistakes = [...new Map(session.answers.filter((item) => !item.correct).map((item) => [item.code, item])).values()];
  $("result-mistakes").hidden = !mistakes.length;
  $("result-mistake-list").replaceChildren(...mistakes.map((answer) => {
    const prefecture = prefectures.find((item) => item.code === answer.code);
    const card = document.createElement("article");
    card.className = "result-mistake-card";
    card.innerHTML = `${silhouetteSvg(prefecture)}<div><strong>${prefecture.name}</strong><small>${SKILLS[answer.skill].name}・${answer.timedOut ? "時間切れ" : "不正解"}</small></div>`;
    const correction = document.createElement("small");
    correction.textContent = `あなた：${answer.answer || "未回答"} ／ 正解：${answer.correctAnswer}`;
    card.querySelector("div").append(correction);
    return card;
  }));
  $("replay-button").dataset.mode = "learn";
  $("replay-button").textContent = isExam ? "おすすめ学習で復習" : "おすすめ学習をもう10問";
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
    const status = unlockedBasicCount() < skill.unlockAt ? `基本${skill.unlockAt}県で解放` : `${attempts}問`;
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
      gain.gain.exponentialRampToValueAtTime(.09 * saved.settings.volume, audioContext.currentTime + index * .08 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + index * .08 + .14);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(audioContext.currentTime + index * .08);
      oscillator.stop(audioContext.currentTime + index * .08 + .15);
    });
  } catch (_) { saved.settings.sound = false; persist(); }
}

function randomOf(items) { return items[Math.floor(Math.random() * items.length)]; }
function randomMode(modes, fallback) {
  const available = saved.settings.visualEffects ? modes : modes.filter((type) => !ANIMATED_TYPES.includes(type));
  const fresh = available.filter((type) => type !== session?.recentTypes.at(-1));
  return randomOf(fresh.length ? fresh : available.length ? available : [fallback]);
}
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
$("start-exam-button").addEventListener("click", () => startGame(30, "exam"));
$("start-endless-button").addEventListener("click", () => startGame(null));
$("study-map-button").addEventListener("click", () => { renderStudyMap(); ui.studyMap.showModal(); });
$("study-map-zoom-out").addEventListener("click", () => setStudyMapZoom(studyMapZoom - .25));
$("study-map-zoom-in").addEventListener("click", () => setStudyMapZoom(studyMapZoom + .25));
$("study-map-zoom-reset").addEventListener("click", () => setStudyMapZoom(1));
$("study-map-zoom").addEventListener("input", (event) => setStudyMapZoom(Number(event.target.value)));
$("study-map-show-strong").addEventListener("change", () => renderStudyMapColors());
$("study-map-show-weak").addEventListener("change", () => renderStudyMapColors());
ui.submit.addEventListener("click", submitSelectedAnswer);
$("next-question-button").addEventListener("click", nextAfterFeedback);
$("quit-game-button").addEventListener("click", finishGame);
$("replay-button").addEventListener("click", (event) => startGame(event.currentTarget.dataset.mode === "exam" ? 30 : 10, event.currentTarget.dataset.mode || "learn"));
$("result-home-button").addEventListener("click", () => { session = null; showScreen(ui.home); });
$("game-quit-button").addEventListener("click", () => { if (window.confirm("プレイを中断してホームへ戻りますか？")) finishGame(); });
$("home-button").addEventListener("click", () => { cancelAnimationFrame(timerFrame); questionToken += 1; if (ui.feedback.open) ui.feedback.close(); session = null; renderHome(); showScreen(ui.home); });

$("settings-button").addEventListener("click", () => {
  if (!ui.game.hidden) return;
  $("sound-setting").checked = saved.settings.sound;
  $("volume-setting").value = String(saved.settings.volume);
  $("volume-value").textContent = `${Math.round(saved.settings.volume * 100)}%`;
  $("volume-setting").disabled = !saved.settings.sound;
  $("answer-mode-setting").value = saved.settings.answerMode;
  $("visual-effects-setting").checked = saved.settings.visualEffects;
  ui.settings.showModal();
});
$("sound-setting").addEventListener("change", (event) => {
  saved.settings.sound = event.target.checked;
  $("volume-setting").disabled = !event.target.checked;
  persist();
  if (event.target.checked) playTone("correct");
});
$("volume-setting").addEventListener("input", (event) => {
  saved.settings.volume = finiteNumber(Number(event.target.value), .5, .1, 1);
  $("volume-value").textContent = `${Math.round(saved.settings.volume * 100)}%`;
  persist();
});
$("answer-mode-setting").addEventListener("change", (event) => { saved.settings.answerMode = event.target.value; persist(); });
$("visual-effects-setting").addEventListener("change", (event) => {
  saved.settings.visualEffects = event.target.checked;
  applyVisualEffects();
  persist();
});
$("progress-button").addEventListener("click", () => { if (!ui.game.hidden) return; renderProgress(); ui.progress.showModal(); });
$("reset-data-button").addEventListener("click", () => ui.resetConfirm.showModal());
$("cancel-reset-button").addEventListener("click", () => ui.resetConfirm.close());
$("confirm-reset-button").addEventListener("click", () => {
  saved = freshSaved(); applyVisualEffects(); persist(); ui.resetConfirm.close(); ui.settings.close(); renderHome();
});

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (ui.feedback.open && event.key === "Enter" && !event.repeat) { event.preventDefault(); nextAfterFeedback(); return; }
  if (ui.feedback.open || ui.settings.open || ui.progress.open || ui.studyMap.open || ui.resetConfirm.open || ui.game.hidden || !session || session.answered || session.locationLocked || Date.now() < session.inputReadyAt) return;
  const number = Number(event.key);
  const isLocation = LOCATION_TYPES.includes(session.current.type);
  if (!isLocation && number >= 1 && number <= 4) {
    const input = ui.answerGrid.querySelectorAll('input[name="answer"]')[number - 1];
    if (input && !input.disabled) { input.checked = true; input.dispatchEvent(new Event("change")); }
  } else if (event.key === "Enter" && !ui.submit.hidden) {
    event.preventDefault(); submitSelectedAnswer();
  }
});

ui.feedback.addEventListener("cancel", (event) => event.preventDefault());

loadData();
