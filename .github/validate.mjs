import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { blankProgress, canIntroduceNewItem, canUseIntegratedMode, compassVector, deadlinePassed, examScore, geometryRepresentativePoint, hasBasicMastery, normalizeProgress, recordAnswer, schedulingPriority, skillsForMastery, understandingIndex, understandingMilestone } from "../static/js/learning.mjs";

const required = [
  "index.html",
  "sources.html",
  "static/css/style.css",
  "static/js/script.js",
  "static/js/learning.mjs",
  "static/data/low_prefectures.geojson",
  "static/data/prefecture_facts.json",
  "static/favicon.svg",
  "static/icon-512.png",
  "static/social-card.png",
  ".github/chrome-smoke.mjs",
  ".github/workflows/pages.yml",
  "lighthouserc.json",
  "README.md",
  "LICENSE",
  "DATA_SOURCES.md",
  "THIRD_PARTY_NOTICES.md",
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
if (!html.includes('property="og:image" content="https://ume-chika.github.io/pref_quiz_withGeoJson/static/social-card.png"') || !html.includes('name="twitter:card" content="summary_large_image"') || statSync("static/social-card.png").size < 10_000) {
  throw new Error("リンク共有画像またはSNSメタデータが不足しています");
}
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
if (!canIntroduceNewItem([{ newItem: true }, { newItem: true }, { newItem: true }]) || canIntroduceNewItem([{ newItem: true }, { newItem: true }, { newItem: true }, { newItem: true }]) || canIntroduceNewItem([{ newItem: true }, { newItem: true }, { newItem: true }, { newItem: true }, {}, {}, {}, {}, {}, { newItem: true }])) {
  throw new Error("10問あたり新規4項目の上限が不正です");
}
if (skillsForMastery(2).join("") !== "AB" || skillsForMastery(3).join("") !== "ABC" || skillsForMastery(7).join("") !== "ABC" || skillsForMastery(8).join("") !== "ABCD" || skillsForMastery(14).join("") !== "ABCD" || skillsForMastery(15).join("") !== "ABCDE") {
  throw new Error("分野の段階解放境界が不正です");
}
if (hasBasicMastery(.9, 0) || hasBasicMastery(.44, 1) || !hasBasicMastery(.45, .45)) {
  throw new Error("形と位置の双方を習熟した県だけを段階解放へ数えられていません");
}
if (canUseIntegratedMode(.54, 1) || canUseIntegratedMode(1, .44) || !canUseIntegratedMode(.55, .45)) {
  throw new Error("複数分野をまたぐ形式の解放境界が不正です");
}
const firstCorrect = recordAnswer(blankProgress(), { correct: true, timedOut: false, responseMs: 5000, now });
if (firstCorrect.attempts !== 1 || firstCorrect.correct !== 1 || firstCorrect.streak !== 1 || firstCorrect.mastery <= 0 || firstCorrect.nextDue <= now) {
  throw new Error("正解時の学習記録更新が不正です");
}
const slowCorrect = recordAnswer(blankProgress(), { correct: true, timedOut: false, responseMs: 14000, now });
if (slowCorrect.mastery !== firstCorrect.mastery || schedulingPriority(slowCorrect, { now, random: 0 }) <= schedulingPriority(firstCorrect, { now, random: 0 })) {
  throw new Error("回答速度を習熟度と分離しつつ、出題優先度へ反映できていません");
}
const promptedCorrect = recordAnswer(blankProgress(), { correct: true, timedOut: false, responseMs: 4000, evidence: .4, now });
if (promptedCorrect.streak !== 0 || promptedCorrect.mastery >= firstCorrect.mastery || promptedCorrect.nextDue !== firstCorrect.nextDue) {
  throw new Error("正解提示を含む記憶問題の証拠量が過大です");
}
const promptedAfterStreak = recordAnswer({ ...firstCorrect, attempts: 3, correct: 3, streak: 3, mastery: .6 }, { correct: true, timedOut: false, responseMs: 4000, evidence: .4, now });
if (promptedAfterStreak.streak !== 3 || promptedAfterStreak.nextDue !== now + 5 * 60e3 || promptedAfterStreak.mastery <= .6) {
  throw new Error("正解提示を含む記憶問題が既存の連続正解を壊しています");
}
const integratedAfterStreak = recordAnswer({ ...firstCorrect, attempts: 3, correct: 3, streak: 3, mastery: .6 }, { correct: true, timedOut: false, responseMs: 4000, evidence: .65, now });
if (integratedAfterStreak.streak !== 3 || integratedAfterStreak.nextDue !== now + 24 * 60 * 60e3) {
  throw new Error("複数分野をまたぐ正解の復習間隔が短すぎます");
}
const retrievalAfterPrompt = recordAnswer(promptedAfterStreak, { correct: true, timedOut: false, responseMs: 4000, now });
if (retrievalAfterPrompt.streak !== 4 || retrievalAfterPrompt.nextDue !== now + 3 * 864e5) {
  throw new Error("正解提示後の完全検索で連続正解を再開できません");
}
const afterTimeout = recordAnswer(firstCorrect, { correct: false, timedOut: true, responseMs: 15000, now: now + 1000 });
if (afterTimeout.correct !== 1 || afterTimeout.streak !== 0 || afterTimeout.timeouts !== 1 || afterTimeout.mastery >= firstCorrect.mastery || afterTimeout.nextDue >= now + 2 * 60e3) {
  throw new Error("時間切れ時の学習記録更新が不正です");
}
const fullWrong = recordAnswer({ ...firstCorrect, mastery: .8 }, { correct: false, timedOut: false, responseMs: 5000, now });
const weakWrong = recordAnswer({ ...firstCorrect, mastery: .8 }, { correct: false, timedOut: false, responseMs: 5000, evidence: .4, now });
const integratedWrong = recordAnswer({ ...firstCorrect, attempts: 3, correct: 3, streak: 3, mastery: .8 }, { correct: false, timedOut: false, responseMs: 5000, evidence: .65, now });
if (weakWrong.mastery <= fullWrong.mastery || integratedWrong.streak !== 2 || integratedWrong.nextDue !== now + 2 * 60e3) throw new Error("弱い証拠の誤答を強く扱いすぎているか、復習が遅すぎます");
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
const nearDue = { ...firstCorrect, lastSeen: now - 59 * 60e3, nextDue: now + 60e3 };
const farDue = { ...firstCorrect, lastSeen: now - 60e3, nextDue: now + 59 * 60e3 };
if (schedulingPriority(nearDue, { now, random: 0 }) <= schedulingPriority(farDue, { now, random: 0 })) {
  throw new Error("期限前の項目を復習予定の近さで並べられていません");
}

const allMastery = (skills) => Object.fromEntries(Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, "0")).flatMap((code) => skills.map((skill) => [`${code}:${skill}`, { mastery: 1 }])));
if (understandingIndex({}) !== 0 || understandingIndex(allMastery(["A"])) !== 245 || understandingIndex(allMastery(["A", "B"])) !== 700 || understandingIndex(allMastery(["A", "B", "C", "D", "E"])) !== 1000) {
  throw new Error("都道府県理解度指数の基準値が不正です");
}
const partialIndex = understandingIndex({ "01:A": { mastery: .3, attempts: 1, averageMs: 5000 } });
if (understandingIndex({ "01:A": { mastery: .4, attempts: 99, averageMs: 15000 } }) < partialIndex || understandingIndex({ "01:A": { mastery: 4 }, "01:B": { mastery: -2 } }) > 15) {
  throw new Error("理解度指数が習熟度に対して単調でないか、不正値を制限できていません");
}
if (understandingIndex({ "01:A": { mastery: .4, attempts: 1, correct: 1, averageMs: 1000, timeouts: 0 } }) !== understandingIndex({ "01:A": { mastery: .4, attempts: 99, correct: 3, averageMs: 15000, timeouts: 80 } })) {
  throw new Error("理解度指数が回答速度や出題回数に左右されています");
}
if (understandingMilestone(99, 100, 10) !== 100 || understandingMilestone(99, 205, 10) !== 200 || understandingMilestone(100, 199, 10) || understandingMilestone(99, 100, 9) || understandingMilestone(205, 199, 10)) {
  throw new Error("理解度指数の大台通知条件が不正です");
}
if ([0, 22, 333, 733, 1000].some((score, index) => examScore([0, 8, 15, 24, 30][index]) !== score) || examScore(30, 0) !== 0) {
  throw new Error("実力テストの偶然正解補正が不正です");
}

