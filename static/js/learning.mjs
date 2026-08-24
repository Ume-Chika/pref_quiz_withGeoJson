const INTERVALS = [5 * 60e3, 4 * 60 * 60e3, 24 * 60 * 60e3, 3 * 864e5, 7 * 864e5, 14 * 864e5, 30 * 864e5];

export function blankProgress() {
  return { attempts: 0, correct: 0, streak: 0, lastSeen: 0, averageMs: 0, timeouts: 0, nextDue: 0, mastery: 0, recent: [] };
}

export function normalizeProgress(value, maxResponseMs = 15000) {
  const item = blankProgress();
  if (!value || typeof value !== "object") return item;
  const number = (entry, max = Number.MAX_SAFE_INTEGER) => typeof entry === "number" && Number.isFinite(entry) ? Math.min(max, Math.max(0, entry)) : 0;
  item.attempts = Math.floor(number(value.attempts));
  if (!item.attempts) return item;
  item.correct = Math.min(item.attempts, Math.floor(number(value.correct)));
  item.streak = Math.min(item.attempts, Math.floor(number(value.streak)));
  item.lastSeen = number(value.lastSeen);
  item.averageMs = number(value.averageMs, maxResponseMs);
  item.timeouts = Math.min(item.attempts, Math.floor(number(value.timeouts)));
  item.nextDue = number(value.nextDue);
  item.mastery = number(value.mastery, 1);
  item.recent = Array.isArray(value.recent) ? value.recent.filter((entry) => [-1, 0, 1].includes(entry)).slice(-8) : [];
  return item;
}

export function recordAnswer(previous, { correct, timedOut, responseMs, now = Date.now() }) {
  const item = normalizeProgress(previous);
  const normalizedMs = Math.max(0, Math.min(15000, Math.round(responseMs)));
  item.attempts += 1;
  item.correct += correct ? 1 : 0;
  item.streak = correct ? item.streak + 1 : 0;
  item.lastSeen = now;
  item.averageMs = item.averageMs ? Math.round(item.averageMs * .7 + normalizedMs * .3) : normalizedMs;
  item.timeouts += timedOut ? 1 : 0;
  item.mastery = correct
    ? Math.min(1, item.mastery + (1 - item.mastery) * (normalizedMs < 7000 ? .25 : .19))
    : item.mastery * (timedOut ? .5 : .62);
  item.nextDue = now + (correct ? INTERVALS[Math.min(item.streak - 1, INTERVALS.length - 1)] : 2 * 60e3);
  item.recent = [...item.recent, correct ? 1 : timedOut ? -1 : 0].slice(-8);
  return item;
}

export function schedulingPriority(previous, { now = Date.now(), recentlyShown = false, random = Math.random() }) {
  const item = normalizeProgress(previous);
  const unseen = item.attempts ? 0 : 300;
  const overdue = item.nextDue && item.nextDue <= now ? Math.min(500, (now - item.nextDue) / 36e4 * 18 + 120) : 0;
  const weakness = (1 - item.mastery) * 240;
  return unseen + overdue + weakness + (recentlyShown ? -800 : 0) + random * 90;
}
