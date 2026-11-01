import { NATIONWIDE_LOCATION_TYPES, QUESTION_SECONDS } from "./constants.js";
import { ctx } from "./app-context.js";
import { silhouetteSvg, svgMap, boundsOf, expandedBounds } from "./geo-projection.js";
import { getProgress } from "./study-map-data.js";
import { regionPrefectures } from "./question-builder.js";
import { restoreChoiceControls, lockPreview } from "./question-render.js";
import { selectLocation } from "./game-engine.js";
import { spatialNeighbor } from "./study-map.js";

export { spatialNeighbor };

export function renderVisual(question, token) {
  const { prefecture, type } = question;
  const reducedMotion = !ctx.saved.settings.visualEffects;
  const nationwide = NATIONWIDE_LOCATION_TYPES.includes(type);
  if (ctx.ui.stageZoomToolbar) {
    ctx.ui.stageZoomToolbar.hidden = !nationwide;
    if (!nationwide) ctx.stageMapZoomController?.reset();
  }
  if (type === "shapeMemory") {
    const islandCount = prefecture.feature.geometry.type === "MultiPolygon" ? prefecture.feature.geometry.coordinates.length : 1;
    const previewMs = Math.min(4000, Math.round(2500 + (1 - getProgress(prefecture.code, "A").mastery) * 700 + (islandCount - 1) * 150));
    ctx.ui.stage.innerHTML = `${silhouetteSvg(prefecture)}<div class="memory-teach"><span>形の見本</span><strong>${prefecture.name}</strong></div><div class="memory-curtain">思い出して答えよう</div>`;
    ctx.ui.stage.querySelector(".memory-curtain").style.animationDelay = `${previewMs}ms`;
    ctx.ui.answerFieldset.hidden = true;
    ctx.ui.submit.hidden = true;
    const unlock = () => {
      ctx.ui.stage.querySelector(".memory-teach")?.remove();
      ctx.ui.stage.querySelector(".memory-ready-button")?.remove();
      ctx.ui.type.textContent = "形を思い出す";
      ctx.ui.title.textContent = `${prefecture.name}の形はどれ？`;
      ctx.ui.help.textContent = "見本で見た輪郭を4つから選んでください。";
      restoreChoiceControls();
    };
    if (reducedMotion) {
      ctx.ui.stage.querySelector(".memory-curtain").remove();
      ctx.ui.help.textContent = "形を確認して、覚えたらボタンを押してください。";
      ctx.ui.keyboardHint.textContent = "時間は減りません";
      ctx.ui.stage.insertAdjacentHTML("beforeend", '<button class="memory-ready-button" type="button">覚えた</button>');
      ctx.session.locationLocked = true;
      ctx.session.lockLabel = "確認中";
      ctx.ui.stage.querySelector(".memory-ready-button").addEventListener("click", () => {
        if (token !== ctx.questionToken) return;
        unlock();
        ctx.session.locationLocked = false;
        ctx.session.lockLabel = "";
        ctx.session.startedAt = Date.now();
        ctx.session.answerClockStartedAt = ctx.session.startedAt;
        ctx.session.deadline = ctx.session.startedAt + QUESTION_SECONDS * 1000;
      });
    } else {
      ctx.ui.keyboardHint.textContent = `${(previewMs / 1000).toFixed(1)}秒だけ見本を表示します`;
      lockPreview(token, previewMs, unlock);
    }
  } else if (["silhouette", "reveal", "spotlight", "flash"].includes(type)) {
    ctx.ui.stage.classList.toggle("dark", type === "spotlight" || type === "flash");
    ctx.ui.stage.innerHTML = silhouetteSvg(prefecture, type === "spotlight" ? "spotlight" : type === "reveal" ? "reveal" : "plain");
    if (type === "flash" && !reducedMotion) {
      const curtain = document.createElement("div");
      curtain.className = "memory-curtain";
      curtain.textContent = "思い出して答えよう";
      ctx.ui.stage.append(curtain);
      ctx.ui.keyboardHint.textContent = "形を一瞬だけ記憶します";
      ctx.ui.answerFieldset.hidden = true;
      ctx.ui.submit.hidden = true;
      lockPreview(token, 1750, restoreChoiceControls);
    }
    if (type === "reveal" && !reducedMotion) {
      ctx.ui.keyboardHint.textContent = "わかった時点ですぐ回答できます";
      ctx.session.timerHoldUntil = Date.now() + 6000;
      ctx.session.answerClockStartedAt = ctx.session.timerHoldUntil;
      ctx.session.deadline += 6000;
    }
  } else if (type === "slitFlow") {
    if (reducedMotion) {
      ctx.ui.type.textContent = "シルエット";
      ctx.ui.title.textContent = "この都道府県はどこ？";
      ctx.ui.help.textContent = "視覚効果を使わず、静止した輪郭を表示しています。";
      ctx.ui.stage.innerHTML = silhouetteSvg(prefecture);
    } else {
      const reverse = Math.random() < .5 ? " reverse" : "";
      ctx.ui.stage.innerHTML = `<div class="slit-flow"><div class="slit-moving${reverse}">${silhouetteSvg(prefecture)}</div><div class="slit-cover" aria-hidden="true"></div></div><div class="memory-curtain">どの県だった？</div>`;
      ctx.ui.stage.querySelector(".memory-curtain").style.animationDelay = "5.2s";
      ctx.ui.keyboardHint.textContent = "隙間を通る形を記憶します";
      ctx.ui.answerFieldset.hidden = true;
      ctx.ui.submit.hidden = true;
      lockPreview(token, 5200, restoreChoiceControls);
    }
  } else if (type === "silhouetteReverse") {
    ctx.ui.stage.innerHTML = `<div class="fact-prompt"><span>A</span><strong>${prefecture.name}</strong></div>`;
  } else if (["map", "mapShape"].includes(type)) {
    const localBounds = expandedBounds(boundsOf([prefecture.mainGeometry]), 1.65);
    ctx.ui.stage.innerHTML = svgMap(ctx.prefectures, localBounds, { targetCode: prefecture.code, label: "対象の都道府県を強調した周辺地図" }) + '<span class="stage-corner-label">周辺地図</span>';
  } else if (type === "mapChoice") {
    ctx.ui.stage.innerHTML = `<div class="fact-prompt"><span>B</span><strong>${prefecture.name}</strong></div>`;
  } else if (type === "mapFlash") {
    const regional = regionPrefectures(prefecture);
    const viewBounds = expandedBounds(boundsOf(regional.map((item) => item.mainGeometry)), regional.length > 1 ? .54 : .55);
    ctx.ui.stage.innerHTML = svgMap(regional, viewBounds, { targetCode: prefecture.code, label: "短時間だけ対象を強調する地方地図" });
    if (!reducedMotion) {
      ctx.ui.stage.insertAdjacentHTML("beforeend", '<span class="memory-status" aria-live="polite">1.5秒だけ記憶</span>');
      ctx.ui.keyboardHint.textContent = "位置を短時間で記憶します";
      ctx.ui.answerFieldset.hidden = true;
      ctx.ui.submit.hidden = true;
      lockPreview(token, 1500, () => {
        ctx.ui.stage.querySelector(".target")?.classList.remove("target");
        ctx.ui.stage.querySelector(".map-target-overlay")?.remove();
        ctx.ui.stage.querySelector(".memory-status")?.remove();
        restoreChoiceControls();
      });
    }
  } else if (["locate", "locateJapan", "mapMemory", "shapeLocate", "capitalLocate", "dishLocate", "cityLocate", "stationLocate"].includes(type)) {
    const regional = regionPrefectures(prefecture);
    const visiblePrefectures = nationwide ? ctx.prefectures : regional;
    const viewBounds = expandedBounds(boundsOf(visiblePrefectures.map((item) => item.mainGeometry)), nationwide ? .62 : regional.length > 1 ? .54 : .55);
    const label = nationwide ? "日本地図を直接押して答える全国地図" : "地図を直接押して答える地方地図";
    ctx.ui.stage.innerHTML = svgMap(visiblePrefectures, viewBounds, { clickable: true, targetCode: "", label });
    ctx.ui.stage.classList.toggle("nationwide-stage", nationwide);
    if (nationwide) ctx.stageMapZoomController?.reset();
    ctx.ui.answerFieldset.hidden = true;
    ctx.ui.submit.hidden = ctx.saved.settings.answerMode === "instant";
    ctx.ui.submit.disabled = true;
    ctx.ui.keyboardHint.textContent = ctx.saved.settings.answerMode === "instant" ? "タップ／Tab・矢印で移動、Enterで回答" : "タップ／Tab・矢印で選び、Enterまたは「これで決定」";
    ctx.session.locationLocked = ["mapMemory", "shapeLocate"].includes(type);
    if (["mapMemory", "shapeLocate"].includes(type)) {
      ctx.session.lockLabel = "記憶中";
      const hint = type === "mapMemory" ? "2秒だけ形を記憶" : "1.5秒だけ形を記憶";
      ctx.ui.stage.insertAdjacentHTML("beforeend", `<div class="shape-location-preview">${silhouetteSvg(prefecture)}<span class="memory-status" aria-live="polite">${hint}</span></div>`);
    }
    const svg = ctx.ui.stage.querySelector("svg");
    const keyboardPaths = [...ctx.ui.stage.querySelectorAll(".map-prefecture.clickable")];
    svg.addEventListener("click", (event) => {
      if (ctx.stageMapZoomController?.hasDragged()) { ctx.stageMapZoomController.clearDragged(); return; }
      const targetPref = event.target.closest?.(".map-prefecture.clickable");
      if (targetPref) { selectLocation(targetPref.dataset.code); return; }
      if (event.target.closest?.("button")) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      const nearest = keyboardPaths.map((path) => ({
        code: path.dataset.code,
        distance: Math.hypot(point.x - Number(path.dataset.centerX), point.y - Number(path.dataset.centerY))
      })).sort((a, b) => a.distance - b.distance)[0];
      if (nearest) selectLocation(nearest.code);
    });
    keyboardPaths.forEach((path) => {
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectLocation(path.dataset.code); }
        else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const nextCode = spatialNeighbor(path.dataset.code, event.key, visiblePrefectures);
          const next = keyboardPaths.find((item) => item.dataset.code === nextCode);
          if (next) {
            keyboardPaths.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
            next.focus();
          }
        }
      });
    });
    if (["mapMemory", "shapeLocate"].includes(type)) setTimeout(() => {
      if (token === ctx.questionToken) {
        ctx.ui.stage.querySelector(".target")?.classList.remove("target");
        ctx.ui.stage.querySelector(".map-target-overlay")?.remove();
        ctx.ui.stage.querySelector(".memory-status")?.remove();
        ctx.ui.stage.querySelector(".shape-location-preview")?.remove();
        ctx.session.locationLocked = false;
        ctx.session.startedAt = Date.now();
        ctx.session.answerClockStartedAt = ctx.session.startedAt;
        ctx.session.deadline = ctx.session.startedAt + QUESTION_SECONDS * 1000;
      }
    }, type === "shapeLocate" ? 1500 : 2000);
  } else if (["capitalMap", "dishMap", "cityMap", "stationMap"].includes(type)) {
    const localBounds = expandedBounds(boundsOf([prefecture.mainGeometry]), 1.65);
    const mapLabel = type === "capitalMap" ? "県庁所在地を答える対象都道府県の周辺地図" : type === "dishMap" ? "郷土料理を答える対象都道府県の周辺地図" : type === "cityMap" ? "有名都市を答える対象都道府県の周辺地図" : "主要駅を答える対象都道府県の周辺地図";
    ctx.ui.stage.innerHTML = svgMap(ctx.prefectures, localBounds, { targetCode: prefecture.code, label: mapLabel });
  } else if (["capitalShape", "shapeRegion"].includes(type)) {
    ctx.ui.stage.innerHTML = silhouetteSvg(prefecture);
  } else if (type === "regionMap") {
    ctx.ui.stage.innerHTML = svgMap(ctx.prefectures, boundsOf(ctx.prefectures.map((item) => item.mainGeometry)), { targetCode: prefecture.code, label: "対象県を黄色く示した日本地図" });
  } else if (type === "regionShape") {
    const regional = ctx.prefectures.filter((item) => item.region === prefecture.region);
    ctx.ui.stage.innerHTML = svgMap(regional, expandedBounds(boundsOf(regional.map((item) => item.mainGeometry)), .54), { targetCode: prefecture.code, label: "対象県を黄色く示した地方のまとまり" });
  } else if (type === "compass") {
    ctx.ui.stage.innerHTML = `<div class="compass-prompt"><span>基準<br><strong>${question.reference.name}</strong></span><b aria-hidden="true">→</b><span>どちら？<br><strong>${prefecture.name}</strong></span></div>`;
  } else {
    const prompt = type === "capital" ? prefecture.name : type === "capitalReverse" || type === "capitalRegion" ? prefecture.capital : type === "region" ? prefecture.name : type === "regionMember" ? prefecture.region : ["dish", "dishShapeChoice"].includes(type) ? prefecture.dish : ["city", "cityShapeChoice"].includes(type) ? (question.targetValue || prefecture.city) : ["station", "stationShapeChoice"].includes(type) ? (question.targetValue || prefecture.station) : prefecture.name;
    ctx.ui.stage.innerHTML = `<div class="fact-prompt"><span>${question.skill}</span><strong>${prompt}</strong></div>`;
  }
}
