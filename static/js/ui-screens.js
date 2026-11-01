import { ALL_SKILLS, isSkillEnabled, isSkillApplicable, understandingIndex, geometryRepresentativePoint } from "./learning.mjs";
import { SKILLS, STAGES } from "./constants.js";
import { ctx } from "./app-context.js";
import { enabledSkillKeys, enabledSkillsMap, persist } from "./state.js";
import { getPrefectureSkillSummary, progressKey } from "./study-map-data.js";
import { renderHeroMap } from "./study-map.js";
import { effectiveBasicMasteredCount, unlockedBasicCount } from "./question-selection.js";
import { validateData, largestPolygonGeometry, shapeStats } from "./geo-projection.js";

export function showScreen(target) {
  const screens = [ctx.ui.loading, ctx.ui.error, ctx.ui.home, ctx.ui.game, ctx.ui.result];
  screens.forEach((screen) => { if (screen) screen.hidden = screen !== target; });
  const playing = target === ctx.ui.game;
  const hasPrefectures = Boolean(ctx.prefectures.length);
  document.getElementById("home-button").disabled = playing || !hasPrefectures;
  document.getElementById("settings-button").disabled = playing || !hasPrefectures;
  document.getElementById("progress-button").disabled = playing || !hasPrefectures;
  document.getElementById("study-map-button").disabled = playing || !hasPrefectures;
  document.getElementById("start-exam-button").disabled = !hasPrefectures;
  requestAnimationFrame(() => ctx.ui.app?.focus({ preventScroll: true }));
  window.scrollTo({ top: 0, behavior: ctx.saved.settings.visualEffects ? "smooth" : "auto" });
}

export function totalAttempts() {
  return Object.values(ctx.saved.progress).reduce((sum, item) => sum + (Number(item.attempts) || 0), 0);
}

export function renderHome() {
  const attempts = totalAttempts();
  const learning = new Set(Object.entries(ctx.saved.progress).filter(([, item]) => item.attempts).map(([key]) => key.slice(0, 2))).size;
  const index = understandingIndex(ctx.saved.progress, ctx.saved.settings.enabledSkills, ctx.skillTargets);
  const now = Date.now();
  const dueKeys = new Set(Object.entries(ctx.saved.progress).filter(([key, item]) => {
    const [code, skill] = key.split(":");
    return item.attempts && item.nextDue <= now && isSkillEnabled(ctx.saved.settings.enabledSkills, skill) && isSkillApplicable(code, skill, ctx.skillTargets);
  }).map(([key]) => key));
  ctx.saved.pendingReviews.filter((review) => isSkillEnabled(ctx.saved.settings.enabledSkills, review.skill) && isSkillApplicable(review.code, review.skill, ctx.skillTargets)).forEach((review) => dueKeys.add(progressKey(review.code, review.skill, review.subIndex)));
  const due = dueKeys.size;
  const activeCount = enabledSkillKeys().length;
  const examAverage = ctx.saved.examScores.length ? Math.round(ctx.saved.examScores.reduce((sum, score) => sum + score, 0) / ctx.saved.examScores.length) : null;
  ctx.ui.understanding.textContent = index;
  ctx.ui.understandingStage.textContent = STAGES[index === 0 ? 0 : index >= 1000 ? 11 : Math.floor(index / 100) + 1];
  ctx.ui.challenged.textContent = learning;
  ctx.ui.learning.textContent = `基本を習得 ${effectiveBasicMasteredCount()}県`;
  ctx.ui.reviewCount.textContent = due;
  ctx.ui.examSummary.textContent = examAverage === null ? `全${activeCount}分野・約8分・答え合わせは最後` : `直近${ctx.saved.examScores.length}回平均 ${examAverage}/1000`;
  ctx.ui.reviewHint.textContent = due ? `復習のタイミングが来た問題が${due}件あります。` : attempts ? "学習状況に合わせて次の問題を選びます。" : "最初は基本の形と位置から出題します。";
}

export function weakestItems(limit = 8) {
  const results = [];
  for (const prefecture of ctx.prefectures) {
    for (const skill of ALL_SKILLS) {
      if (!isSkillEnabled(ctx.saved.settings.enabledSkills, skill)) continue;
      const summary = getPrefectureSkillSummary(prefecture, skill);
      if (summary && summary.attempts > 0) {
        results.push({ prefecture, skill, attempts: summary.attempts, mastery: summary.mastery });
      }
    }
  }
  return results.sort((a, b) => a.mastery - b.mastery || b.attempts - a.attempts).slice(0, limit);
}

