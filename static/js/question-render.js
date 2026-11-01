import { QUESTION_SECONDS } from "./constants.js";
import { ctx } from "./app-context.js";
import { progressKey } from "./study-map-data.js";
import { chooseQuestion } from "./question-selection.js";
import { renderVisual } from "./stage-render.js";
import { updateTimer, submitSelectedAnswer } from "./game-engine.js";
import { showScreen } from "./ui-screens.js";
import { regionPrefectures } from "./question-builder.js";
import { expandedBounds, boundsOf, silhouetteSvg, svgMap } from "./geo-projection.js";

export function setChoiceKeyboardHint() {
  ctx.ui.keyboardHint.innerHTML = ctx.saved.settings.answerMode === "instant" ? "<kbd>1</kbd>–<kbd>4</kbd> で回答" : "<kbd>1</kbd>–<kbd>4</kbd> 選択　<kbd>Enter</kbd> 決定";
}

export function restoreChoiceControls() {
  ctx.ui.answerFieldset.hidden = false;
  ctx.ui.submit.hidden = ctx.saved.settings.answerMode === "instant";
  setChoiceKeyboardHint();
}

export function lockPreview(token, duration, beforeUnlock = () => {}, label = "記憶中") {
  ctx.session.locationLocked = true;
  ctx.session.lockLabel = label;
  ctx.ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  ctx.ui.submit.disabled = true;
  setTimeout(() => {
    if (token !== ctx.questionToken) return;
    beforeUnlock();
    ctx.session.locationLocked = false;
    ctx.session.lockLabel = "";
    ctx.ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = false; });
    ctx.session.startedAt = Date.now();
    ctx.session.answerClockStartedAt = ctx.session.startedAt;
    ctx.session.deadline = ctx.session.startedAt + QUESTION_SECONDS * 1000;
  }, duration);
}

