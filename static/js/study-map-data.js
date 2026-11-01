import { blankProgress, isSkillApplicable, prefectureUnderstanding } from "./learning.mjs";
import { SKILLS } from "./constants.js";
import { ctx } from "./app-context.js";

export function getSkillUnits(prefecture, skill) {
  if (skill === "F") return prefecture.cities.map((value, subIndex) => ({ subIndex, value }));
  if (skill === "G") return prefecture.stations.map((value, subIndex) => ({ subIndex, value }));
  return [{ subIndex: null, value: "" }];
}

export function progressKey(code, skill, subIndex = null) {
  return subIndex === null || subIndex === undefined ? `${code}:${skill}` : `${code}:${skill}:${subIndex}`;
}

export function getProgress(code, skill, subIndex = null) {
  if (subIndex !== null && subIndex !== undefined) {
    const subKey = progressKey(code, skill, subIndex);
    if (ctx.saved.progress[subKey]) return { ...blankProgress(), ...ctx.saved.progress[subKey] };
    if (subIndex > 0) return blankProgress();
  }
  const baseKey = progressKey(code, skill);
  return { ...blankProgress(), ...(ctx.saved.progress[baseKey] || {}) };
}

export function getPrefectureSkillSummary(prefecture, skill) {
  if (!isSkillApplicable(prefecture.code, skill, ctx.skillTargets)) return null;
  const units = getSkillUnits(prefecture, skill);
  const items = units.map(({ subIndex }) => getProgress(prefecture.code, skill, subIndex));
  const attempts = items.reduce((s, i) => s + i.attempts, 0);
  const correct = items.reduce((s, i) => s + i.correct, 0);
  const mastery = items.reduce((s, i) => s + (i.mastery || 0), 0) / items.length;
  return { attempts, correct, mastery, items };
}

export function getStudyMapMasteryStatuses() {
  const statusMap = new Map();
  const attemptedList = [];
  for (const prefecture of ctx.prefectures) {
    const summaries = Object.keys(SKILLS).map((skill) => getPrefectureSkillSummary(prefecture, skill)).filter(Boolean);
    const attempted = summaries.some((item) => item.attempts > 0);
    const score = prefectureUnderstanding(ctx.saved.progress, prefecture.code, ctx.saved.settings.enabledSkills, ctx.skillTargets);
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

export function prefectureMasteryStatus(prefecture, statusMap = getStudyMapMasteryStatuses()) {
  return statusMap.get(prefecture.code) || { kind: "unlearned", label: "未学習", index: 0 };
}
