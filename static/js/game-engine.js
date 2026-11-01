import { deadlinePassed, recordAnswer, understandingIndex } from "./learning.mjs";
import { LOCATION_TYPES, QUESTION_SECONDS } from "./constants.js";
import { ctx } from "./app-context.js";
import { persist } from "./state.js";
import { playTone } from "./audio-utils.js";
import { renderQuestion } from "./question-render.js";
import { showFeedback, questionEvidence } from "./game-feedback.js";
import { buildExamQuestions } from "./question-selection.js";
import { progressKey } from "./study-map-data.js";

import { finishGame } from "./game-result.js";
export { finishGame };

export function findPrefectureByAnswer(answer) {
  return ctx.prefectures.find((item) => item.name === answer || item.capital === answer || item.dish === answer || (item.cities && item.cities.includes(answer)) || (item.stations && item.stations.includes(answer)));
}

export function queueReview(review) {
  ctx.saved.pendingReviews = ctx.saved.pendingReviews.filter((item) => item.code !== review.code || item.skill !== review.skill || (item.subIndex ?? null) !== (review.subIndex ?? null));
  ctx.saved.pendingReviews.push({ ...review, remaining: 3 });
  if (ctx.session) {
    ctx.session.retries = ctx.session.retries.filter((item) => item.code !== review.code || item.skill !== review.skill || (item.subIndex ?? null) !== (review.subIndex ?? null));
    ctx.session.retries.push({ ...review, dueAt: ctx.session.answers.length + 4 });
  }
}

export function updateLearning(question, correct, timedOut, responseMs, answer, selectedCode) {
  const isExam = ctx.session.mode === "exam";
  const now = Date.now();
  const subIndex = question.subIndex;
  const progressKey = subIndex === null || subIndex === undefined ? `${question.prefecture.code}:${question.skill}` : `${question.prefecture.code}:${question.skill}:${subIndex}`;
  if (!isExam) {
    const evidence = questionEvidence(question.type, correct);
    ctx.saved.progress[progressKey] = recordAnswer(ctx.saved.progress[progressKey], { correct, timedOut, responseMs, evidence, now });
    ctx.saved.recent.unshift({
      code: question.prefecture.code, skill: question.skill, subIndex, type: question.type, correct, timedOut,
      newItem: question.isNew, at: now, answer: typeof answer === "string" ? answer.slice(0, 80) : "",
      selectedCode: selectedCode || ""
    });
    ctx.saved.recent = ctx.saved.recent.slice(0, 30);
    persist();
  }
}

export function completeAnswer(answer, timedOut) {
  if (!ctx.session || ctx.session.answered) return;
  const answeredAt = Date.now();
  if (!timedOut && deadlinePassed(answeredAt, ctx.session.deadline)) { timedOut = true; answer = "時間切れ"; }
  if (timedOut && !answer) answer = "時間切れ";
  ctx.session.answered = true;
  cancelAnimationFrame(ctx.timerFrame);
  const question = ctx.session.current;
  const rawResponseMs = Math.max(0, answeredAt - (ctx.session.answerClockStartedAt || ctx.session.startedAt));
  const responseMs = timedOut ? QUESTION_SECONDS * 1000 : Math.min(QUESTION_SECONDS * 1000, rawResponseMs);
  const isLocation = LOCATION_TYPES.includes(question.type);
  const selectedPrefecture = isLocation ? ctx.prefectures.find((item) => item.code === ctx.session.selectedLocation) : findPrefectureByAnswer(answer);
  const correct = !timedOut && (isLocation ? ctx.session.selectedLocation === question.prefecture.code : answer === question.correct);
  ctx.session.combo = correct ? ctx.session.combo + 1 : 0;
  ctx.session.maxCombo = Math.max(ctx.session.maxCombo, ctx.session.combo);
  const selectedCode = isLocation ? ctx.session.selectedLocation : selectedPrefecture?.code || "";
  ctx.session.answers.push({
    code: question.prefecture.code, skill: question.skill, subIndex: question.subIndex ?? null, type: question.type,
    correct, timedOut, responseMs, answer, correctAnswer: question.correct, selectedCode
  });
  if (ctx.session.mode === "exam") {
    if (ctx.session.answers.length >= ctx.session.limit) finishGame();
    else { ctx.session.answered = false; renderQuestion(); }
    return;
  }
  ctx.saved.pendingReviews = ctx.saved.pendingReviews.filter((review) => review.code !== question.prefecture.code || review.skill !== question.skill || (review.subIndex !== null && review.subIndex !== undefined && review.subIndex !== (question.subIndex ?? null)));
  ctx.session.retries = ctx.session.retries.filter((retry) => retry.code !== question.prefecture.code || retry.skill !== question.skill || (retry.subIndex !== null && retry.subIndex !== undefined && retry.subIndex !== (question.subIndex ?? null)));
  ctx.saved.pendingReviews.forEach((review) => { review.remaining = Math.max(0, review.remaining - 1); });
  updateLearning(question, correct, timedOut, responseMs, answer, selectedCode);
  let retry = null;
  if (question.isNew && (question.type === "shapeMemory" || question.skill === "B")) {
    retry = { code: question.prefecture.code, skill: question.skill, subIndex: null, type: question.skill === "A" ? "silhouette" : "map" };
  } else if (!correct) {
    retry = { code: question.prefecture.code, skill: question.skill, subIndex: question.subIndex ?? null, type: "" };
  }
  if (retry) queueReview(retry);
  persist();
  if (ctx.ui.combo) ctx.ui.combo.textContent = ctx.session.combo;
  if (ctx.ui.score) ctx.ui.score.textContent = ctx.session.answers.filter((item) => item.correct).length;
  playTone(correct ? "correct" : "incorrect");
  showFeedback(question, correct, timedOut, answer);
}

