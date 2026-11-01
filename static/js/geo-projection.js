import { geometryRepresentativePoint } from "./learning.mjs";
import { randomOf } from "./audio-utils.js";
import { ctx } from "./app-context.js";

export function validateData(geo, factData) {
  if (geo?.type !== "FeatureCollection" || geo.features?.length !== 47) throw new Error("境界データが47都道府県分ではありません。");
  if (!Array.isArray(factData?.prefectures) || factData.prefectures.length !== 47) throw new Error("都道府県情報が47件ではありません。");
  const geoNames = new Set(geo.features.map((feature) => feature?.properties?.name));
  const factNames = new Set(factData.prefectures.map((fact) => fact.name));
  if (geoNames.size !== 47 || factNames.size !== 47 || [...factNames].some((name) => !geoNames.has(name))) {
    throw new Error("境界データと都道府県情報が一致しません。");
  }
  const totalCities = factData.prefectures.reduce((sum, fact) => sum + (Array.isArray(fact.cities) ? fact.cities.length : fact.city ? 1 : 0), 0);
  const totalStations = factData.prefectures.reduce((sum, fact) => sum + (Array.isArray(fact.stations) ? fact.stations.length : fact.station ? 1 : 0), 0);
  if (totalCities < 10 || totalStations < 10) {
    throw new Error("都市または駅の情報が不足しています。");
  }
}

export function coordinatesOf(geometry, result = []) {
  const walk = (value) => {
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") result.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(geometry.coordinates);
  return result;
}

export function boundsOf(items) {
  const points = items.flatMap((item) => coordinatesOf(item.geometry || item.feature?.geometry || item));
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

export function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(area / 2);
}

export function largestPolygonGeometry(geometry) {
  if (geometry.type === "Polygon") return geometry;
  const coordinates = geometry.coordinates.reduce((largest, polygon) => ringArea(polygon[0]) > ringArea(largest[0]) ? polygon : largest);
  return { type: "Polygon", coordinates };
}

export function silhouetteGeometry(prefecture) {
  const geometry = prefecture.feature.geometry;
  if (geometry.type === "Polygon") return geometry;
  const mainBounds = boundsOf([prefecture.mainGeometry]);
  const nearbyBounds = expandedBounds(mainBounds, 2.5);
  const coordinates = geometry.coordinates.filter((polygon) => {
    const center = geometryRepresentativePoint({ type: "Polygon", coordinates: polygon });
    return center[0] >= nearbyBounds.minX && center[0] <= nearbyBounds.maxX
      && center[1] >= nearbyBounds.minY && center[1] <= nearbyBounds.maxY;
  });
  return { type: "MultiPolygon", coordinates };
}

export function silhouetteViewBounds(prefecture) {
  return expandedBounds(boundsOf([silhouetteGeometry(prefecture)]), .62);
}

export function shapeStats(geometry) {
  const bounds = boundsOf([geometry]);
  const width = Math.max(.001, bounds.maxX - bounds.minX);
  const height = Math.max(.001, bounds.maxY - bounds.minY);
  return { aspect: width / height, fill: Math.min(1, ringArea(geometry.coordinates[0]) / (width * height)) };
}

export function expandedBounds(bounds, factor = 1.5) {
  const width = Math.max(bounds.maxX - bounds.minX, .5);
  const height = Math.max(bounds.maxY - bounds.minY, .5);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { minX: cx - width * factor, maxX: cx + width * factor, minY: cy - height * factor, maxY: cy + height * factor };
}

export function projector(bounds, width, height, padding = 18) {
  const dx = Math.max(bounds.maxX - bounds.minX, .001);
  const dy = Math.max(bounds.maxY - bounds.minY, .001);
  const scale = Math.min((width - padding * 2) / dx, (height - padding * 2) / dy);
  const offsetX = (width - dx * scale) / 2;
  const offsetY = (height - dy * scale) / 2;
  return ([lon, lat]) => [offsetX + (lon - bounds.minX) * scale, offsetY + (bounds.maxY - lat) * scale];
}

export function geometryPath(geometry, project) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join("") + "Z")).join("");
}

export function svgMap(features, viewBounds, { width = 700, height = 470, targetCode = "", targetCodes = [], clickable = false, label = "日本地図" } = {}) {
  const project = projector(viewBounds, width, height);
  const isTarget = (code) => code === targetCode || targetCodes.includes(code);
  const targets = [];
  const paths = features.map((prefecture, index) => {
    const target = isTarget(prefecture.code);
    const d = geometryPath(prefecture.feature.geometry, project);
    if (target) targets.push(d);
    const [centerX, centerY] = project(prefecture.center);
    const attrs = clickable ? `tabindex="${index ? -1 : 0}" role="button" data-code="${prefecture.code}" data-center-x="${centerX.toFixed(2)}" data-center-y="${centerY.toFixed(2)}" aria-label="${prefecture.name}"` : `data-map-code="${prefecture.code}"`;
    return `<path class="map-prefecture${target ? " target" : ""}${clickable ? " clickable" : ""}" d="${d}" ${attrs}/>`;
  }).join("");
  const overlays = targets.map((d) => `<path class="map-target-overlay" d="${d}" aria-hidden="true"/>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="${clickable ? "group" : "img"}" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${paths}${overlays}</svg>`;
}

export function silhouetteSvg(prefecture, effect = "plain") {
  const width = 650;
  const height = 410;
  const geometry = silhouetteGeometry(prefecture);
  const project = projector(silhouetteViewBounds(prefecture), width, height, 38);
  const path = geometryPath(geometry, project);
  if (!ctx.saved.settings.visualEffects) effect = "plain";
  if (effect === "spotlight") {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="暗闇を動くスポットライトで照らされた都道府県の形">
      <defs><mask id="moving-spot"><rect width="100%" height="100%" fill="black"/><circle cy="205" r="92" fill="white"><animate attributeName="cx" values="40;610;150;500;40" dur="7s" repeatCount="indefinite"/><animate attributeName="cy" values="90;260;330;100;90" dur="5.3s" repeatCount="indefinite"/></circle></mask></defs>
      <path class="spotlight-path" d="${path}" mask="url(#moving-spot)"/>
    </svg>`;
  }
  if (effect === "reveal") {
    const [revealX, revealY] = randomOf(coordinatesOf(prefecture.mainGeometry).map(project));
    const revealRadius = Math.max(...coordinatesOf(geometry).map((point) => {
      const [x, y] = project(point);
      return Math.hypot(x - revealX, y - revealY);
    })) + 8;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="徐々に姿を現す都道府県の形">
      <defs><mask id="reveal-mask"><rect width="100%" height="100%" fill="black"/><circle cx="${revealX.toFixed(2)}" cy="${revealY.toFixed(2)}" r="0" fill="white"><animate attributeName="r" from="0" to="${revealRadius.toFixed(2)}" dur="12s" fill="freeze"/></circle></mask></defs>
      <path class="silhouette" d="${path}" mask="url(#reveal-mask)"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="都道府県のシルエット"><path class="silhouette" d="${path}" fill-rule="evenodd"/></svg>`;
}
