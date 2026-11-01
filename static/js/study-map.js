import { SKILLS } from "./constants.js";
import { ctx } from "./app-context.js";
import { boundsOf, svgMap } from "./geo-projection.js";
import { getStudyMapMasteryStatuses, prefectureMasteryStatus } from "./study-map-data.js";

export { getStudyMapMasteryStatuses, prefectureMasteryStatus } from "./study-map-data.js";

export function renderStudyMapColors(paths = [...ctx.ui.studyMapCanvas.querySelectorAll(".map-prefecture[data-code]")]) {
  const showStrong = document.getElementById("study-map-show-strong").checked;
  const showWeak = document.getElementById("study-map-show-weak").checked;
  paths.forEach((path) => {
    path.classList.toggle("mastery-strong", showStrong && path.dataset.mastery === "strong");
    path.classList.toggle("mastery-weak", showWeak && path.dataset.mastery === "weak");
  });
  const overlay = ctx.ui.studyMapCanvas.querySelector(".study-map-highlight-overlay");
  const s = paths.find((path) => path.classList.contains("selected"));
  if (overlay && s) overlay.setAttribute("class", `study-map-highlight-overlay is-active${s.classList.contains("mastery-strong") ? " mastery-strong" : ""}${s.classList.contains("mastery-weak") ? " mastery-weak" : ""}`);
}

function formatFactPreview(list, maxItems = 4) {
  if (!Array.isArray(list) || !list.length) return "対象外";
  return list.length <= maxItems ? list.join("・") : `${list.slice(0, maxItems).join("・")} ほか計${list.length}件`;
}

export function renderStudyMapDetail(prefecture, recent) {
  const history = recent.map((item, index) => ({ ...item, ago: index + 1 })).filter((item) => item.code === prefecture.code);
  const status = prefectureMasteryStatus(prefecture);
  document.getElementById("study-map-status").textContent = `${status.label}・理解度 ${status.index}/1000`;
  document.getElementById("study-map-status").className = `study-map-status ${status.kind}`;
  document.getElementById("study-map-name").textContent = prefecture.name;
  document.getElementById("study-map-region").textContent = prefecture.region;
  document.getElementById("study-map-capital").textContent = prefecture.capital;
  document.getElementById("study-map-city").textContent = formatFactPreview(prefecture.cities);
  document.getElementById("study-map-station").textContent = formatFactPreview(prefecture.stations);
  document.getElementById("study-map-dish").textContent = prefecture.dish;
  const list = document.getElementById("study-map-history");
  list.replaceChildren();
  if (!history.length) {
    const item = document.createElement("li");
    item.textContent = "直近の記録はありません";
    list.append(item);
  } else history.forEach((record) => {
    const item = document.createElement("li");
    const result = document.createElement("strong");
    result.textContent = record.correct ? "○ 正解" : record.timedOut ? "× 時間切れ" : "× 不正解";
    item.append(result, `${record.ago}問前・${SKILLS[record.skill].name}`);
    list.append(item);
  });
}

export function renderHeroMap() {
  ctx.ui.heroMap.innerHTML = svgMap(ctx.prefectures, boundsOf(ctx.prefectures), { width: 500, height: 500, label: "" });
}

export function spatialNeighbor(code, key, items) {
  const current = items.find((item) => item.code === code);
  if (!current) return code;
  const [cx, cy] = current.center;
  const vectors = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] };
  const [vx, vy] = vectors[key];
  const candidates = items.filter((item) => item.code !== code).map((item) => {
    const [x, y] = item.center;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const dot = (dx * vx + dy * vy) / dist;
    return { code: item.code, score: dot > .2 ? dist / dot : Infinity };
  }).sort((a, b) => a.score - b.score);
  return candidates[0]?.score < Infinity ? candidates[0].code : code;
}