export function updateTimer(token) {
  const tick = () => {
    if (token !== ctx.questionToken || !ctx.session || ctx.session.answered) return;
    const now = Date.now();
    if (ctx.session.inputReadyAt && ctx.session.inputReadyAt > now) {
      ctx.ui.timer.style.transform = "scaleX(1)";
      ctx.ui.timer.className = "timer-bar";
      ctx.ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
      ctx.ui.timerText.textContent = "次の問題";
      ctx.timerFrame = requestAnimationFrame(tick);
      return;
    }
    if (ctx.session.locationLocked) {
      ctx.ui.timer.style.transform = "scaleX(1)";
      ctx.ui.timer.className = "timer-bar";
      ctx.ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
      ctx.ui.timerText.textContent = ctx.session.lockLabel || "記憶中";
      ctx.timerFrame = requestAnimationFrame(tick);
      return;
    }
    if (ctx.session.timerHoldUntil && now < ctx.session.timerHoldUntil) {
      ctx.ui.timer.style.transform = "scaleX(1)";
      ctx.ui.timer.className = "timer-bar";
      ctx.ui.timerRoot.setAttribute("aria-valuenow", String(QUESTION_SECONDS));
      ctx.ui.timerText.textContent = "見えたら回答";
      ctx.timerFrame = requestAnimationFrame(tick);
      return;
    }
    const remainMs = Math.max(0, ctx.session.deadline - now);
    const ratio = Math.max(0, Math.min(1, remainMs / (QUESTION_SECONDS * 1000)));
    ctx.ui.timer.style.transform = `scaleX(${ratio})`;
    ctx.ui.timer.className = `timer-bar${ratio < .2 ? " danger" : ratio < .45 ? " warning" : ""}`;
    ctx.ui.timerRoot.setAttribute("aria-valuenow", String(Math.ceil(remainMs / 1000)));
    ctx.ui.timerText.textContent = `残り${Math.ceil(remainMs / 1000)}秒`;
    if (remainMs <= 0) {
      completeAnswer("時間切れ", true);
      return;
    }
    ctx.timerFrame = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(ctx.timerFrame);
  tick();
}

export function resumeTimer() {
  if (!ctx.session || ctx.session.answered) return;
  cancelAnimationFrame(ctx.timerFrame);
  updateTimer(ctx.questionToken);
}

export function submitSelectedAnswer() {
  if (!ctx.session || ctx.session.answered || ctx.session.locationLocked) return;
  if (LOCATION_TYPES.includes(ctx.session.current.type)) {
    if (ctx.session.selectedLocation) completeAnswer(ctx.prefectures.find((item) => item.code === ctx.session.selectedLocation)?.name || "", false);
    return;
  }
  const checked = ctx.ui.answerGrid.querySelector('input[name="answer"]:checked');
  if (checked) completeAnswer(checked.value, false);
}

export function selectLocation(code) {
  if (ctx.session.answered || ctx.session.locationLocked) return;
  ctx.session.selectedLocation = code;
  const clickedPrefecture = ctx.prefectures.find((item) => item.code === code);
  const clickablePaths = [...ctx.ui.stage.querySelectorAll(".map-prefecture.clickable")];
  clickablePaths.forEach((path) => {
    const isCurrent = path.dataset.code === code;
    path.classList.toggle("selected", isCurrent);
    if (isCurrent) path.setAttribute("aria-current", "true");
    else path.removeAttribute("aria-current");
  });
  const selectedPath = clickablePaths.find((path) => path.dataset.code === code);
  const overlay = ctx.ui.stage.querySelector(".stage-map-highlight-overlay");
  if (overlay) {
    overlay.setAttribute("d", selectedPath ? selectedPath.getAttribute("d") || "" : "");
    overlay.classList.toggle("is-active", Boolean(selectedPath));
  }
  ctx.ui.submit.disabled = false;
  ctx.ui.help.textContent = clickedPrefecture ? `「${clickedPrefecture.name}」を選択中` : "日本地図から場所を選んでください。";
  if (ctx.saved.settings.answerMode === "instant") submitSelectedAnswer();
}

export function answerLocation(code) {
  selectLocation(code);
  submitSelectedAnswer();
}

export function startGame(limit, mode = "learn") {
  cancelAnimationFrame(ctx.timerFrame);
  ctx.questionToken += 1;
  ctx.session = {
    mode, limit, answers: [],
    retries: mode === "exam" ? [] : ctx.saved.pendingReviews.map((review) => ({ ...review, dueAt: review.remaining + 1 })),
    recentCodes: ctx.saved.recent.slice(0, 3).reverse().map((item) => item.code),
    recentItems: ctx.saved.recent.slice(0, 4).reverse().map((item) => progressKey(item.code, item.skill, item.subIndex ?? null)),
    recentTypes: ctx.saved.recent.slice(0, 2).reverse().map((item) => item.type),
    combo: 0, maxCombo: 0, answered: false, current: null, deadline: 0, startedAt: 0,
    answerClockStartedAt: 0, timerHoldUntil: 0, inputReadyAt: 0, locationLocked: false, lockLabel: "",
    understandingBefore: understandingIndex(ctx.saved.progress, ctx.saved.settings.enabledSkills, ctx.skillTargets),
    examQuestions: mode === "exam" ? buildExamQuestions() : []
  };
  renderQuestion();
}
