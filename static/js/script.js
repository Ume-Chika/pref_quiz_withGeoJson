"use strict";

import { ALL_SKILLS, normalizeEnabledSkills } from "./learning.mjs";
import { LOCATION_TYPES } from "./constants.js";
import { ctx } from "./app-context.js";
import { loadSaved, freshSaved, persist, finiteNumber, applyVisualEffects, enabledSkillsMap } from "./state.js";
import { createMapZoomController } from "./zoom-controller.js";
import { renderStudyMap, renderStudyMapColors } from "./study-map.js";
import { playTone } from "./audio-utils.js";
import { submitSelectedAnswer, startGame, finishGame, resumeTimer } from "./game-engine.js";
import { nextAfterFeedback } from "./game-feedback.js";
import { showScreen, renderHome, renderProgress, syncSkillSettingsInputs, loadData } from "./ui-screens.js";

const $ = (id) => document.getElementById(id);

ctx.saved = loadSaved();
applyVisualEffects();

ctx.ui = {
  app: $("app"), loading: $("loading-screen"), error: $("error-screen"), errorMessage: $("error-message"),
  home: $("home-screen"), game: $("game-screen"), result: $("result-screen"), heroMap: $("hero-map"),
  understanding: $("understanding-index"), understandingStage: $("understanding-stage"), challenged: $("challenged-count"), learning: $("learning-count"), reviewCount: $("review-count"), examSummary: $("exam-summary"), reviewHint: $("next-review-hint"),
  questionNumber: $("question-number"), comboLabel: $("combo-label"), combo: $("combo-count"), scoreLabel: $("score-label"), score: $("score-count"), timer: $("timer-bar"), timerRoot: $("timer"), timerText: $("timer-text"),
  type: $("quiz-type"), title: $("question-title"), help: $("question-help"), stage: $("visual-stage"),
  stageZoomToolbar: $("stage-zoom-toolbar"), stageZoom: $("stage-zoom"), stageZoomValue: $("stage-zoom-value"), stageZoomOut: $("stage-zoom-out"), stageZoomIn: $("stage-zoom-in"), stageZoomReset: $("stage-zoom-reset"),
  answerFieldset: $("answer-fieldset"), answerGrid: $("answer-grid"), submit: $("submit-answer-button"), keyboardHint: $("keyboard-hint"),
  feedback: $("feedback-dialog"), feedbackMark: $("feedback-mark"), feedbackKicker: $("feedback-kicker"),
  feedbackTitle: $("feedback-title"), feedbackDetail: $("feedback-detail"), feedbackComparison: $("feedback-comparison"), feedbackPoints: $("feedback-points"),
  settings: $("settings-dialog"), progress: $("progress-dialog"), studyMap: $("study-map-dialog"), studyMapCanvas: $("study-map-canvas"), resetConfirm: $("confirm-reset-dialog")
};

ctx.studyMapZoomController = createMapZoomController({
  container: ctx.ui.studyMapCanvas,
  zoomInput: $("study-map-zoom"),
  zoomValue: $("study-map-zoom-value"),
  zoomOutBtn: $("study-map-zoom-out"),
  zoomInBtn: $("study-map-zoom-in"),
  zoomResetBtn: $("study-map-zoom-reset"),
});

ctx.stageMapZoomController = createMapZoomController({
  container: ctx.ui.stage,
  zoomInput: $("stage-zoom"),
  zoomValue: $("stage-zoom-value"),
  zoomOutBtn: $("stage-zoom-out"),
  zoomInBtn: $("stage-zoom-in"),
  zoomResetBtn: $("stage-zoom-reset"),
});

$("retry-button").addEventListener("click", loadData);
$("start-ten-button").addEventListener("click", () => startGame(10));
$("start-exam-button").addEventListener("click", () => startGame(30, "exam"));
$("start-endless-button").addEventListener("click", () => startGame(null));
$("study-map-button").addEventListener("click", () => { renderStudyMap(); ctx.ui.studyMap.showModal(); });
$("study-map-show-strong").addEventListener("change", () => renderStudyMapColors());
$("study-map-show-weak").addEventListener("change", () => renderStudyMapColors());
ctx.ui.submit.addEventListener("click", submitSelectedAnswer);
$("next-question-button").addEventListener("click", nextAfterFeedback);
$("quit-game-button").addEventListener("click", finishGame);
$("replay-button").addEventListener("click", (event) => startGame(event.currentTarget.dataset.mode === "exam" ? 30 : 10, event.currentTarget.dataset.mode || "learn"));
$("result-home-button").addEventListener("click", () => { ctx.session = null; showScreen(ctx.ui.home); });
$("game-quit-button").addEventListener("click", () => { if (window.confirm("プレイを中断してホームへ戻りますか？")) finishGame(); });
$("home-button").addEventListener("click", () => {
  cancelAnimationFrame(ctx.timerFrame);
  ctx.questionToken += 1;
  if (ctx.ui.feedback.open) ctx.ui.feedback.close();
  ctx.session = null;
  renderHome();
  showScreen(ctx.ui.home);
});

