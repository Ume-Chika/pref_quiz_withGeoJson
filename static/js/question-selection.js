import { canIntroduceNewItem, hasBasicMastery, isSkillApplicable, isSkillEnabled, schedulingPriority, skillsForMastery } from "./learning.mjs";
import { SKILLS, EXAM_TYPES, EXAM_REGION_COUNTS } from "./constants.js";
import { ctx } from "./app-context.js";
import { enabledSkillKeys, effectiveMastery, persist } from "./state.js";
import { getProgress, getPrefectureSkillSummary, getSkillUnits, progressKey } from "./study-map-data.js";
import { randomOf, shuffle } from "./audio-utils.js";
import { buildQuestion } from "./question-builder.js";

export function unlockedSkills() {
  return skillsForMastery(effectiveBasicMasteredCount(), ctx.saved.settings.enabledSkills);
}

export function basicMasteredCount() {
  return ctx.prefectures.filter((prefecture) => hasBasicMastery(getProgress(prefecture.code, "A").mastery, getProgress(prefecture.code, "B").mastery)).length;
}

export function unlockedBasicCount() {
  const count = Math.max(ctx.saved.unlockedBasic, basicMasteredCount());
  if (count !== ctx.saved.unlockedBasic) { ctx.saved.unlockedBasic = count; persist(); }
  return count;
}

export function effectiveBasicMasteredCount() {
  const effectiveCount = ctx.prefectures.filter((prefecture) => hasBasicMastery(effectiveMastery(prefecture.code, "A"), effectiveMastery(prefecture.code, "B"))).length;
  return Math.max(unlockedBasicCount(), effectiveCount);
}

export function chooseSubItem(prefecture, skill, forcedSubIndex = null, masteryOverride = null) {
  const units = getSkillUnits(prefecture, skill);
  if (!units.length) return { subIndex: null, value: "" };
  if (forcedSubIndex !== null && forcedSubIndex !== undefined && units[forcedSubIndex]) {
    return units[forcedSubIndex];
  }
  if (masteryOverride !== null) {
    return randomOf(units);
  }
  const now = Date.now();
  const scored = units.map((unit) => {
    const item = getProgress(prefecture.code, skill, unit.subIndex);
    return { unit, priority: schedulingPriority(item, { now }) };
  }).sort((a, b) => b.priority - a.priority);
  return scored[0].unit;
}

export function chooseQuestion() {
  const forced = ["localhost", "127.0.0.1"].includes(location.hostname) ? globalThis.__prefQuizTest : null;
  if (forced?.type && SKILLS[forced.skill]) {
    const prefecture = ctx.prefectures.find((item) => item.code === forced.code) || ctx.prefectures.find((item) => isSkillApplicable(item.code, forced.skill, ctx.skillTargets)) || ctx.prefectures[0];
    return buildQuestion(prefecture, forced.skill, forced.type, null, forced.subIndex ?? null);
  }
  const lastCode = ctx.session.recentCodes.at(-1) || "";
  const lastItemKey = ctx.session.recentItems?.at(-1) || "";
  const dueRetryIndex = ctx.session.retries.findIndex((retry) => isSkillEnabled(ctx.saved.settings.enabledSkills, retry.skill) && isSkillApplicable(retry.code, retry.skill, ctx.skillTargets) && retry.dueAt <= ctx.session.answers.length + 1 && retry.code !== lastCode);
  if (dueRetryIndex >= 0) {
    const retry = ctx.session.retries.splice(dueRetryIndex, 1)[0];
    const question = buildQuestion(ctx.prefectures.find((prefecture) => prefecture.code === retry.code), retry.skill, retry.type || "", null, retry.subIndex ?? null);
    question.pendingReview = retry;
    return question;
  }
  const now = Date.now();
  const recentCodes = ctx.session.recentCodes.slice(-3);
  const recentItems = (ctx.session.recentItems || []).slice(-4);
  const recentTypes = ctx.session.recentTypes.slice(-2);
  const skills = unlockedSkills();
  const hasEligiblePractice = skills.some((skill) => ctx.prefectures.some((prefecture) => getPrefectureSkillSummary(prefecture, skill)?.attempts));
  const hasRetryRoom = !ctx.session.limit || ctx.session.answers.length + 4 < ctx.session.limit;
  const allUnits = skills.flatMap((skill) => ctx.prefectures.filter((prefecture) => isSkillApplicable(prefecture.code, skill, ctx.skillTargets)).flatMap((prefecture) => {
    const basicReady = ["A", "B"].includes(skill) || hasBasicMastery(effectiveMastery(prefecture.code, "A"), effectiveMastery(prefecture.code, "B"));
    return getSkillUnits(prefecture, skill).map(({ subIndex }) => {
      const itemKey = progressKey(prefecture.code, skill, subIndex);
      const item = getProgress(prefecture.code, skill, subIndex);
      const waiting = ctx.saved.pendingReviews.some((review) => review.code === prefecture.code && review.skill === skill && (review.subIndex === null || review.subIndex === undefined || review.subIndex === subIndex) && review.remaining > 0);
      const recentlyShown = recentCodes.includes(prefecture.code) || recentItems.includes(itemKey);
      return { prefecture, skill, subIndex, itemKey, item, waiting, basicReady, recentlyShown };
    });
  }));
  const nonRecentPracticeCount = allUnits.filter(({ item, waiting, prefecture, itemKey }) => !waiting && item.attempts > 0 && prefecture.code !== lastCode && itemKey !== lastItemKey).length;
  const allowUnseen = (hasRetryRoom && canIntroduceNewItem(ctx.saved.recent)) || !hasEligiblePractice || nonRecentPracticeCount === 0;
  let candidates = allUnits.map((entry) => {
    const bucket = entry.waiting ? 0 : entry.item.attempts && entry.item.nextDue <= now ? 3 : entry.item.attempts ? 1 : allowUnseen && entry.basicReady ? 2 : 0;
    return { ...entry, bucket, priority: schedulingPriority(entry.item, { now, recentlyShown: entry.recentlyShown }) };
  }).filter(({ bucket }) => bucket > 0);
  if (!candidates.length) {
    candidates = allUnits.filter(({ waiting, basicReady }) => !waiting && basicReady).map((entry) => ({
      ...entry,
      bucket: entry.item.attempts ? 1 : 2,
      priority: schedulingPriority(entry.item, { now, recentlyShown: entry.recentlyShown })
    }));
  }
  if (!candidates.length) {
    candidates = allUnits.map((entry) => ({
      ...entry,
      bucket: 1,
      priority: schedulingPriority(entry.item, { now, recentlyShown: entry.recentlyShown })
    }));
  }
  if (!candidates.length) {
    const fallbackSkill = skills[0] || enabledSkillKeys()[0] || "A";
    const fallbackPref = ctx.prefectures.find((pref) => isSkillApplicable(pref.code, fallbackSkill, ctx.skillTargets) && pref.code !== lastCode) || ctx.prefectures.find((pref) => isSkillApplicable(pref.code, fallbackSkill, ctx.skillTargets)) || ctx.prefectures[0];
    return buildQuestion(fallbackPref, fallbackSkill);
  }
  const nonRepeatPref = candidates.filter(({ prefecture, itemKey }) => prefecture.code !== lastCode && itemKey !== lastItemKey);
  const nonRepeatItem = candidates.filter(({ itemKey }) => itemKey !== lastItemKey);
  const eligible = nonRepeatPref.length ? nonRepeatPref : nonRepeatItem.length ? nonRepeatItem : candidates;
  const freshEligible = eligible.filter(({ prefecture, itemKey }) => !recentCodes.includes(prefecture.code) && !recentItems.includes(itemKey));
  const targetList = freshEligible.length ? freshEligible : eligible;
  targetList.sort((a, b) => b.bucket - a.bucket || b.priority - a.priority);
  const bestBucket = targetList[0]?.bucket;
  const pool = targetList.filter(({ bucket }) => bucket === bestBucket).slice(0, 12);
  let question = null;
  for (const candidate of shuffle(pool)) {
    const built = buildQuestion(candidate.prefecture, candidate.skill, "", null, candidate.subIndex);
    if (!recentTypes.includes(built.type)) { question = built; break; }
    question ||= built;
  }
  return question;
}

