import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankProgress, deadlinePassed, normalizeProgress, recordAnswer, schedulingPriority } from "../static/js/learning.mjs";

const required = [
  "index.html",
  "sources.html",
  "static/css/style.css",
  "static/js/script.js",
  "static/js/learning.mjs",
  "static/data/low_prefectures.geojson",
  "static/data/prefecture_facts.json",
  ".github/chrome-smoke.mjs",
];

for (const path of required) {
  if (!existsSync(path)) throw new Error(`必須ファイルがありません: ${path}`);
}

for (const name of readdirSync("static/js").filter((name) => /\.m?js$/.test(name))) {
  execFileSync(process.execPath, ["--check", join("static/js", name)], { stdio: "inherit" });
}
execFileSync(process.execPath, ["--check", ".github/chrome-smoke.mjs"], { stdio: "inherit" });

for (const path of ["index.html", "sources.html", "static/css/style.css", "static/js/script.js"]) {
  const source = readFileSync(path, "utf8");
  if (/\b(?:src|href)=["']\/(?!\/)/.test(source) || /fetch\(["']\/(?!\/)/.test(source)) {
    throw new Error(`GitHub Pagesで壊れるルート相対参照があります: ${path}`);
  }
}

const html = readFileSync("index.html", "utf8");
const script = readFileSync("static/js/script.js", "utf8");
const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
for (const [, id] of script.matchAll(/getElementById\(["']([^"']+)["']\)/g)) {
  if (!htmlIds.has(id)) throw new Error(`JavaScriptが存在しない要素を参照しています: #${id}`);
}
for (const [, id] of script.matchAll(/\$\(["']([^"']+)["']\)/g)) {
  if (!htmlIds.has(id)) throw new Error(`JavaScriptが存在しない要素を参照しています: #${id}`);
}

const now = 1_800_000_000_000;
if (deadlinePassed(999, 1000) || !deadlinePassed(1000, 1000) || !deadlinePassed(1001, 1000)) {
  throw new Error("制限時間境界の判定が不正です");
}
const firstCorrect = recordAnswer(blankProgress(), { correct: true, timedOut: false, responseMs: 5000, now });
if (firstCorrect.attempts !== 1 || firstCorrect.correct !== 1 || firstCorrect.streak !== 1 || firstCorrect.mastery <= 0 || firstCorrect.nextDue <= now) {
  throw new Error("正解時の学習記録更新が不正です");
}
const slowCorrect = recordAnswer(blankProgress(), { correct: true, timedOut: false, responseMs: 14000, now });
if (slowCorrect.mastery !== firstCorrect.mastery || schedulingPriority(slowCorrect, { now, random: 0 }) <= schedulingPriority(firstCorrect, { now, random: 0 })) {
  throw new Error("回答速度を習熟度と分離しつつ、出題優先度へ反映できていません");
}
const afterTimeout = recordAnswer(firstCorrect, { correct: false, timedOut: true, responseMs: 15000, now: now + 1000 });
if (afterTimeout.correct !== 1 || afterTimeout.streak !== 0 || afterTimeout.timeouts !== 1 || afterTimeout.mastery >= firstCorrect.mastery) {
  throw new Error("時間切れ時の学習記録更新が不正です");
}
if (schedulingPriority(blankProgress(), { now, random: 0 }) <= schedulingPriority(firstCorrect, { now, random: 0 })) {
  throw new Error("未学習項目が学習済み項目より優先されていません");
}
if (schedulingPriority(blankProgress(), { now, random: 0, recentlyShown: true }) >= schedulingPriority(blankProgress(), { now, random: 0 })) {
  throw new Error("直近出題の抑制が働いていません");
}
const corrupt = normalizeProgress({ attempts: "10", correct: 99, mastery: 4, recent: null });
if (corrupt.attempts !== 0 || corrupt.correct !== 0 || corrupt.mastery !== 0 || !Array.isArray(corrupt.recent)) {
  throw new Error("型が壊れた保存値を安全に正規化できません");
}
const overdue = { ...blankProgress(), attempts: 1, nextDue: now - 864e5 };
if (schedulingPriority(overdue, { now, random: 0 }) <= schedulingPriority(blankProgress(), { now, random: 0 })) {
  throw new Error("期限超過の復習項目が未学習項目より優先されていません");
}

const geoPath = "static/data/low_prefectures.geojson";
const geoBytes = readFileSync(geoPath);
const geoHash = createHash("sha256").update(geoBytes).digest("hex");
if (geoHash !== "b1c6c66f04a0a117174ee77174684d9e233ca91cdf87963d89a5e7910ed263fb") {
  throw new Error("GeoJSONが出典文書に記録した版と一致しません");
}
const geo = JSON.parse(geoBytes);
if (geo.type !== "FeatureCollection" || geo.features?.length !== 47) {
  throw new Error("GeoJSONは47件のFeatureCollectionである必要があります");
}

const ids = new Set();
const names = new Set();
for (const feature of geo.features) {
  const id = Number(feature.properties?.pref);
  const name = feature.properties?.name;
  if (!Number.isInteger(id) || id < 1 || id > 47 || ids.has(id)) {
    throw new Error(`都道府県コードが不正または重複しています: ${id}`);
  }
  if (typeof name !== "string" || !name || names.has(name)) {
    throw new Error(`都道府県名が不正または重複しています: ${name}`);
  }
  if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
    throw new Error(`形状種別が不正です: ${name}`);
  }
  if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length === 0) {
    throw new Error(`形状が空です: ${name}`);
  }
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring.at(-1);
      if (ring.length < 4 || first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
        throw new Error(`閉じていない形状があります: ${name}`);
      }
      if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 122 && x <= 154 && y >= 20 && y <= 46)) {
        throw new Error(`日本周辺の範囲外または不正な座標があります: ${name}`);
      }
    }
  }
  ids.add(id);
  names.add(name);
}

if (statSync(geoPath).size > 500_000) {
  throw new Error("公開用GeoJSONが500KBを超えています");
}

const facts = JSON.parse(readFileSync("static/data/prefecture_facts.json", "utf8"));
if (facts.prefectures?.length !== 47) {
  throw new Error("基礎問題データは47都道府県を含む必要があります");
}
const factCodes = new Set();
for (const item of facts.prefectures) {
  const id = Number(item.code);
  if (!ids.has(id) || factCodes.has(id) || item.name !== geo.features.find((feature) => Number(feature.properties.pref) === id)?.properties.name) {
    throw new Error(`基礎問題データのコードまたは名称がGeoJSONと一致しません: ${item.code}`);
  }
  if (![item.capital, item.region, item.dish].every((value) => typeof value === "string" && value)) {
    throw new Error(`県庁所在地、地方区分、郷土料理のいずれかが空です: ${item.name}`);
  }
  factCodes.add(id);
}

for (const legacy of ["app.py", "requirements.txt", "templates", "static/test.html"]) {
  if (existsSync(legacy)) throw new Error(`静的サイトに不要な旧ファイルが残っています: ${legacy}`);
}

console.log("静的サイト、JavaScript、GeoJSONの検査に成功しました。");
