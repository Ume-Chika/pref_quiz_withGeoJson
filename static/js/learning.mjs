const INTERVALS = [5 * 60e3, 4 * 60 * 60e3, 24 * 60 * 60e3, 3 * 864e5, 7 * 864e5, 14 * 864e5, 30 * 864e5];
export const ALL_SKILLS = ["A", "B", "C", "D", "E", "F", "G"];

export function blankProgress() {
  return { attempts: 0, correct: 0, streak: 0, lastSeen: 0, averageMs: 0, timeouts: 0, nextDue: 0, mastery: 0, recent: [] };
}

export function normalizeEnabledSkills(value) {
  const result = {};
  for (const skill of ALL_SKILLS) {
    result[skill] = !value || typeof value !== "object" ? true : value[skill] !== false;
  }
  if (!ALL_SKILLS.some((skill) => result[skill])) {
    result.A = true;
  }
  return result;
}

export function isSkillEnabled(enabledSkills, skill) {
  if (!ALL_SKILLS.includes(skill)) return false;
  if (!enabledSkills || typeof enabledSkills !== "object") return true;
  return normalizeEnabledSkills(enabledSkills)[skill] !== false;
}

export function isSkillApplicable(code, skill, targets = null) {
  if (!ALL_SKILLS.includes(skill)) return false;
  if (!targets || !["F", "G"].includes(skill)) return true;
  const list = targets?.[code]?.[skill];
  return Array.isArray(list) ? list.length > 0 : true;
}

export function effectiveSkillMastery(progress, code, skill, enabledSkills = null, targets = null) {
  if (!isSkillEnabled(enabledSkills, skill)) return 1;
  if (!isSkillApplicable(code, skill, targets)) return null;
  const list = targets?.[code]?.[skill];
  if (Array.isArray(list) && list.length > 0) {
    const fallback = Math.max(0, Math.min(1, Number(progress?.[`${code}:${skill}`]?.mastery) || 0));
    const sum = list.reduce((acc, index) => {
      const subKey = `${code}:${skill}:${index}`;
      const val = progress?.[subKey] ? Number(progress[subKey].mastery) || 0 : index === 0 ? fallback : 0;
      return acc + Math.max(0, Math.min(1, val));
    }, 0);
    return sum / list.length;
  }
  return Math.max(0, Math.min(1, Number(progress?.[`${code}:${skill}`]?.mastery) || 0));
}

export function deadlinePassed(answeredAt, deadline) {
  return answeredAt >= deadline;
}

export function canIntroduceNewItem(recent) {
  return recent.slice(0, 9).filter((entry) => entry?.newItem).length < 4;
}

export function skillsForMastery(mastered, enabledSkills = null) {
  const unlocked = [
    "A",
    "B",
    ...(mastered >= 3 ? ["C"] : []),
    ...(mastered >= 8 ? ["D"] : []),
    ...(mastered >= 15 ? ["E"] : []),
    ...(mastered >= 22 ? ["F"] : []),
    ...(mastered >= 30 ? ["G"] : []),
  ];
  if (!enabledSkills || typeof enabledSkills !== "object") return unlocked;
  const normalized = normalizeEnabledSkills(enabledSkills);
  const filtered = unlocked.filter((skill) => normalized[skill]);
  return filtered.length ? filtered : ALL_SKILLS.filter((skill) => normalized[skill]);
}

export function hasBasicMastery(shapeMastery, locationMastery) {
  return shapeMastery >= .45 && locationMastery >= .45;
}

export function prefectureUnderstanding(progress, code, enabledSkills = null, targets = null) {
  const mastery = (skill) => effectiveSkillMastery(progress, code, skill, enabledSkills, targets);
  const shape = mastery("A") ?? 0;
  const location = mastery("B") ?? 0;
  const basics = .35 * (shape + location) + .3 * Math.sqrt(shape * location);
  const advancedValues = ["C", "D", "E", "F", "G"].map(mastery).filter((val) => val !== null);
  const advanced = advancedValues.length ? advancedValues.reduce((sum, val) => sum + val, 0) / advancedValues.length : 1;
  return .7 * basics + .3 * advanced;
}