const geoPath = "static/data/low_prefectures.geojson";
const geoBytes = readFileSync(geoPath);
const geoHash = createHash("sha256").update(geoBytes).digest("hex");
if (geoHash !== "8b9171fb19a9d51d113361a8b93aa46470b5b11055195040485a8d8e68b1b5ed") {
  throw new Error("GeoJSONが出典文書に記録した版と一致しません");
}
if (!readFileSync("DATA_SOURCES.md", "utf8").includes(geoHash)) throw new Error("GeoJSONの版がデータ出典文書に記録されていません");
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
const capitals = new Set();
const dishes = new Set();
const regions = new Set(["北海道地方", "東北地方", "関東地方", "中部地方", "近畿地方", "中国地方", "四国地方", "九州地方"]);
for (const item of facts.prefectures) {
  const id = Number(item.code);
  if (!ids.has(id) || factCodes.has(id) || item.name !== geo.features.find((feature) => Number(feature.properties.pref) === id)?.properties.name) {
    throw new Error(`基礎問題データのコードまたは名称がGeoJSONと一致しません: ${item.code}`);
  }
  if (![item.capital, item.region, item.dish].every((value) => typeof value === "string" && value)) {
    throw new Error(`県庁所在地、地方区分、郷土料理のいずれかが空です: ${item.name}`);
  }
  if (!regions.has(item.region) || capitals.has(item.capital) || dishes.has(item.dish)) {
    throw new Error(`地方区分が不正、または選択肢用の値が重複しています: ${item.name}`);
  }
  factCodes.add(id);
  capitals.add(item.capital);
  dishes.add(item.dish);
}

const centerByName = new Map(geo.features.map((feature) => [feature.properties.name, geometryRepresentativePoint(feature.geometry)]));
for (const target of facts.prefectures) {
  const candidates = facts.prefectures.filter((item) => item.code !== target.code);
  const clearReference = candidates.map((item) => compassVector(centerByName.get(target.name), centerByName.get(item.name))).sort((a, b) => a.distance - b.distance).find(({ margin }) => margin >= 7.5);
  if (!clearReference) throw new Error(`8方位の境界から十分離れた参照県がありません: ${target.name}`);
}

const publicFiles = ["index.html", "sources.html", "static/css/style.css", "static/js/script.js", "static/js/learning.mjs", geoPath, "static/data/prefecture_facts.json"];
const publicPayload = publicFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const compressedPayload = publicFiles.reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0);
if (publicPayload > 275_000 || compressedPayload > 100_000) throw new Error(`主要配信ファイルが容量上限を超えています: raw ${publicPayload} / gzip ${compressedPayload} bytes`);

for (const legacy of ["app.py", "requirements.txt", "templates", "static/test.html"]) {
  if (existsSync(legacy)) throw new Error(`静的サイトに不要な旧ファイルが残っています: ${legacy}`);
}

console.log("静的サイト、JavaScript、GeoJSONの検査に成功しました。");
