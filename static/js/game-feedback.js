import { ctx } from "./app-context.js";
import { randomOf } from "./audio-utils.js";
import { svgMap, silhouetteViewBounds } from "./geo-projection.js";
import { findPrefectureByAnswer, finishGame } from "./game-engine.js";
import { renderQuestion } from "./question-render.js";

export function questionEvidence(type, correct = true) {
  return ["shapeMemory", "flash", "mapMemory", "mapFlash"].includes(type) ? correct ? .4 : 1 : ["slitFlow", "mapShape", "shapeLocate", "capitalMap", "capitalShape", "capitalLocate", "regionMap", "regionShape", "shapeRegion", "capitalRegion", "dishMap", "dishShapeChoice", "dishLocate", "cityMap", "cityShapeChoice", "cityLocate", "stationMap", "stationShapeChoice", "stationLocate"].includes(type) ? .65 : 1;
}

export function feedbackDetail(question) {
  const pref = question.prefecture;
  if (question.skill === "A") return `正解は「${pref.name}」。輪郭と周辺県に対する位置を確認しましょう。`;
  if (question.type === "compass") return `${question.reference.name}から見て${pref.name}は、おおよそ${question.correct}です。`;
  if (question.skill === "B") return `${pref.name}は${pref.region}にあります。`;
  if (question.skill === "C") return `${pref.name}は本アプリの区分では${pref.region}です。`;
  if (question.skill === "D") return `${pref.name}の県庁所在地は${pref.capital}です。`;
  if (question.skill === "F") return `${pref.name}の有名都市には${question.targetValue || pref.city}があります。`;
  if (question.skill === "G") return `${pref.name}の主要駅（乗降客数上位）には${question.targetValue || pref.station}があります。`;
  return `農林水産省の郷土料理百選では、${pref.name}から${pref.dish}が選ばれています。`;
}

export function feedbackShapeCard(title, prefecture, value, note, className) {
  const card = document.createElement("article");
  card.className = `feedback-shape-card ${className}`;
  card.dataset.code = prefecture?.code || "";
  const label = document.createElement("span");
  label.textContent = title;
  const visual = document.createElement("div");
  if (prefecture) {
    visual.className = "feedback-map";
    visual.innerHTML = svgMap(ctx.prefectures, silhouetteViewBounds(prefecture), { width: 650, height: 410, targetCode: prefecture.code, label: `${prefecture.name}と周辺県の位置` });
  } else {
    visual.className = "feedback-no-shape";
    visual.textContent = "？";
  }
  const name = document.createElement("strong");
  name.textContent = value;
  const detail = document.createElement("small");
  detail.textContent = note;
  card.append(label, visual, name, detail);
  return card;
}

export function renderFeedbackComparison(question, answer, correct, timedOut) {
  const selectedPrefecture = findPrefectureByAnswer(answer);
  const canCompare = !correct && !timedOut && selectedPrefecture && selectedPrefecture.code !== question.prefecture.code;
  ctx.ui.feedbackComparison.classList.toggle("is-single", !canCompare);
  const correctNote = question.correct === question.prefecture.name ? `${question.prefecture.region}・県庁所在地 ${question.prefecture.capital}` : `答え：${question.correct}`;
  if (correct) {
    ctx.ui.feedbackComparison.replaceChildren(feedbackShapeCard("形と場所を再確認", question.prefecture, question.prefecture.name, correctNote, "correct-answer"));
    return;
  }
  if (!canCompare) {
    const result = timedOut ? "時間切れ" : `あなたの回答：${answer}`;
    const title = question.correct === question.prefecture.name ? "正解の都道府県" : "問題の都道府県";
    ctx.ui.feedbackComparison.replaceChildren(feedbackShapeCard(title, question.prefecture, question.prefecture.name, `${result}／正解：${question.correct}`, "correct-answer"));
    return;
  }
  ctx.ui.feedbackComparison.replaceChildren(
    feedbackShapeCard("あなたの回答", selectedPrefecture, selectedPrefecture.name, answer === selectedPrefecture.name ? selectedPrefecture.region : `回答：${answer}`, "selected-wrong"),
    feedbackShapeCard("正解の都道府県", question.prefecture, question.prefecture.name, correctNote, "correct-answer")
  );
}

export function showFeedback(question, correct, timedOut, answer) {
  ctx.ui.feedback.classList.toggle("incorrect", !correct);
  ctx.ui.feedbackMark.innerHTML = correct
    ? '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="4.5"/></svg>'
    : timedOut
    ? '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M18 11v7l4 3" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 36 36"><path d="M10 10l16 16m0-16L10 26" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>';
  ctx.ui.feedbackKicker.textContent = correct ? "正解" : timedOut ? "時間切れ" : "不正解";
  ctx.ui.feedbackTitle.textContent = correct ? randomOf(["正解", "正解です", "見事正解"]) : timedOut ? "時間切れ" : "おしい";
  ctx.ui.feedbackDetail.textContent = feedbackDetail(question);
  renderFeedbackComparison(question, answer, correct, timedOut);
  const canRetryThisRound = !ctx.session.limit || ctx.session.answers.length + 3 < ctx.session.limit;
  ctx.ui.feedbackPoints.textContent = correct ? ctx.session.combo >= 2 ? `${ctx.session.combo}連続正解` : "学習記録を更新しました" : canRetryThisRound ? "3問はさんで再出題" : "次回優先して復習";
  document.getElementById("next-question-button").textContent = ctx.session.limit && ctx.session.answers.length >= ctx.session.limit ? "結果を見る" : "次の問題";
  ctx.ui.feedback.showModal();
  ctx.ui.feedback.scrollTop = 0;
  requestAnimationFrame(() => {
    ctx.ui.feedback.scrollTop = 0;
    ctx.ui.feedbackTitle.focus({ preventScroll: true });
  });
}

export function nextAfterFeedback() {
  ctx.ui.feedback.close();
  if (ctx.session.limit && ctx.session.answers.length >= ctx.session.limit) finishGame();
  else { ctx.session.answered = false; renderQuestion(); }
}
