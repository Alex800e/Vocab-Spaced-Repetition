// 小学校4〜6年生で習う代表的な英単語の初期データ
const defaultWords = [
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
];

let words = [];
let reviewQueue = [];

// 初期データの読み込み・設定を行う関数
function loadOrInitData() {
    const savedData = localStorage.getItem('vocab_data');
    if (!savedData) {
        // 初めて開く、またはリセットされた時は初期データをセット
        words = defaultWords.map(w => ({
            word: w.word,
            meaning: w.meaning,
            interval: 1,
            nextReview: Date.now()
        }));
        localStorage.setItem('vocab_data', JSON.stringify(words));
    } else {
        words = JSON.parse(savedData);
        // 既存データがある場合、初期データに新単語があれば自動マージ
        let updated = false;
        defaultWords.forEach(dw => {
            const exists = words.some(w => w.word.toLowerCase() === dw.word.toLowerCase());
            if (!exists) {
                words.push({
                    word: dw.word,
                    meaning: dw.meaning,
                    interval: 1,
                    nextReview: Date.now()
                });
                updated = true;
            }
        });
        if (updated) {
            localStorage.setItem('vocab_data', JSON.stringify(words));
        }
    }
}

// データをLocalStorageに保存
function saveData() {
    localStorage.setItem('vocab_data', JSON.stringify(words));
    updateStats();
}

// 単語の追加
function addWord() {
    const wordInput = document.getElementById('wordInput');
    const meaningInput = document.getElementById('meaningInput');
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();

    if (!word || !meaning) {
        alert('単語と意味を入力してください');
        return;
    }

    words.push({
        word: word,
        meaning: meaning,
        interval: 1,
        nextReview: Date.now()
    });

    saveData();
    wordInput.value = '';
    meaningInput.value = '';
    alert(`「${word}」を追加しました`);
    initSession();
}

// 学習セッションの初期化（復習対象の抽出）
function initSession() {
    const now = Date.now();
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

// 音声読み上げ関数（修正版）
function speakWord(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // 前の音声を止める
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US'; // アメリカ英語
        utterance.rate = 0.9;     // 少しだけ聞き取りやすいよう速度を調整（1.0が標準）
        
        window.speechSynthesis.speak(utterance);
    }
}

// スピーカーボタンクリック時のイベント（修正版）
function speakCurrentWord(event) {
    event.stopPropagation(); // カードがクリックされるのを防ぐ
    
    // 現在画面に表示されている英単語のテキストを取得して発音
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
        targetInWords.interval = targetInWords.interval * 2;
        targetInWords.nextReview = Date.now() + (targetInWords.interval * 24 * 60 * 60 * 1000);
    } else {
        targetInWords.interval = 1;
        targetInWords.nextReview = Date.now() + (1 * 24 * 60 * 60 * 1000);
        reviewQueue.push(targetInWords);
    }

    saveData();
    nextCard();
}

// 学習データのリセット機能（新規追加）
function resetAllData() {
    if (confirm("これまでの学習進捗や追加した単語が消去され、小学生向けの初期状態に戻ります。本当によろしいですか？")) {
        localStorage.removeItem('vocab_data');
        loadOrInitData();
        initSession();
        alert("学習データをリセットしました。");
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
    if (words.length === 0) {
        alert('保存するデータがありません');
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(words));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vocab_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

// データの復元（JSONインポート）
function importData(event) {
    const file = event.target.files;
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                if (confirm('現在のデータが上書きされますがよろしいですか？')) {
                    words = imported;
                    saveData();
                    initSession();
                    alert('データをインポートしました');
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
