// ==========================================
// ★ここに記憶したい英単語リストをすべて記述します★
// 好きなだけ自由に追加・変更してください。
// ==========================================
const myWordList = [
    { word: "hello", meaning: "こんにちは" },
    { word: "thank you", meaning: "ありがとう" },
    { word: "welcome", meaning: "ようこそ、歓迎する" },
    { word: "please", meaning: "おねがいします" },
    { word: "school", meaning: "学校" },
    { word: "english", meaning: "英語" },
    { word: "math", meaning: "算数、数学" },
    { word: "science", meaning: "理科、科学" },
    { word: "music", meaning: "音楽" },
    { word: "art", meaning: "図工、美術" },
    { word: "homeroom", meaning: "学級活動、ホームルーム" },
    { word: "Sunday", meaning: "日曜日" },
    { word: "Monday", meaning: "月曜日" },
    { word: "Friday", meaning: "金曜日" },
    { word: "January", meaning: "1月" },
    { word: "August", meaning: "8月" },
    { word: "December", meaning: "12月" },
    { word: "friend", meaning: "友達" },
    { word: "teacher", meaning: "先生" },
    { word: "station", meaning: "駅" },
    { word: "hospital", meaning: "病院" },
    { word: "want", meaning: "〜が欲しい" },
    { word: "like", meaning: "〜が好き" },
    { word: "play", meaning: "（スポーツや楽器を）する、遊ぶ" },
    { word: "study", meaning: "勉強する" },
    { word: "sports day", meaning: "運動会" },
    { word: "school trip", meaning: "修学旅行" },
    { word: "tomorrow", meaning: "明日" },
    { word: "yesterday", meaning: "昨日" }
    // 新しい単語を追加したい場合は、ここにカンマ(,)区切りで同じように追加していけます
];

let words = [];
let reviewQueue = [];

// データの読み込みと初期化
function loadOrInitData() {
    // それぞれのデバイスのブラウザに保存されている記憶進捗（スケジュール）を読み込む
    const savedProgress = JSON.parse(localStorage.getItem('vocab_progress')) || {};
    
    // JavaScript内にある単語リスト（myWordList）をベースに学習データを組み立てる
    words = myWordList.map(item => {
        // すでに過去に解いた進捗データがあればそれを引き継ぎ、なければ新しく作る
        const progress = savedProgress[item.word.toLowerCase()] || {
            interval: 1,
            nextReview: Date.now() // 初期状態はすぐ出題
        };
        
        return {
            word: item.word,
            meaning: item.meaning,
            interval: progress.interval,
            nextReview: progress.nextReview
        };
    });
    
    // 現在の最新の進捗状態を保存
    saveProgressData();
}

// 個々のデバイス（LocalStorage）に各単語の「進捗スケジュールだけ」を保存
function saveProgressData() {
    const progressToSave = {};
    words.forEach(w => {
        progressToSave[w.word.toLowerCase()] = {
            interval: w.interval,
            nextReview: w.nextReview
        };
    });
    localStorage.setItem('vocab_progress', JSON.stringify(progressToSave));
    updateStats();
}

// 学習セッションの初期化（復習対象の抽出）
function initSession() {
    const now = Date.now();
    // 復習時間を過ぎているものを今日のクイズとして抽出
    reviewQueue = words.filter(w => w.nextReview <= now);
    updateStats();
    nextCard();
}

// 統計情報の更新
function updateStats() {
    document.getElementById('todayCount').innerText = `本日の復習対象: ${reviewQueue.length}問 / 総単語数: ${words.length}`;
}

// 次のカードを表示
function nextCard() {
    const cardWord = document.getElementById('cardWord');
    const cardMeaning = document.getElementById('cardMeaning');
    const actionButtons = document.getElementById('actionButtons');
    const speakBtn = document.getElementById('speakBtn');

    cardMeaning.style.display = 'none';

    if (reviewQueue.length === 0) {
        cardWord.innerText = "今日の復習は完了しました！";
        actionButtons.style.display = 'none';
        speakBtn.style.display = 'none';
        return;
    }

    const currentWord = reviewQueue[0];
    cardWord.innerText = currentWord.word;
    cardMeaning.innerText = currentWord.meaning;
    actionButtons.style.display = 'flex';
    speakBtn.style.display = 'inline-block';

    // 自動でネイティブ発音を再生
    speakWord(currentWord.word);
}