export function setQuestionCopy(question) {
  const targetCity = question.targetValue || question.prefecture.city;
  const targetStation = question.targetValue || question.prefecture.station;
  const copy = {
    shapeMemory: ["形の見本", "県名と形をセットで覚えよう", "見本が消えたら、4択で答えてください。"],
    silhouette: ["シルエット", "この都道府県はどこ？", "輪郭を見て答えてください。"],
    reveal: ["じわじわ表示", "だんだん見える県はどこ？", "輪郭上のどこかから、ゆっくり形が広がります。"],
    spotlight: ["スポットライト", "暗闇に隠れた県はどこ？", "動く光から輪郭をつかんでください。"],
    flash: ["フラッシュ記憶", "さっき見えた県はどこ？", "形は一瞬だけ表示されます。"],
    slitFlow: ["隙間シルエット", "隙間を流れていったのはどの県？", "細い隙間を通る輪郭を目で追ってください。"],
    silhouetteReverse: ["形を選ぶ", `${question.prefecture.name}の形はどれ？`, "4つの輪郭から選んでください。"],
    mapShape: ["地図→形", "黄色く光る県の形はどれ？", "位置と形を結びつけましょう。"],
    map: ["周辺地図", "黄色く光る都道府県はどこ？", "周りの県との位置関係も手がかりです。"],
    mapChoice: ["地図を選ぶ", `${question.prefecture.name}はどの地図？`, "4つの周辺地図から選んでください。"],
    locate: ["場所タップ", `${question.prefecture.name}はどこ？`, "日本地図から直接タップしてください。"],
    locateJapan: ["全国地図タップ", `${question.prefecture.name}はどこ？`, "日本全体の地図で、県の中心付近をタップしてください。"],
    mapMemory: ["地図記憶", "この形の都道府県はどこ？", `形を覚えて、${question.prefecture.region}周辺の地図から探してください。`],
    shapeLocate: ["形→地図", "この形の都道府県はどこ？", "形を覚えて、全国地図から選んでください。"],
    mapFlash: ["地図フラッシュ", "さっき光った都道府県はどこ？", "位置を短時間で記憶してください。"],
    compass: ["方角", `${question.reference?.name || ""}から見てどちら？`, `${question.reference?.name || ""}の中心から見た方角を答えてください。`],
    capital: ["県庁所在地", `${question.prefecture.name}の県庁所在地は？`, "4つの選択肢から選んでください。"],
    capitalReverse: ["県庁所在地", `県庁所在地が「${question.prefecture.capital}」の県は？`, "4つの都道府県から選んでください。"],
    capitalMap: ["地図＋県庁所在地", "地図で光る県の県庁所在地は？", "位置と県庁所在地を結びつけましょう。"],
    capitalShape: ["形＋県庁所在地", "この形の県の県庁所在地は？", "輪郭と県庁所在地を結びつけましょう。"],
    capitalLocate: ["県庁所在地→地図", `県庁所在地が「${question.prefecture.capital}」の県はどこ？`, "日本地図から場所を選んでください。"],
    region: ["地方区分", `${question.prefecture.name}は何地方？`, "標準的な八地方区分から選んでください。"],
    regionMember: ["地方区分", `${question.prefecture.region}に属する県はどれ？`, "地方に含まれる県を選んでください。"],
    regionMap: ["地図＋地方区分", "黄色く示した都道府県は何地方？", "位置と地方区分を結びつけましょう。"],
    regionShape: ["形＋地方区分", "この地方に属する黄色い県は何地方？", "地方の形と区分を結びつけましょう。"],
    shapeRegion: ["形→地方", "この形の都道府県は何地方？", "輪郭から地方区分を答えてください。"],
    capitalRegion: ["県庁所在地→地方", `県庁所在地「${question.prefecture.capital}」がある県は何地方？`, "県庁所在地から地方区分を答えてください。"],
    dish: ["郷土料理百選", `「${question.prefecture.dish}」で知られる県は？`, "農林水産省の郷土料理百選から出題しています。"],
    dishReverse: ["郷土料理百選", `${question.prefecture.name}の郷土料理百選は？`, "選定された代表的な料理を選んでください。"],
    dishMap: ["地図＋郷土料理", "地図で光る県の郷土料理は？", "位置と郷土料理を結びつけましょう。"],
    dishShapeChoice: ["郷土料理→形", `「${question.prefecture.dish}」で知られる県の形は？`, "4つの輪郭から選んでください。"],
    dishLocate: ["郷土料理→地図", `郷土料理「${question.prefecture.dish}」の都道府県はどこ？`, "日本地図から場所を選んでください。"],
    city: ["有名都市", `「${targetCity}」がある都道府県は？`, "県庁所在地以外の政令指定都市・中核市・国際観光都市から出題しています。"],
    cityReverse: ["有名都市", `${question.prefecture.name}にある有名都市は？`, "県庁所在地以外の政令指定都市・中核市・国際観光都市から選んでください。"],
    cityMap: ["地図＋有名都市", "地図で光る県にある有名都市（県庁所在地以外）は？", "位置と有名都市を結びつけましょう。"],
    cityShapeChoice: ["都市→形", `「${targetCity}」がある都道府県の形は？`, "4つの輪郭から選んでください。"],
    cityLocate: ["都市→地図", `有名都市「${targetCity}」がある都道府県は？`, "日本地図から場所を選んでください。"],
    station: ["主要駅", `「${targetStation}」がある都道府県は？`, "国土数値情報の乗降客数全国上位50駅から正しい都道府県を選んでください。"],
    stationReverse: ["主要駅", `${question.prefecture.name}にある主要駅は？`, "県名・県庁所在地・F都市名を除いた乗降客数上位50駅から選んでください。"],
    stationMap: ["地図＋主要駅", "地図で光る県の主要駅は？", "位置と主要駅を結びつけましょう。"],
    stationShapeChoice: ["駅→形", `「${targetStation}」がある都道府県の形は？`, "4つの輪郭から選んでください。"],
    stationLocate: ["駅→地図", `「${targetStation}」がある都道府県は？`, "日本地図から場所を選んでください。"]
  }[question.type];
  if (["locate"].includes(question.type)) copy[2] = `${question.prefecture.region}周辺の地図から選んでください。`;
  if (["mapMemory"].includes(question.type)) copy[2] = `形を覚えて、${question.prefecture.region}周辺の地図から探してください。`;
  if (!ctx.saved.settings.visualEffects && ["spotlight", "reveal", "flash", "mapFlash", "mapMemory"].includes(question.type)) {
    copy[2] = question.type === "mapFlash" ? "設定で視覚効果がOFFのため、位置を静止表示しています。" : "設定で視覚効果がOFFのため、輪郭を静止表示しています。";
  }
  [ctx.ui.type.textContent, ctx.ui.title.textContent, ctx.ui.help.textContent] = copy;
}

