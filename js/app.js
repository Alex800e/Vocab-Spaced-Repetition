// データ構造: [{word: "", meaning: "", interval: 1, nextReview: timestamp}]
let words = JSON.parse(localStorage.getItem('vocab_data')) || [];
let reviewQueue = [];

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
        interval: 1, // 初期復習間隔（1日）
        nextReview: Date.now() // 追加直後はすぐ復習可能
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

    // キューの先頭にある単語を表示
    const currentWord = reviewQueue[0];
    cardWord.innerText = currentWord.word;
    cardMeaning.innerText = currentWord.meaning;
    actionButtons.style.display = 'flex';
    speakBtn.style.display = 'inline-block';

    // 自動でネイティブ発音を再生
    speakWord(currentWord.word);
}

// 音声読み上げ関数（Web Speech API）
function speakWord(text) {
    if ('speechSynthesis' in window) {
        // すでに再生中の音声があれば停止
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US'; // アメリカ英語に設定 ('en-GB' にすればイギリス英語になります)
        utterance.rate = 1.0;     // 読み上げ速度 (0.1 〜 10)
        
        window.speechSynthesis.speak(utterance);
    }
}

// スピーカーボタンクリック時のイベント（カードのクリックイベント発火を防ぐ）
function speakCurrentWord(event) {
    event.stopPropagation(); // カード全体のクリックイベントが発生するのを防ぐ
    if (reviewQueue.length > 0) {
        speakWord(reviewQueue[0].word);
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

// キーボードショートカットの実装
document.addEventListener('keydown', function(event) {
    // 入力フォームにフォーカスがある時はショートカットを無効化する
    if (document.activeElement.tagName === 'INPUT') return;

    if (reviewQueue.length === 0) return;

    if (event.code === 'Space') {
        event.preventDefault(); // スペースキーによる画面スクロールを防止
        toggleMeaning();
    } else if (event.code === 'ArrowLeft') {
        reviewResult(false); // 左矢印キーで「忘れた」
    } else if (event.code === 'ArrowRight') {
        reviewResult(true);  // 右矢印キーで「覚えている」
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
    const file = event.target.files[0];
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

// ページを開いたときに起動
initSession();
