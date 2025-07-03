/**
 * HTML要素の取得
 */
const getById = (id) => document.getElementById(id);
const startButton = getById('start-button');
const submitButton = getById('submit-button');
const quizArea = getById('quiz-area');
const labels = Array.from({ length: 4 }, (_, i) => getById(`label${i + 1}`));
const radioButtons = Array.from({ length: 4 }, (_, i) => getById(`select${i + 1}`));
const customAlert = getById('custom-alert-overlay');
const alertTitle = getById('custom-alert-title');
const alertText = getById('custom-alert-text');
const alertConfirmBtn = getById('alert-confirm-btn');
const alertCancelBtn = getById('alert-cancel-btn');
const logButton = getById('log-button');
const logOptionButton = getById('log-option-button');
const logArea = getById('log-area');


/**
 * グローバル変数
 */
let gameState = 'start'; // アプリの状態を管理する変数
let currentCorrectAnswer = '';
let timerId;
let timeLeft = 10;
let quizHistory = []; // 解答履歴を保存する配列を追加
let isFilterIncorrectOnly = false; // 不正解フィルタの状態を管理する変数
// 地図関連の変数
let map = null;
let geoJsonLayer;
let prefectureLayers = {}; // 都道府県名をキーとしてレイヤーを保存
let focusedLayer = null;
const defaultStyle = {
    color: "#cccccc", weight: 1, opacity: 1,
    fillColor: "#f8f8f8", fillOpacity: 1
};
const focusedStyle = {
    color: "#ff7800", weight: 3, opacity: 1,
    fillColor: "yellow", fillOpacity: 0.7
};


/** * イベントリスナー
 */
// スタートボタン
startButton.addEventListener('click', () => {
    startQuiz();
});
// 決定ボタン
submitButton.addEventListener('click', () => {
    checkAnswer();
});
// ログ表示ボタン
logButton.addEventListener('click', () => {
    toggleLogArea();
});
logOptionButton.addEventListener('click', () => {
    isFilterIncorrectOnly = !isFilterIncorrectOnly;
    logOptionButton.classList.toggle('active', isFilterIncorrectOnly);

    if (logArea.style.display === 'block') {
        renderHistory();
    }
});
// キーボード操作
document.addEventListener('keydown', (event) => {
    switch (gameState) {
        case 'quiz':
            handleQuizKeyDown(event);
            break;
        case 'dialog':
            handleDialogKeyDown(event);
            break;
    }
});


/**
 * 地図の初期化とGeoJSONの読み込み
 */
function initMap() {
    // この関数は、処理が完了したことを通知するPromiseを返す
    return new Promise((resolve, reject) => {
        try {
            // Leaflet地図を初期化
            map = L.map('map', {
                center: [36, 138],
                zoom: 5,
                zoomControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false
            });

            // GeoJSONデータを読み込む (ファイルパスはご利用のものに合わせてください)
            fetch('/static/data/low_prefectures.geojson')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('GeoJSONファイルの読み込みに失敗しました。');
                    }
                    return response.json();
                })
                .then(data => {
                    // 読み込んだデータで地図レイヤーを作成
                    geoJsonLayer = L.geoJSON(data, {
                        style: defaultStyle,
                        onEachFeature: function(feature, layer) {
                            const prefName = feature.properties.name;
                            if (prefName) {
                                prefectureLayers[prefName] = layer;
                            }
                        }
                    }).addTo(map);

                    console.log("地図とGeoJSONの初期化が完了しました。");
                    resolve(); // 成功を通知
                })
                .catch(error => reject(error)); // 失敗を通知
        } catch (error) {
            console.error("Leaflet地図の初期化中にエラーが発生:", error);
            reject(error); // 失敗を通知
        }
    });
}




/**
 * ゲームの主要な関数
 */