export function renderAnswers(question) {
  ctx.ui.answerGrid.innerHTML = "";
  const shapeChoices = ["shapeMemory", "silhouetteReverse", "mapShape", "dishShapeChoice", "cityShapeChoice", "stationShapeChoice"].includes(question.type);
  const mapChoices = question.type === "mapChoice";
  const mapChoicePrefectures = mapChoices ? question.choices.map((choice) => ctx.prefectures.find((item) => item.name === choice)) : [];
  const mapChoiceFeatures = mapChoices ? [...new Map(mapChoicePrefectures.flatMap(regionPrefectures).map((item) => [item.code, item])).values()] : [];
  const mapChoiceBounds = mapChoices ? expandedBounds(boundsOf(mapChoicePrefectures.map((item) => item.mainGeometry)), .5) : null;
  ctx.ui.answerGrid.classList.toggle("shape-grid", shapeChoices || mapChoices);
  question.choices.forEach((choice, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "answer-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "answer";
    input.id = `answer-${index}`;
    input.value = choice;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.dataset.key = String(index + 1);
    if (shapeChoices) {
      const choicePrefecture = ctx.prefectures.find((item) => item.name === choice);
      label.className = "shape-option";
      label.setAttribute("aria-label", `${index + 1}番の形`);
      input.setAttribute("aria-label", `${index + 1}番の形`);
      label.innerHTML = silhouetteSvg(choicePrefecture);
    } else if (mapChoices) {
      const choicePrefecture = ctx.prefectures.find((item) => item.name === choice);
      label.className = "map-option";
      label.setAttribute("aria-label", `${index + 1}番の地図`);
      input.setAttribute("aria-label", `${index + 1}番の地図`);
      label.innerHTML = svgMap(mapChoiceFeatures, mapChoiceBounds, { targetCode: choicePrefecture.code, label: `${index + 1}番の周辺地図` });
    } else {
      label.textContent = choice;
    }
    input.addEventListener("change", () => {
      ctx.ui.submit.disabled = false;
      if (ctx.saved.settings.answerMode === "instant") submitSelectedAnswer();
    });
    wrapper.append(input, label);
    ctx.ui.answerGrid.append(wrapper);
  });
}

export function renderQuestion() {
  cancelAnimationFrame(ctx.timerFrame);
  const token = ++ctx.questionToken;
  ctx.session.current = ctx.session.mode === "exam" ? ctx.session.examQuestions[ctx.session.answers.length] : chooseQuestion();
  const question = ctx.session.current;
  ctx.ui.game.dataset.quizType = question.type;
  ctx.ui.game.dataset.code = question.prefecture.code;
  ctx.ui.game.dataset.skill = question.skill;
  ctx.session.selectedLocation = "";
  ctx.session.locationLocked = false;
  if (ctx.session.mode !== "exam") {
    ctx.session.recentCodes.push(question.prefecture.code);
    ctx.session.recentItems.push(progressKey(question.prefecture.code, question.skill, question.subIndex));
    ctx.session.recentTypes.push(question.type);
  }
  ctx.ui.questionNumber.textContent = ctx.session.limit ? `${ctx.session.answers.length + 1}/${ctx.session.limit}` : `${ctx.session.answers.length + 1}/∞`;
  ctx.ui.comboLabel.textContent = ctx.session.mode === "exam" ? "分野" : "連続正解";
  ctx.ui.combo.textContent = ctx.session.mode === "exam" ? question.skill : ctx.session.combo;
  ctx.ui.scoreLabel.textContent = ctx.session.mode === "exam" ? "回答済み" : "正解";
  ctx.ui.score.textContent = ctx.session.mode === "exam" ? ctx.session.answers.length : ctx.session.answers.filter((answer) => answer.correct).length;
  ctx.ui.submit.disabled = true;
  restoreChoiceControls();
  ctx.ui.stage.className = "visual-stage";
  setQuestionCopy(question);
  const inputDelay = ctx.session.mode === "exam" && ctx.session.answers.length ? 350 : 0;
  ctx.session.inputReadyAt = Date.now() + inputDelay;
  renderAnswers(question);
  if (ctx.session.inputReadyAt > Date.now()) {
    ctx.ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = true; });
    setTimeout(() => {
      if (token === ctx.questionToken) ctx.ui.answerGrid.querySelectorAll("input").forEach((input) => { input.disabled = false; });
    }, inputDelay);
  }
  ctx.session.startedAt = ctx.session.inputReadyAt;
  ctx.session.answerClockStartedAt = ctx.session.startedAt;
  ctx.session.deadline = ctx.session.startedAt + QUESTION_SECONDS * 1000;
  ctx.session.timerHoldUntil = 0;
  renderVisual(question, token);
  showScreen(ctx.ui.game);
  requestAnimationFrame(() => ctx.ui.title.focus({ preventScroll: true }));
  updateTimer(token);
}
