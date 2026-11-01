export function compassVector(target, reference) {
  const meanLatitude = (target[1] + reference[1]) / 2 * Math.PI / 180;
  const dx = (target[0] - reference[0]) * Math.cos(meanLatitude);
  const dy = target[1] - reference[1];
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return { dx, dy, distance: Math.hypot(dx, dy), margin: Math.abs(angle % 45 - 22.5) };
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
