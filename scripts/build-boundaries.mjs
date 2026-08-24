import { readFileSync, writeFileSync } from "node:fs";

// Input: Natural Earth v5.1.2, 1:10m Admin 1 States, Provinces (public domain).
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/build-boundaries.mjs INPUT OUTPUT");

const names = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

const source = JSON.parse(readFileSync(input, "utf8"));
const japan = source.features.filter(({ properties }) => properties?.adm0_a3 === "JPN");
const byCode = new Map(japan.map((feature) => [feature.properties.iso_3166_2?.slice(-2), feature]));
const features = names.map((name, index) => buildPrefecture(name, index + 1));
const result = { type: "FeatureCollection", features };

validate(result);
writeFileSync(output, `${JSON.stringify(result)}\n`);
console.log(`wrote ${features.length} prefectures to ${output}`);

function buildPrefecture(name, pref) {
  const code = String(pref).padStart(2, "0");
  const feature = byCode.get(code);
  if (!feature?.geometry) throw new Error(`${name}: no polygon`);

  const clean = polygons(feature.geometry)
    .map((polygon) => polygon.map((ring) => simplifyClosed(ring, 0.01)))
    .filter(([outer]) => Math.abs(area(outer)) >= 0.001);
  if (!clean.length) throw new Error(`${name}: no polygon after simplification`);

  return {
    type: "Feature",
    properties: { pref, code, name },
    geometry: clean.length === 1
      ? { type: "Polygon", coordinates: clean[0] }
      : { type: "MultiPolygon", coordinates: clean },
  };
}

function polygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  throw new Error(`unsupported geometry: ${geometry.type}`);
}

function pointKey(point) {
  return `${point[0]},${point[1]}`;
}

function simplifyClosed(ring, tolerance) {
  const points = ring.slice(0, -1);
  let split = 1;
  for (let i = 2; i < points.length; i++) {
    if (distance2(points[0], points[i]) > distance2(points[0], points[split])) split = i;
  }
  const first = rdp(points.slice(0, split + 1), tolerance ** 2);
  const second = rdp([...points.slice(split), points[0]], tolerance ** 2);
  const simplified = [...first.slice(0, -1), ...second].map(([x, y]) => [round(x), round(y)]);
  return simplified.length >= 4 ? simplified : ring.map(([x, y]) => [round(x), round(y)]);
}

function rdp(points, tolerance2) {
  if (points.length <= 2) return points;
  let max = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = segmentDistance2(points[i], points[0], points.at(-1));
    if (distance > max) [max, index] = [distance, i];
  }
  if (max <= tolerance2) return [points[0], points.at(-1)];
  return [...rdp(points.slice(0, index + 1), tolerance2).slice(0, -1), ...rdp(points.slice(index), tolerance2)];
}

function segmentDistance2(p, a, b) {
  const length2 = distance2(a, b);
  if (!length2) return distance2(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length2));
  return distance2(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}

function distance2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function area(ring) {
  let total = 0;
  for (let i = 1; i < ring.length; i++) total += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return total / 2;
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

function validate(data) {
  if (data.features.length !== 47) throw new Error("expected 47 prefectures");
  data.features.forEach((feature, index) => {
    const { pref, code, name } = feature.properties;
    if (pref !== index + 1 || code !== String(pref).padStart(2, "0") || name !== names[index]) {
      throw new Error(`invalid properties at ${index}`);
    }
    for (const polygon of polygons(feature.geometry)) {
      for (const ring of polygon) {
        if (ring.length < 4 || pointKey(ring[0]) !== pointKey(ring.at(-1))) throw new Error(`${name}: invalid ring`);
        if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 122 && x <= 154 && y >= 20 && y <= 46)) {
          throw new Error(`${name}: coordinate out of range`);
        }
      }
    }
  });
}