export function renderStudyMap() {
  const recent = ctx.saved.recent.slice(0, 10);
  const canvas = ctx.ui.studyMapCanvas;
  canvas.innerHTML = svgMap(ctx.prefectures, boundsOf(ctx.prefectures), { width: 700, height: 540, clickable: true, label: "都道府県ごとの現在習熟度を示す日本白地図" });
  ctx.studyMapZoomController?.reset();
  const svg = canvas.querySelector("svg");
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "path");
  overlay.setAttribute("class", "study-map-highlight-overlay");
  overlay.setAttribute("aria-hidden", "true");
  svg.appendChild(overlay);
  const paths = [...svg.querySelectorAll(".map-prefecture[data-code]")];
  const statusMap = getStudyMapMasteryStatuses();
  paths.forEach((path) => {
    const prefecture = ctx.prefectures.find((item) => item.code === path.dataset.code);
    const status = prefectureMasteryStatus(prefecture, statusMap);
    path.dataset.mastery = status.kind;
    path.setAttribute("aria-label", `${prefecture.name}、${status.label}、理解度${status.index}`);
  });
  renderStudyMapColors(paths);

  const updateOverlay = () => {
    const s = paths.find((path) => path.classList.contains("selected"));
    overlay.setAttribute("d", s ? s.getAttribute("d") || "" : "");
    overlay.setAttribute("class", s ? `study-map-highlight-overlay is-active${s.classList.contains("mastery-strong") ? " mastery-strong" : ""}${s.classList.contains("mastery-weak") ? " mastery-weak" : ""}` : "study-map-highlight-overlay");
  };

  const clearSelection = () => {
    paths.forEach((path) => {
      path.classList.remove("selected");
      path.removeAttribute("aria-current");
    });
    updateOverlay();
  };

  const showCode = (code, highlight = true) => {
    const prefecture = ctx.prefectures.find((item) => item.code === code);
    if (!prefecture) return;
    paths.forEach((path) => {
      const isCurrent = highlight && path.dataset.code === code;
      path.classList.toggle("selected", isCurrent);
      if (isCurrent) path.setAttribute("aria-current", "true");
      else path.removeAttribute("aria-current");
    });
    updateOverlay();
    renderStudyMapDetail(prefecture, recent);
  };
  svg.addEventListener("pointerover", (event) => {
    if (ctx.studyMapZoomController?.isDragging()) return;
    const hitCode = event.target.closest?.("[data-code]")?.dataset.code;
    if (hitCode) showCode(hitCode, true);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!ctx.studyMapZoomController?.isDragging()) clearSelection();
  });
  svg.addEventListener("focusin", (event) => {
    const hitCode = event.target.closest?.(".map-prefecture[data-code]")?.dataset.code;
    if (hitCode) showCode(hitCode, true);
  });
  svg.addEventListener("focusout", (event) => {
    if (!svg.contains(event.relatedTarget)) clearSelection();
  });
  svg.addEventListener("click", (event) => {
    if (ctx.studyMapZoomController?.hasDragged()) { ctx.studyMapZoomController.clearDragged(); return; }
    const hitCode = event.target.closest?.(".map-prefecture[data-code]")?.dataset.code;
    if (hitCode) { showCode(hitCode, true); return; }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const nearest = paths.map((path) => ({ code: path.dataset.code, distance: Math.hypot(point.x - Number(path.dataset.centerX), point.y - Number(path.dataset.centerY)) })).sort((a, b) => a.distance - b.distance)[0];
    if (nearest) showCode(nearest.code, true);
  });
  paths.forEach((path) => path.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showCode(path.dataset.code, true); }
    else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const nextCode = spatialNeighbor(path.dataset.code, event.key, ctx.prefectures);
      const next = paths.find((item) => item.dataset.code === nextCode);
      if (next) {
        paths.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
        next.focus();
      }
    }
  }));
  const initial = ctx.prefectures.find((item) => item.code === recent[0]?.code) || ctx.prefectures[0];
  const initialPath = paths.find((path) => path.dataset.code === initial.code);
  if (initialPath) paths.forEach((path) => { path.tabIndex = path === initialPath ? 0 : -1; });
  showCode(initial.code, false);
}
