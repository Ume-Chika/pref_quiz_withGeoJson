import { examScore, understandingIndex, understandingMilestone, isSkillEnabled, isSkillApplicable } from "./learning.mjs";
import { SKILLS } from "./constants.js";
import { ctx } from "./app-context.js";
import { persist, enabledSkillKeys } from "./state.js";
import { weakestItems, showScreen, renderHome } from "./ui-screens.js";
import { silhouetteSvg } from "./geo-projection.js";

export function finishGame() {
  cancelAnimationFrame(ctx.timerFrame);
  ctx.questionToken += 1;
  if (ctx.ui.feedback.open) ctx.ui.feedback.close();
  if (ctx.ui.stageZoomToolbar) ctx.ui.stageZoomToolbar.hidden = true;
  ctx.stageMapZoomController?.reset();
  if (ctx.session?.mode === "exam" && ctx.session.answers.length < ctx.session.limit) { ctx.session = null; renderHome(); showScreen(ctx.ui.home); return; }
  if (!ctx.session?.answers.length) { ctx.session = null; renderHome(); showScreen(ctx.ui.home); return; }
  const isExam = ctx.session.mode === "exam";
  const correct = ctx.session.answers.filter((answer) => answer.correct).length;
  const timeouts = ctx.session.answers.filter((answer) => answer.timedOut).length;
  const score = isExam ? examScore(correct, ctx.session.limit) : understandingIndex(ctx.saved.progress, ctx.saved.settings.enabledSkills, ctx.skillTargets);
  if (isExam) { ctx.saved.examScores = [score, ...ctx.saved.examScores].slice(0, 3); persist(); }
  document.getElementById("result-title").textContent = isExam ? "実力テスト結果" : `${ctx.session.answers.length}問終了`;
  document.getElementById("result-score-label").textContent = isExam ? "偶然正解を補正した実力スコア" : "全47県・7分野の都道府県理解度";
  document.getElementById("result-score").textContent = score;
  document.getElementById("result-score-unit").textContent = "/1000";
  const examAverage = isExam ? Math.round(ctx.saved.examScores.reduce((sum, value) => sum + value, 0) / ctx.saved.examScores.length) : 0;
  const reachedLevel = isExam ? 0 : understandingMilestone(ctx.session.understandingBefore, score, ctx.session.answers.length);
  document.getElementById("result-record").textContent = isExam ? `直近${ctx.saved.examScores.length}回平均 ${examAverage}` : `理解度指数 ${reachedLevel}台に到達`;
  document.getElementById("result-record").hidden = !isExam && !reachedLevel;
  document.getElementById("result-correct").textContent = `${correct}/${ctx.session.answers.length}`;
  document.getElementById("result-rate").textContent = `${Math.round(correct / ctx.session.answers.length * 100)}%`;
  document.getElementById("result-combo-label").textContent = isExam ? "平均回答時間" : "最大連続正解";
  document.getElementById("result-combo").textContent = isExam ? `${(ctx.session.answers.reduce((sum, answer) => sum + answer.responseMs, 0) / ctx.session.answers.length / 1000).toFixed(1)}秒` : ctx.session.maxCombo;
  document.getElementById("result-timeouts").textContent = timeouts;
  const weakest = weakestItems(1)[0];
  const scheduled = Object.entries(ctx.saved.progress).filter(([key, item]) => {
    const [code, skill] = key.split(":");
    return item.attempts && isSkillEnabled(ctx.saved.settings.enabledSkills, skill) && isSkillApplicable(code, skill, ctx.skillTargets);
  }).sort(([, a], [, b]) => a.nextDue - b.nextDue)[0];
  const next = [...ctx.saved.pendingReviews].filter((review) => isSkillEnabled(ctx.saved.settings.enabledSkills, review.skill) && isSkillApplicable(review.code, review.skill, ctx.skillTargets)).sort((a, b) => a.remaining - b.remaining)[0] || (scheduled && { code: scheduled[0].slice(0, 2), skill: scheduled[0].split(":")[1], remaining: null });
  const nextPrefecture = next && ctx.prefectures.find((prefecture) => prefecture.code === next.code);
  const nextTiming = next?.remaining === null ? "" : next?.remaining ? `${next.remaining}問後に` : "最初に";
  const nextText = nextPrefecture ? `次の復習候補：${nextPrefecture.name}の「${SKILLS[next.skill].name}」${nextTiming ? `（${nextTiming}）` : ""}。` : "次の復習候補：新しい都道府県。";
  const weakestText = weakest ? `現在の苦手：${weakest.prefecture.name}の「${SKILLS[weakest.skill].name}」。` : "現在の苦手：まだ判定できません。";
  if (isExam) {
    const activeSkills = enabledSkillKeys();
    const skillResults = activeSkills.map((skill) => {
      const total = ctx.session.answers.filter((answer) => answer.skill === skill).length;
      const correctCount = ctx.session.answers.filter((answer) => answer.skill === skill && answer.correct).length;
      return { skill, total, correct: correctCount, rate: total ? correctCount / total : 1 };
    }).filter((item) => item.total > 0);
    const minimum = Math.min(...skillResults.map((item) => item.rate));
    const weakNames = skillResults.filter((item) => Math.abs(item.rate - minimum) < 1e-9).map((item) => SKILLS[item.skill].name);
    const weaknessText = minimum === 1 ? "弱かった分野：ありません（全分野満点）。" : `弱かった分野：${weakNames.join("・")}。`;
    document.getElementById("result-review").textContent = `${weaknessText} 通常学習で復習できます。試験結果は理解度指数へ影響しません。`;
  } else document.getElementById("result-review").textContent = `${weakestText} ${nextText} 次の10問も苦手・復習時期・未学習を優先します。`;
  const mistakes = [...new Map(ctx.session.answers.filter((item) => !item.correct).map((item) => [item.code, item])).values()];
  document.getElementById("result-mistakes").hidden = !mistakes.length;
  document.getElementById("result-mistake-list").replaceChildren(...mistakes.map((answer) => {
    const prefecture = ctx.prefectures.find((item) => item.code === answer.code);
    const card = document.createElement("article");
    card.className = "result-mistake-card";
    card.innerHTML = `${silhouetteSvg(prefecture)}<div><strong>${prefecture.name}</strong><small>${SKILLS[answer.skill].name}・${answer.timedOut ? "時間切れ" : "不正解"}</small></div>`;
    const correction = document.createElement("small");
    correction.textContent = `あなた：${answer.answer || "未回答"} ／ 正解：${answer.correctAnswer}`;
    card.querySelector("div").append(correction);
    return card;
  }));
  document.getElementById("replay-button").dataset.mode = "learn";
  document.getElementById("replay-button").textContent = isExam ? "おすすめ学習で復習" : "おすすめ学習をもう10問";
  showScreen(ctx.ui.result);
  renderHome();
}
