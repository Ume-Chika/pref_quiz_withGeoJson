import { canUseIntegratedMode, compassVector, isSkillApplicable } from "./learning.mjs";
import { LOCATION_TYPES } from "./constants.js";
import { ctx } from "./app-context.js";
import { effectiveMastery } from "./state.js";
import { getProgress } from "./study-map-data.js";
import { randomMode, shuffle } from "./audio-utils.js";
import { chooseSubItem } from "./question-selection.js";

export function regionPrefectures(prefecture) {
  return ctx.prefectures.filter((item) => prefecture.region === "北海道地方" ? ["北海道地方", "東北地方"].includes(item.region) : item.region === prefecture.region);
}

export function recentConfusion(target, skill) {
  if (ctx.session?.mode === "exam") return null;
  const latest = ctx.saved.recent.find((item) => item.code === target.code && item.skill === skill);
  return latest && !latest.correct && latest.selectedCode && latest.selectedCode !== target.code ? ctx.prefectures.find((item) => item.code === latest.selectedCode) : null;
}

export function nameChoices(target, mastery, strategy = "geo", skill = "") {
  const candidates = ctx.prefectures.filter((item) => item.code !== target.code).map((item) => ({
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

export function valueChoices(target, field, mastery = 0, explicitCorrect = "") {
  const correctVal = explicitCorrect || target[field];
  const extractValues = (pref) => field === "city" ? pref.cities : field === "station" ? pref.stations : [pref[field]].filter(Boolean);
  const sameRegion = shuffle(ctx.prefectures.filter((item) => item.code !== target.code && item.region === target.region).flatMap((item) => extractValues(item).map((val) => ({ item, val }))));
  const others = shuffle(ctx.prefectures.filter((item) => item.code !== target.code && item.region !== target.region).flatMap((item) => extractValues(item).map((val) => ({ item, val }))));
  const candidates = mastery > .35 ? [...sameRegion, ...others] : shuffle([...sameRegion, ...others]);
  const skillByField = { capital: "D", dish: "E", city: "F", station: "G" };
  const confusion = recentConfusion(target, skillByField[field] || "E");
  const confusionVal = confusion ? extractValues(confusion)[0] : "";
  const ordered = confusionVal ? [{ item: confusion, val: confusionVal }, ...candidates.filter(({ val }) => val !== confusionVal)] : candidates;
  const distractors = [];
  for (const entry of ordered) {
    if (entry.val && entry.val !== correctVal && !distractors.includes(entry.val)) {
      distractors.push(entry.val);
      if (distractors.length >= 3) break;
    }
  }
  return shuffle([correctVal, ...distractors]);
}

export function buildQuestion(prefecture, skill, forcedType = "", masteryOverride = null, forcedSubIndex = null) {
  if (!isSkillApplicable(prefecture.code, skill, ctx.skillTargets)) {
    const fallbackPref = ctx.prefectures.find((item) => isSkillApplicable(item.code, skill, ctx.skillTargets));
    if (fallbackPref) prefecture = fallbackPref;
  }
  const chosenUnit = ["F", "G"].includes(skill) ? chooseSubItem(prefecture, skill, forcedSubIndex, masteryOverride) : { subIndex: null, value: "" };
  const subIndex = chosenUnit.subIndex;
  const item = getProgress(prefecture.code, skill, subIndex);
  const mastery = masteryOverride ?? item.mastery ?? 0;
  let type;
  if (skill === "A") {
    const modes = !item.attempts ? ["shapeMemory"] : mastery < .15 ? ["silhouette", "reveal"] : mastery < .45 ? ["silhouette", "reveal", "slitFlow", "spotlight", "silhouetteReverse"] : ["spotlight", "flash", "slitFlow", "reveal", "silhouette", "silhouetteReverse"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("mapShape");
    type = randomMode(modes, "silhouette");
  } else if (skill === "B") {
    const modes = !item.attempts ? ["map"] : mastery < .2 ? ["map", "mapMemory"] : mastery < .55 ? ["map", "mapChoice", "locate", "mapMemory", "mapFlash"] : ["map", "mapChoice", "locate", "locateJapan", "mapMemory", "mapFlash", "compass"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("shapeLocate");
    type = randomMode(modes, "map");
  } else if (skill === "C") {
    const modes = ["region", "regionMember"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("shapeRegion");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("regionMap", "regionShape");
    type = randomMode(modes, "region");
  } else if (skill === "D") {
    const modes = ["capital", "capitalReverse"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("capitalShape");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("capitalMap", "capitalLocate");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "C"))) modes.push("capitalRegion");
    type = randomMode(modes, "capital");
  } else if (skill === "E") {
    const modes = ["dish", "dishReverse"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("dishMap", "dishLocate");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("dishShapeChoice");
    type = randomMode(modes, "dish");
  } else if (skill === "F") {
    const modes = ["city", "cityReverse"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("cityMap", "cityLocate");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("cityShapeChoice");
    type = randomMode(modes, "city");
  } else {
    const modes = ["station", "stationReverse"];
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "B"))) modes.push("stationMap", "stationLocate");
    if (canUseIntegratedMode(mastery, effectiveMastery(prefecture.code, "A"))) modes.push("stationShapeChoice");
    type = randomMode(modes, "station");
  }
  type = forcedType || type;

  const targetValue = skill === "F" ? (chosenUnit.value || prefecture.city) : skill === "G" ? (chosenUnit.value || prefecture.station) : "";
  const question = { prefecture, skill, subIndex, targetValue, type, isNew: masteryOverride === null && !item.attempts, choices: [], correct: "" };
  if (["shapeMemory", "silhouette", "reveal", "spotlight", "flash", "slitFlow", "silhouetteReverse", "mapShape", "map", "mapChoice", "mapFlash", ...LOCATION_TYPES].includes(type)) {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, type === "mapChoice" ? Math.max(.3, mastery) : mastery, skill === "A" ? "shape" : "geo", skill);
  } else if (["capital", "capitalMap", "capitalShape"].includes(type)) {
    question.correct = prefecture.capital;
    question.choices = valueChoices(prefecture, "capital", mastery);
  } else if (type === "capitalReverse") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "D");
  } else if (["region", "regionMap", "regionShape", "capitalRegion", "shapeRegion"].includes(type)) {
    question.correct = prefecture.region;
    question.choices = shuffle([prefecture.region, ...shuffle([...new Set(ctx.facts.map((fact) => fact.region))].filter((region) => region !== prefecture.region)).slice(0, 3)]);
  } else if (type === "regionMember") {
    question.correct = prefecture.name;
    question.choices = shuffle([prefecture.name, ...shuffle(ctx.prefectures.filter((item) => item.region !== prefecture.region)).slice(0, 3).map((item) => item.name)]);
  } else if (type === "dish") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "E");
  } else if (type === "dishShapeChoice") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "shape", "E");
  } else if (["dishReverse", "dishMap"].includes(type)) {
    question.correct = prefecture.dish;
    question.choices = valueChoices(prefecture, "dish", mastery);
  } else if (type === "city") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "F");
  } else if (type === "cityShapeChoice") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "shape", "F");
  } else if (["cityReverse", "cityMap"].includes(type)) {
    question.correct = targetValue;
    question.choices = valueChoices(prefecture, "city", mastery, targetValue);
  } else if (type === "station") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "geo", "G");
  } else if (type === "stationShapeChoice") {
    question.correct = prefecture.name;
    question.choices = nameChoices(prefecture, mastery, "shape", "G");
  } else if (["stationReverse", "stationMap"].includes(type)) {
    question.correct = targetValue;
    question.choices = valueChoices(prefecture, "station", mastery, targetValue);
  } else if (type === "compass") {
    const candidates = ctx.prefectures.filter((item) => item.code !== prefecture.code);
    const ranked = candidates.map((item) => ({ item, ...compassVector(prefecture.center, item.center) })).sort((a, b) => a.distance - b.distance);
    question.reference = ranked.find(({ margin }) => margin >= 7.5)?.item || ranked[0].item;
    const { dx, dy } = compassVector(prefecture.center, question.reference.center);
    const directions = ["東", "北東", "北", "北西", "西", "南西", "南", "南東"];
    question.correct = directions[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    question.choices = shuffle([question.correct, ...shuffle(directions.filter((direction) => direction !== question.correct)).slice(0, 3)]);
  }
  return question;
}