export function understandingIndex(progress, enabledSkills = null, targets = null) {
  const total = Array.from({ length: 47 }, (_, index) => prefectureUnderstanding(progress, String(index + 1).padStart(2, "0"), enabledSkills, targets)).reduce((sum, value) => sum + value, 0);
  return Math.round(total / 47 * 1000);
}

export function understandingMilestone(before, after, questionCount) {
  const previousLevel = Math.floor(Math.max(0, Number(before) || 0) / 100);
  const nextLevel = Math.floor(Math.max(0, Number(after) || 0) / 100);
  return questionCount === 10 && nextLevel > previousLevel ? nextLevel * 100 : 0;
}

export function examScore(correct, total = 30) {
  const rate = total > 0 ? Math.max(0, Math.min(total, Number(correct) || 0)) / total : 0;
  return Math.round(1000 * Math.max(0, (rate - .25) / .75));
}

export function canUseIntegratedMode(targetMastery, prerequisiteMastery) {
  return targetMastery >= .55 && prerequisiteMastery >= .45;
}

export { compassVector, geometryRepresentativePoint } from "./learning-geo.mjs";

export function normalizeProgress(value, maxResponseMs = 15000) {
  const item = blankProgress();
  if (!value || typeof value !== "object") return item;
  const number = (entry, max = Number.MAX_SAFE_INTEGER) => typeof entry === "number" && Number.isFinite(entry) ? Math.min(max, Math.max(0, entry)) : 0;
  item.attempts = Math.floor(number(value.attempts));
  if (!item.attempts) return item;
  item.correct = Math.min(item.attempts, Math.floor(number(value.correct)));
  item.streak = Math.min(item.correct, Math.floor(number(value.streak)));
  item.lastSeen = number(value.lastSeen);
  item.averageMs = number(value.averageMs, maxResponseMs);
  item.timeouts = Math.min(item.attempts, Math.floor(number(value.timeouts)));
  item.nextDue = number(value.nextDue);
  item.mastery = item.correct ? number(value.mastery, 1) : 0;
  item.recent = Array.isArray(value.recent) ? value.recent.filter((entry) => [-1, 0, 1].includes(entry)).slice(-Math.min(8, item.attempts)) : [];
  return item;
}

export function recordAnswer(previous, { correct, timedOut, responseMs, evidence = 1, now = Date.now() }) {
  const item = normalizeProgress(previous);
  const normalizedMs = Math.max(0, Math.min(15000, Math.round(responseMs)));
  const weight = Math.max(.1, Math.min(1, evidence));
  item.attempts += 1;
  item.correct += correct ? 1 : 0;
  item.streak = correct ? (weight === 1 ? item.streak + 1 : item.streak) : weight < 1 ? Math.max(0, item.streak - 1) : 0;
  item.lastSeen = now;
  item.averageMs = item.averageMs ? Math.round(item.averageMs * .7 + normalizedMs * .3) : normalizedMs;
  item.timeouts += timedOut ? 1 : 0;
  item.mastery = correct
    ? Math.min(1, item.mastery + (1 - item.mastery) * .22 * weight)
    : item.mastery * (1 - (timedOut ? .5 : .38) * weight);
  item.nextDue = now + (correct ? weight < .5 ? INTERVALS[0] : INTERVALS[Math.max(0, Math.min(item.streak - 1, INTERVALS.length - 1))] : timedOut ? 60e3 : 2 * 60e3);
  item.recent = [...item.recent, correct ? 1 : timedOut ? -1 : 0].slice(-8);
  return item;
}

export function schedulingPriority(previous, { now = Date.now(), recentlyShown = false, random = Math.random() }) {
  const item = normalizeProgress(previous);
  const unseen = item.attempts ? 0 : 300;
  const overdue = item.nextDue && item.nextDue <= now ? Math.min(500, (now - item.nextDue) / 36e4 * 18 + 120) : 0;
  const upcoming = item.nextDue > now && item.lastSeen < item.nextDue ? Math.min(80, Math.max(0, (now - item.lastSeen) / (item.nextDue - item.lastSeen) * 80)) : 0;
  const weakness = (1 - item.mastery) * 240;
  const hesitation = item.averageMs ? Math.max(0, item.averageMs - 7000) / 8000 * 45 : 0;
  return unseen + overdue + upcoming + weakness + hesitation + (recentlyShown ? -800 : 0) + random * 90;
}