// クイズを開始する
function startQuiz() {
    gameState = 'quiz';
    clearInterval(timerId);
    timeLeft = 15;
    document.getElementById('time-left').textContent = timeLeft;

    startButton.style.display = 'none';
    quizArea.style.display = 'block';

    // サーバーからクイズデータを取得して表示する処理
    const fetchAndDisplayQuiz = () => {
        fetch('/api/quiz')
            .then(response => response.json())
            .then(quizData => {
                currentCorrectAnswer = quizData.correctAnswer;
                displayQuiz(quizData);

                // クイズが表示されてからタイマーを開始する
                timerId = setInterval(() => {
                    timeLeft -= 0.1;
                    document.getElementById('time-left').textContent = parseFloat(timeLeft.toFixed(1));

                    if (timeLeft <= 0) {
                        clearInterval(timerId);
                        checkAnswer(true);
                    }
                }, 100);
            })
            .catch(error => {
                console.error('クイズの取得に失敗しました:', error);
                alert('クイズデータの読み込みに失敗しました。');
            });
    };

    // 地図が初期化されているかチェック
    if (map === null) {
        // 初回の場合：地図を初期化
        console.log("初回起動です。地図を初期化します...");
        initMap()
            .then(() => {
                // 初期化が成功したら、クイズを取得・表示
                fetchAndDisplayQuiz();
            })
            .catch(error => {
                console.error(error);
                alert('地図の初期化に失敗しました。ページを再読み込みしてください。');
            });
    } else {
        // 2回目以降の場合：地図のサイズを更新し、クイズを取得・表示
        console.log("2回目以降の起動です。");
        map.invalidateSize();
        fetchAndDisplayQuiz();
    }
}

// クイズ画面を更新する
function displayQuiz(data) {
    if (focusedLayer) {
        focusedLayer.setStyle(defaultStyle);
    }

    const correctPrefName = data.correctAnswer;
    const targetLayer = prefectureLayers[correctPrefName];

    if (targetLayer) {
        targetLayer.setStyle(focusedStyle);
        focusedLayer = targetLayer;
        map.flyToBounds(targetLayer.getBounds(), {
            duration: 0.2,
            padding: [50, 50]
        });
    } else {
        console.error(`'${correctPrefName}' の地図データが見つかりません。`);
        map.fitBounds(geoJsonLayer.getBounds());
    }

    for (let i = 0; i < 4; i++) {
        labels[i].textContent = data.choices[i];
        radioButtons[i].value = data.choices[i];
    }
    if(radioButtons.length > 0) {
        radioButtons[0].checked = true;
    }
}

// 答えをチェックする (時間切れ対応)
function checkAnswer(isTimeUp = false) {
    clearInterval(timerId);
    gameState = 'dialog';

    let selectedAnswerValue;
    let isCorrect;

    if (isTimeUp) {
        selectedAnswerValue = "時間切れ";
        isCorrect = false;
    } else {
        const selectedAnswer = document.querySelector('input[name="select"]:checked');
        if (!selectedAnswer) {
            alert('答えを選択してください！');
            gameState = 'quiz'; // 状態をクイズ中に戻す
            // タイマーを再開するなどの処理を追加しても良い
            return;
        }
        selectedAnswerValue = selectedAnswer.value;
        isCorrect = selectedAnswerValue === currentCorrectAnswer;
    }

    const title = isCorrect ? '正解！' : (isTimeUp ? '時間切れ！' : '不正解...');
    const text = isCorrect ? 'やるね！' : `正解は「${currentCorrectAnswer}」でした！`;
    
    const historyEntry = {
        isCorrect: isCorrect,
        prefectureName: currentCorrectAnswer,
        choices: labels.map(label => label.textContent),
        userAnswer: selectedAnswerValue,
        correctAnswer: currentCorrectAnswer
    };
    quizHistory.unshift(historyEntry);
    if (quizHistory.length > 100) {
        quizHistory.pop();
    }
    if (logArea.style.display === 'block') {
        renderHistory();
    }

    originalAlert(title, text, '続ける', '休む')
        .then(userChoice => {
            if (userChoice) {
                startQuiz();
            } else {
                endQuiz();
            }
        });
}


// クイズを終了する
function endQuiz() {
    gameState = 'start';
    startButton.style.display = 'block';
    quizArea.style.display = 'none';
    if(focusedLayer){
        focusedLayer.setStyle(defaultStyle);
        map.fitBounds(geoJsonLayer.getBounds());
    }
}

// 履歴エリアの表示/非表示
function toggleLogArea() {
    const isHidden = logArea.style.display === 'none' || logArea.style.display === '';
    if (isHidden) {
        renderHistory();
        logArea.style.display = 'block';
        logButton.textContent = 'これまでの回答を閉じる△';
    } else {
        logArea.style.display = 'none';
        logButton.textContent = 'これまでの回答を表示▽';
    }
}

