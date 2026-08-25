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

export function hasBasicMastery(shapeMastery, locationMastery) {
  return shapeMastery >= .45 && locationMastery >= .45;
}

export function prefectureUnderstanding(progress, code) {
  const mastery = (skill) => Math.max(0, Math.min(1, Number(progress?.[`${code}:${skill}`]?.mastery) || 0));
  const shape = mastery("A");
  const location = mastery("B");
  const basics = .35 * (shape + location) + .3 * Math.sqrt(shape * location);
  return .7 * basics + .1 * (mastery("C") + mastery("D") + mastery("E"));
}

export function understandingIndex(progress) {
  const total = Array.from({ length: 47 }, (_, index) => prefectureUnderstanding(progress, String(index + 1).padStart(2, "0"))).reduce((sum, value) => sum + value, 0);
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

export function compassVector(target, reference) {
  const meanLatitude = (target[1] + reference[1]) / 2 * Math.PI / 180;
  const dx = (target[0] - reference[0]) * Math.cos(meanLatitude);
  const dy = target[1] - reference[1];
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return { dx, dy, distance: Math.hypot(dx, dy), margin: Math.abs(angle % 45 - 22.5) };
}

export function geometryRepresentativePoint(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const ring = polygons.reduce((largest, polygon) => polygonArea(polygon[0]) > polygonArea(largest[0]) ? polygon : largest)[0];
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const cross = ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    crossSum += cross;
    xSum += (ring[index][0] + ring[index + 1][0]) * cross;
    ySum += (ring[index][1] + ring[index + 1][1]) * cross;
  }
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const centroid = Math.abs(crossSum) > 1e-9
    ? [xSum / (3 * crossSum), ySum / (3 * crossSum)]
    : [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  if (pointInRing(centroid, ring)) return centroid;
  let widest = { width: -1, point: centroid };
  for (const ratio of [.5, .4, .6, .3, .7, .2, .8]) {
    const y = bounds.minY + (bounds.maxY - bounds.minY) * ratio;
    const intersections = [];
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[index];
      const b = ring[previous];
      if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const width = intersections[index + 1] - intersections[index];
      if (width > widest.width) widest = { width, point: [(intersections[index] + intersections[index + 1]) / 2, y] };
    }
  }
  return widest.point;
}

function polygonArea(ring) {
  return Math.abs(ring.slice(1).reduce((sum, point, index) => sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0) / 2);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
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