export function renderProgress() {
  const container = document.getElementById("skill-progress");
  container.innerHTML = "";
  const basicCount = effectiveBasicMasteredCount();
  Object.entries(SKILLS).forEach(([code, skill]) => {
    const enabled = isSkillEnabled(ctx.saved.settings.enabledSkills, code);
    const summaries = ctx.prefectures.map((p) => getPrefectureSkillSummary(p, code)).filter(Boolean);
    const attempts = summaries.reduce((s, i) => s + i.attempts, 0);
    const correct = summaries.reduce((s, i) => s + i.correct, 0);
    const mastery = enabled && summaries.length ? summaries.reduce((s, i) => s + (i.mastery || 0), 0) / summaries.length : 1;
    const row = document.createElement("div");
    row.className = "skill-row";
    const status = !enabled
      ? "習得扱い（設定OFF）"
      : basicCount < skill.unlockAt
      ? `あと${skill.unlockAt - basicCount}県習得で解放`
      : `挑戦数 ${attempts}回 正答率 ${attempts ? Math.round(correct / attempts * 100) : 0}%`;
    row.innerHTML = `<span class="skill-code">${code}</span><div><div class="skill-name"><span>${skill.name}</span><span>${status}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.round(mastery * 100)}%"></div></div></div>`;
    container.append(row);
  });
  const weak = weakestItems();
  document.getElementById("weak-prefectures").innerHTML = weak.length ? weak.map((item) => `<span>${item.prefecture.name}・${SKILLS[item.skill].name}</span>`).join("") : '<p class="empty-note">まだ記録がありません。まずは10問遊んでみましょう。</p>';
}

export function syncSkillSettingsInputs() {
  const enabled = enabledSkillsMap();
  const activeCount = ALL_SKILLS.filter((skill) => enabled[skill]).length;
  ALL_SKILLS.forEach((skill) => {
    const input = document.getElementById(`skill-setting-${skill}`);
    if (!input) return;
    input.checked = enabled[skill];
    input.disabled = activeCount <= 1 && enabled[skill];
  });
}

export async function loadData() {
  showScreen(ctx.ui.loading);
  try {
    const [geoResponse, factsResponse] = await Promise.all([
      fetch("./static/data/low_prefectures.geojson"),
      fetch("./static/data/prefecture_facts.json")
    ]);
    if (!geoResponse.ok || !factsResponse.ok) throw new Error("問題データを取得できませんでした。");
    const [nextGeo, factData] = await Promise.all([geoResponse.json(), factsResponse.json()]);
    validateData(nextGeo, factData);
    ctx.geoData = nextGeo;
    ctx.facts = factData.prefectures;
    const byName = new Map(ctx.facts.map((fact) => [fact.name, fact]));
    ctx.prefectures = ctx.geoData.features.map((feature) => {
      const mainGeometry = largestPolygonGeometry(feature.geometry);
      const fact = byName.get(feature.properties.name);
      const cities = Array.isArray(fact.cities) ? fact.cities : fact.city ? [fact.city] : [];
      const stations = Array.isArray(fact.stations) ? fact.stations : fact.station ? [fact.station] : [];
      return {
        ...fact, cities, stations, city: cities[0] || "", station: stations[0] || "",
        feature, mainGeometry,
        center: geometryRepresentativePoint(mainGeometry), shape: shapeStats(mainGeometry)
      };
    }).sort((a, b) => Number(a.code) - Number(b.code));
    ctx.skillTargets = Object.fromEntries(ctx.prefectures.map((pref) => [pref.code, {
      F: pref.cities.map((_, index) => index),
      G: pref.stations.map((_, index) => index)
    }]));
    unlockedBasicCount();
    persist();
    renderHeroMap();
    renderHome();
    showScreen(ctx.ui.home);
  } catch (error) {
    ctx.ui.errorMessage.textContent = error instanceof Error ? error.message : "問題データを読み込めませんでした。";
    showScreen(ctx.ui.error);
  }
}