// 音声読み上げ関数（ブラウザの準備を待つ完全版）
function speakWord(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // 前の音声を止める
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US'; // アメリカ英語
        utterance.rate = 0.9;     // スピード

        // 音声データをセットする処理
        const setVoiceAndSpeak = () => {
            const voices = window.speechSynthesis.getVoices();
            // パソコン内の英語（アメリカ英語優先）の声を探す
            const enVoice = voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.includes('en'));
            if (enVoice) {
                utterance.voice = enVoice;
            }
            window.speechSynthesis.speak(utterance);
        };

        // ブラウザの音声準備状況をチェック
        if (window.speechSynthesis.getVoices().length === 0) {
            // まだ準備ができていない場合は、準備完了イベント（onvoiceschanged）を待ってから実行
            window.speechSynthesis.onvoiceschanged = setVoiceAndSpeak;
        } else {
            // すでに準備ができている場合は、すぐ実行
            setVoiceAndSpeak();
        }
    }
}



// スピーカーボタンクリック時のイベント
function speakCurrentWord(event) {
    event.stopPropagation();
    const currentWordText = document.getElementById('cardWord').innerText;
    if (reviewQueue.length > 0 && currentWordText && currentWordText !== "単語がありません") {
        speakWord(currentWordText);
    }
}

// 意味の表示・非表示切り替え
function toggleMeaning() {
    if (reviewQueue.length === 0) return;
    const m = document.getElementById('cardMeaning');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

// 復習結果の処理
function reviewResult(remembered) {
    if (reviewQueue.length === 0) return;
    
    const reviewedWord = reviewQueue.shift();
    const targetInWords = words.find(w => w.word === reviewedWord.word);

    if (!targetInWords) return;

    if (remembered) {
        // 【覚えている】間隔を倍にのばす
        targetInWords.interval = targetInWords.interval * 2;
        targetInWords.nextReview = Date.now() + (targetInWords.interval * 24 * 60 * 60 * 1000);
    } else {
        // 【忘れた】間隔を1日にリセットして最後尾へ
        targetInWords.interval = 1;
        targetInWords.nextReview = Date.now() + (1 * 24 * 60 * 60 * 1000);
        reviewQueue.push(targetInWords);
    }

    saveProgressData();
    nextCard();
}

// 学習データのリセット機能（進捗のみをまっさらにして初期状態に戻す）
function resetAllData() {
    if (confirm("これまでの学習進捗がすべて消去され、最初からやり直しになります。よろしいですか？")) {
        localStorage.removeItem('vocab_progress');
        loadOrInitData();
        initSession();
        alert("学習進捗をリセットしました。");
    }
}

// キーボードショートカットの実装
document.addEventListener('keydown', function(event) {
    if (document.activeElement.tagName === 'INPUT') return;
    if (reviewQueue.length === 0) return;

    if (event.code === 'Space') {
        event.preventDefault();
        toggleMeaning();
    } else if (event.code === 'ArrowLeft') {
        reviewResult(false);
    } else if (event.code === 'ArrowRight') {
        reviewResult(true);
    }
});

// データのバックアップ（JSONエクスポート）
function exportData() {
    const savedProgress = localStorage.getItem('vocab_progress') || "{}";
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(savedProgress);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vocab_progress_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

// データの復元（JSONインポート）
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (typeof imported === 'object' && imported !== null) {
                if (confirm('現在の学習進捗が上書きされますがよろしいですか？')) {
                    localStorage.setItem('vocab_progress', JSON.stringify(imported));
                    loadOrInitData();
                    initSession();
                    alert('進捗データをインポートしました');
                }
            } else {
                alert('ファイルの形式が正しくありません');
            }
        } catch (err) {
            alert('ファイルの読み込みに失敗しました');
        }
    };
    reader.readAsText(file);
}

// 起動時処理
loadOrInitData();
initSession();