// 履歴のミニ地図を初期化する関数
function initLogMap(containerId, prefName) {
    // 地図の基本設定（操作はすべて無効化）
    const logMap = L.map(containerId, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
    });

    // 背景のタイルレイヤー（地理院地図など）は表示しない
    // L.tileLayer('...').addTo(logMap);

    // 表示したい都道府県のレイヤーを探す
    const targetLayer = prefectureLayers[prefName];

    if (targetLayer) {
        // ▼▼▼ 重要：元のレイヤーを壊さないように、GeoJSONデータをコピーして新しいレイヤーを作る ▼▼▼
        const clonedLayer = L.geoJSON(targetLayer.toGeoJSON(), {
            style: focusedStyle // クイズと同じハイライトスタイルを適用
        }).addTo(logMap);

        // 新しく作った地図を、その都道府県がちょうど収まるようにズームする
        logMap.fitBounds(clonedLayer.getBounds());
    }
}

// 履歴を描画する
function renderHistory() {
    logArea.innerHTML = '';
    const historyToRender = isFilterIncorrectOnly ? quizHistory.filter(entry => !entry.isCorrect) : quizHistory;

    if (historyToRender.length === 0) {
        logArea.innerHTML = `<p>${isFilterIncorrectOnly ? '不正解の履歴はありません。' : 'まだ解答履歴がありません。'}</p>`;
        return;
    }

    historyToRender.forEach((entry, index) => {
        const logEntryDiv = document.createElement('div');
        logEntryDiv.className = `log-entry ${entry.isCorrect ? 'correct' : 'incorrect'}`;
        const resultTitle = document.createElement('h3');
        resultTitle.textContent = entry.isCorrect ? '正解' : '不正解';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'log-content';
        logEntryDiv.appendChild(resultTitle);

        // --- ここからが新しい構造の組み立てです ---
        const mapTarget = document.createElement('div');
        mapTarget.className = 'log-map-target';
        mapTarget.id = `log-map-${index}`;
        mapTarget.style.height = ''; // 高さをリセット
        contentDiv.appendChild(mapTarget);

        // 遅延実行で地図を初期化
        setTimeout(() => {
            initLogMap(mapTarget.id, entry.prefectureName);
        }, 0);
        // --- ここまで ---

        const choicesList = document.createElement('ul');
        entry.choices.forEach(choice => {
            const listItem = document.createElement('li');
            if (choice === entry.correctAnswer) {
                listItem.innerHTML = `<strong>${choice}</strong> ⚪︎ 正解`;
            } else if (!entry.isCorrect && choice === entry.userAnswer) {
                listItem.innerHTML = `${choice} × あなたの回答`;
            } else {
                listItem.textContent = choice;
            }
            choicesList.appendChild(listItem);
        });
        contentDiv.appendChild(choicesList);
        logEntryDiv.appendChild(contentDiv);
        logArea.appendChild(logEntryDiv);
    });
}

/**
 * キーボード処理
 */ 
function handleQuizKeyDown(event) {
    let currentIndex = radioButtons.findIndex(rb => rb.checked);
    if (currentIndex === -1) currentIndex = 0;

    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
            event.preventDefault();
            radioButtons[(currentIndex + 1) % radioButtons.length].checked = true;
            break;
        case 'ArrowUp':
        case 'ArrowLeft':
            event.preventDefault();
            radioButtons[(currentIndex - 1 + radioButtons.length) % radioButtons.length].checked = true;
            break;
        case 'Enter':
            event.preventDefault();
            submitButton.click();
            break;
    }
}

function handleDialogKeyDown(event) {
    switch (event.key) {
        case 'Enter':
            event.preventDefault();
            alertConfirmBtn.click();
            break;
        case 'Delete':
        case 'Backspace':
            event.preventDefault();
            alertCancelBtn.click();
            break;
    }
}

/**
 * 自作アラート関数（Promise対応）
 */
function originalAlert(title, text, confirmText, cancelText) {
    return new Promise((resolve) => {
        alertTitle.textContent = title;
        alertText.textContent = text;
        alertConfirmBtn.textContent = confirmText;
        alertCancelBtn.textContent = cancelText;

        customAlert.style.display = 'flex';
        alertConfirmBtn.focus();
        
        const onConfirm = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            customAlert.style.display = 'none';
            alertConfirmBtn.removeEventListener('click', onConfirm);
            alertCancelBtn.removeEventListener('click', onCancel);
        };
        
        alertConfirmBtn.addEventListener('click', onConfirm);
        alertCancelBtn.addEventListener('click', onCancel);
    });
}