$("settings-button").addEventListener("click", () => {
  if (!ctx.ui.game.hidden) return;
  syncSkillSettingsInputs();
  $("sound-setting").checked = ctx.saved.settings.sound;
  $("volume-setting").value = String(ctx.saved.settings.volume);
  $("volume-value").textContent = `${Math.round(ctx.saved.settings.volume * 100)}%`;
  $("volume-setting").disabled = !ctx.saved.settings.sound;
  $("answer-mode-setting").value = ctx.saved.settings.answerMode;
  $("visual-effects-setting").checked = ctx.saved.settings.visualEffects;
  ctx.ui.settings.showModal();
});

ALL_SKILLS.forEach((skill) => {
  $(`skill-setting-${skill}`).addEventListener("change", (event) => {
    const next = { ...enabledSkillsMap(), [skill]: event.target.checked };
    if (!ALL_SKILLS.some((key) => next[key])) {
      event.target.checked = true;
      return;
    }
    ctx.saved.settings.enabledSkills = normalizeEnabledSkills(next);
    syncSkillSettingsInputs();
    persist();
    renderHome();
    if (ctx.ui.studyMap.open) renderStudyMap();
  });
});

$("sound-setting").addEventListener("change", (event) => {
  ctx.saved.settings.sound = event.target.checked;
  $("volume-setting").disabled = !event.target.checked;
  persist();
  if (event.target.checked) playTone("correct");
});

$("volume-setting").addEventListener("input", (event) => {
  ctx.saved.settings.volume = finiteNumber(Number(event.target.value), .5, .1, 1);
  $("volume-value").textContent = `${Math.round(ctx.saved.settings.volume * 100)}%`;
  persist();
});

$("answer-mode-setting").addEventListener("change", (event) => { ctx.saved.settings.answerMode = event.target.value; persist(); });
$("visual-effects-setting").addEventListener("change", (event) => {
  ctx.saved.settings.visualEffects = event.target.checked;
  applyVisualEffects();
  persist();
});

$("progress-button").addEventListener("click", () => { if (!ctx.ui.game.hidden) return; renderProgress(); ctx.ui.progress.showModal(); });
$("reset-data-button").addEventListener("click", () => ctx.ui.resetConfirm.showModal());
$("cancel-reset-button").addEventListener("click", () => ctx.ui.resetConfirm.close());
$("confirm-reset-button").addEventListener("click", () => {
  ctx.saved = freshSaved(); applyVisualEffects(); persist(); ctx.ui.resetConfirm.close(); ctx.ui.settings.close(); renderHome();
});

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (ctx.ui.feedback.open && ["Enter", "1", "2", "3", "4"].includes(event.key)) { event.preventDefault(); nextAfterFeedback(); return; }
  if (ctx.ui.feedback.open || ctx.ui.settings.open || ctx.ui.progress.open || ctx.ui.studyMap.open || ctx.ui.resetConfirm.open || ctx.ui.game.hidden || !ctx.session || ctx.session.answered || ctx.session.locationLocked || Date.now() < ctx.session.inputReadyAt) return;
  const number = Number(event.key);
  const isLocation = LOCATION_TYPES.includes(ctx.session.current.type);
  if (!isLocation && number >= 1 && number <= 4) {
    const input = ctx.ui.answerGrid.querySelectorAll('input[name="answer"]')[number - 1];
    if (input && !input.disabled) { input.checked = true; input.dispatchEvent(new Event("change")); }
  } else if (event.key === "Enter" && !ctx.ui.submit.hidden) {
    event.preventDefault(); submitSelectedAnswer();
  }
});

document.addEventListener("resume", resumeTimer);
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeTimer(); });
window.addEventListener("pageshow", resumeTimer);
window.addEventListener("focus", resumeTimer);

ctx.ui.feedback.addEventListener("cancel", (event) => event.preventDefault());

loadData();
