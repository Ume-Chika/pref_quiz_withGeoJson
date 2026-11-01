import { ALL_SKILLS, normalizeEnabledSkills, normalizeProgress, effectiveSkillMastery } from "./learning.mjs";
import { STORAGE_KEY, SKILLS } from "./constants.js";
import { ctx } from "./app-context.js";

export function freshSaved() {
  return {
    schema: 2,
    settings: { sound: false, volume: .5, answerMode: "confirm", visualEffects: true, enabledSkills: normalizeEnabledSkills() },
    progress: {},
    examScores: [],
    unlockedBasic: 0,
    recent: [],
    pendingReviews: []
  };
}

export function finiteNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizePendingReviews(value) {
  if (!Array.isArray(value)) return [];
  const reviews = [];
  value.forEach((item) => {
    if (!item || !/^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.code) || !SKILLS[item.skill]) return;
    const subIndex = Number.isInteger(item.subIndex) && item.subIndex >= 0 ? item.subIndex : null;
    const review = { code: item.code, skill: item.skill, subIndex, type: ["silhouette", "map"].includes(item.type) ? item.type : "", remaining: Math.floor(finiteNumber(item.remaining, 0, 0, 3)) };
    const previous = reviews.find((candidate) => candidate.code === review.code && candidate.skill === review.skill && (candidate.subIndex ?? null) === subIndex);
    if (!previous) reviews.push(review);
    else if (review.remaining < previous.remaining) Object.assign(previous, review);
  });
  return reviews.slice(0, 20);
}

export function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object" || parsed.schema !== 2) return freshSaved();
    const progress = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed.progress || {})) {
      if (/^(0[1-9]|[1-3]\d|4[0-7]):[A-G](?::\d+)?$/.test(key)) {
        const item = normalizeProgress(value);
        if (item.lastSeen > now) {
          item.nextDue = now + Math.max(0, item.nextDue - item.lastSeen);
          item.lastSeen = now;
        }
        item.nextDue = Math.min(item.nextDue, now + 30 * 86_400_000);
        progress[key] = item;
      }
    }
    const hasSkillAttempt = (s) => Object.entries(progress).some(([key, item]) => key.split(":")[1] === s && item.attempts);
    const inferredUnlock = hasSkillAttempt("G") ? 30
      : hasSkillAttempt("F") ? 22
      : hasSkillAttempt("E") ? 15
      : hasSkillAttempt("D") ? 8
      : hasSkillAttempt("C") ? 3 : 0;
    return {
      ...freshSaved(), ...parsed,
      settings: {
        sound: parsed.settings?.sound === true,
        volume: finiteNumber(parsed.settings?.volume, .5, .1, 1),
        answerMode: ["confirm", "instant"].includes(parsed.settings?.answerMode) ? parsed.settings.answerMode : "confirm",
        visualEffects: parsed.settings?.visualEffects !== false,
        enabledSkills: normalizeEnabledSkills(parsed.settings?.enabledSkills)
      },
      progress,
      highScore: undefined,
      examScores: Array.isArray(parsed.examScores) ? parsed.examScores.map((score) => Math.round(finiteNumber(score, 0, 0, 1000))).slice(0, 3) : [],
      unlockedBasic: Math.max(inferredUnlock, Math.floor(finiteNumber(parsed.unlockedBasic, 0, 0, 47))),
      pendingReviews: normalizePendingReviews(parsed.pendingReviews),
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((item) => item && /^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.code) && SKILLS[item.skill] && typeof item.type === "string").slice(0, 30).map((item) => ({
        code: item.code, skill: item.skill, subIndex: Number.isInteger(item.subIndex) && item.subIndex >= 0 ? item.subIndex : null,
        type: item.type.slice(0, 40), correct: item.correct === true, timedOut: item.timedOut === true,
        newItem: item.newItem === true, at: finiteNumber(item.at, 0, 0, Date.now() + 86_400_000),
        answer: typeof item.answer === "string" ? item.answer.slice(0, 80) : "",
        selectedCode: /^(0[1-9]|[1-3]\d|4[0-7])$/.test(item.selectedCode) ? item.selectedCode : ""
      })) : []
    };
  } catch (_) {
    return freshSaved();
  }
}

export function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx.saved)); } catch (_) { /* Storage can be unavailable. */ }
}

export function enabledSkillsMap() {
  return normalizeEnabledSkills(ctx.saved.settings?.enabledSkills);
}

export function enabledSkillKeys() {
  const map = enabledSkillsMap();
  return ALL_SKILLS.filter((skill) => map[skill]);
}

export function effectiveMastery(code, skill) {
  return effectiveSkillMastery(ctx.saved.progress, code, skill, ctx.saved.settings?.enabledSkills, ctx.skillTargets) ?? 1;
}

export function applyVisualEffects() {
  document.documentElement.classList.toggle("reduce-motion", !ctx.saved?.settings?.visualEffects);
}