export function buildExamQuestions() {
  const activeSkills = enabledSkillKeys();
  const baseCount = Math.floor(30 / activeSkills.length);
  const remainder = 30 % activeSkills.length;
  const skills = shuffle([
    ...activeSkills.flatMap((skill) => Array(baseCount).fill(skill)),
    ...shuffle(activeSkills).slice(0, remainder)
  ]);
  const sample = shuffle(Object.entries(EXAM_REGION_COUNTS).flatMap(([region, count]) => {
    const regionPool = ctx.prefectures.filter((prefecture) => prefecture.region === region);
    const withStation = shuffle(regionPool.filter((pref) => isSkillApplicable(pref.code, "G", ctx.skillTargets)));
    const withoutStation = shuffle(regionPool.filter((pref) => !isSkillApplicable(pref.code, "G", ctx.skillTargets)));
    return [...withStation, ...withoutStation].slice(0, count);
  }));
  const assignedSkills = new Array(sample.length).fill(null);
  const remainingSkills = [...skills];
  for (const constrainedSkill of ["G", "F"]) {
    while (remainingSkills.includes(constrainedSkill)) {
      const idx = remainingSkills.indexOf(constrainedSkill);
      remainingSkills.splice(idx, 1);
      const targetIndex = sample.findIndex((pref, i) => !assignedSkills[i] && isSkillApplicable(pref.code, constrainedSkill, ctx.skillTargets));
      if (targetIndex >= 0) {
        assignedSkills[targetIndex] = constrainedSkill;
      } else {
        const swapIndex = sample.findIndex((pref, i) => !assignedSkills[i] && ctx.prefectures.some((candidate) => candidate.region === pref.region && isSkillApplicable(candidate.code, constrainedSkill, ctx.skillTargets) && !sample.some((s) => s.code === candidate.code)));
        if (swapIndex >= 0) {
          const sameRegionEligible = ctx.prefectures.filter((candidate) => candidate.region === sample[swapIndex].region && isSkillApplicable(candidate.code, constrainedSkill, ctx.skillTargets) && !sample.some((s) => s.code === candidate.code));
          sample[swapIndex] = randomOf(sameRegionEligible);
          assignedSkills[swapIndex] = constrainedSkill;
        } else {
          const fallbackIndex = sample.findIndex((_, i) => !assignedSkills[i]);
          if (fallbackIndex >= 0) assignedSkills[fallbackIndex] = activeSkills.find((s) => !["F", "G"].includes(s)) || "A";
        }
      }
    }
  }
  for (let i = 0; i < sample.length; i += 1) {
    if (!assignedSkills[i]) assignedSkills[i] = remainingSkills.shift() || activeSkills[0] || "A";
  }
  return sample.map((prefecture, index) => {
    const skill = assignedSkills[index];
    return buildQuestion(prefecture, skill, EXAM_TYPES[skill], 1);
  });
}
