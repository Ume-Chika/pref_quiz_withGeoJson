const INTERVALS = [5 * 60e3, 4 * 60 * 60e3, 24 * 60 * 60e3, 3 * 864e5, 7 * 864e5, 14 * 864e5, 30 * 864e5];

export function blankProgress() {
  return { attempts: 0, correct: 0, streak: 0, lastSeen: 0, averageMs: 0, timeouts: 0, nextDue: 0, mastery: 0, recent: [] };
}

export function deadlinePassed(answeredAt, deadline) {
  return answeredAt >= deadline;
}

export function canIntroduceNewItem(recent) {
  return recent.slice(0, 9).filter((entry) => entry?.newItem).length < 4;
}

export function skillsForMastery(mastered) {
  return ["A", "B", ...(mastered >= 3 ? ["C"] : []), ...(mastered >= 8 ? ["D"] : []), ...(mastered >= 15 ? ["E"] : [])];
}

export function canUseIntegratedMode(targetMastery, prerequisiteMastery) {
  return targetMastery >= .55 && prerequisiteMastery >= .45;
}

export function compassVector(target, reference) {
  const meanLatitude = (target[1] + reference[1]) / 2 * Math.PI / 180;
  const dx = (target[0] - reference[0]) * Math.cos(meanLatitude);
  const dy = target[1] - reference[1];
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return { dx, dy, distance: Math.hypot(dx, dy), margin: Math.abs(angle % 45 - 22.5) };
}

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
  item.nextDue = now + (correct ? weight < .5 ? INTERVALS[0] : INTERVALS[Math.max(0, Math.min(item.streak - 1, INTERVALS.length - 1))] : weight < 1 ? INTERVALS[Math.max(0, Math.min(item.streak - 1, INTERVALS.length - 1))] : 2 * 60e3);
  item.recent = [...item.recent, correct ? 1 : timedOut ? -1 : 0].slice(-8);
  return item;
}

export function schedulingPriority(previous, { now = Date.now(), recentlyShown = false, random = Math.random() }) {
  const item = normalizeProgress(previous);
  const unseen = item.attempts ? 0 : 300;
  const overdue = item.nextDue && item.nextDue <= now ? Math.min(500, (now - item.nextDue) / 36e4 * 18 + 120) : 0;
  const weakness = (1 - item.mastery) * 240;
  const hesitation = item.averageMs ? Math.max(0, item.averageMs - 7000) / 8000 * 45 : 0;
  return unseen + overdue + weakness + hesitation + (recentlyShown ? -800 : 0) + random * 90;
}
