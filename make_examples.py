#!/usr/bin/env python3
"""単語ごとの例文（英語＋日本語訳）を、英日対訳コーパスから選んで js/data/examples.js を作るスクリプト

使い方（どちらか）:
  python3 make_examples.py --tsv Tatoebaの対訳ファイル.tsv.bz2          … Tatoebaの「文のペア」ファイル（圧縮したまま使えます）。ほかの「英語<TAB>日本語」の2列のファイルも使えます
  python3 make_examples.py --en 英語のファイル --ja 日本語のファイル      … 1行ごとに対応した2つのファイル
そのほかのオプション:
  --no-merge   … 今ある js/data/examples.js の例文を引き継がずに、作り直す（ふつうは、新しい対訳に無い語は、今ある例文を残します）
同じ単語に複数の候補があるときは、短くてやさしい文を選びます。暴力・性的な語などを含む文は除きます。
例文の出典（田中コーパス／Tatoebaプロジェクト）を、画面の下とREADMEに書いています。
"""
import argparse, bz2, gzip, json, os, re, sys, collections, functools
HERE = os.path.dirname(os.path.abspath(__file__))
try:
    import wordfreq
    ZIPF = functools.lru_cache(maxsize=None)(lambda w: wordfreq.zipf_frequency(w, 'en'))
except Exception:
    ZIPF = lambda w: 4.0   # wordfreq が無いときは、やさしさの判定を省く

IRREG = {  # 不規則動詞・名詞の活用形（原形 → 活用形）
 'be':'am is are was were been being','have':'has had having','do':'does did done doing','go':'goes went gone going','say':'says said saying',
 'make':'makes made making','take':'takes took taken taking','come':'comes came coming','see':'sees saw seen seeing','know':'knows knew known knowing',
 'get':'gets got gotten getting','give':'gives gave given giving','find':'finds found finding','think':'thinks thought thinking','tell':'tells told telling',
 'become':'becomes became becoming','leave':'leaves left leaving','feel':'feels felt feeling','put':'puts putting','bring':'brings brought bringing','begin':'begins began begun beginning',
 'keep':'keeps kept keeping','hold':'holds held holding','write':'writes wrote written writing','stand':'stands stood standing','hear':'hears heard hearing','let':'lets letting',
 'mean':'means meant meaning','set':'sets setting','meet':'meets met meeting','run':'runs ran running','pay':'pays paid paying','sit':'sits sat sitting','speak':'speaks spoke spoken speaking',
 'lie':'lies lay lain lying','lead':'leads led leading','read':'reads reading','grow':'grows grew grown growing','lose':'loses lost losing','fall':'falls fell fallen falling',
 'send':'sends sent sending','build':'builds built building','understand':'understands understood understanding','draw':'draws drew drawn drawing','break':'breaks broke broken breaking',
 'spend':'spends spent spending','cut':'cuts cutting','rise':'rises rose risen rising','drive':'drives drove driven driving','buy':'buys bought buying','wear':'wears wore worn wearing',
 'choose':'chooses chose chosen choosing','eat':'eats ate eaten eating','drink':'drinks drank drunk drinking','sing':'sings sang sung singing','swim':'swims swam swum swimming',
 'fly':'flies flew flown flying','throw':'throws threw thrown throwing','catch':'catches caught catching','teach':'teaches taught teaching','sell':'sells sold selling',
 'sleep':'sleeps slept sleeping','forget':'forgets forgot forgotten forgetting','win':'wins won winning','hit':'hits hitting','hide':'hides hid hidden hiding','bite':'bites bit bitten biting',
 'child':'children','man':'men','woman':'women','foot':'feet','tooth':'teeth','mouse':'mice','person':'people','good':'better best','bad':'worse worst','many':'more most','much':'more most',
 'little':'less least','far':'farther further farthest furthest','i':'me my mine myself','he':'him his himself','she':'her hers herself','we':'us our ours ourselves','they':'them their theirs themselves',
 'you':'your yours yourself yourselves','it':'its itself',
}
def forms(w):
    w = w.lower(); f = {w}
    if not re.fullmatch(r"[a-z]+", w): return f
    f |= set(IRREG.get(w, '').split())
    f |= {w+'s', w+'es', w+'ed', w+'d', w+'ing', w+'er', w+'est', w+'ly'}
    if w.endswith('e'): f |= {w[:-1]+'ing', w[:-1]+'ed'}
    if w.endswith('y') and len(w) > 2: f |= {w[:-1]+'ies', w[:-1]+'ied', w[:-1]+'ier', w[:-1]+'iest', w[:-1]+'ily'}
    if len(w) > 2 and w[-1] not in 'aeiouwxy' and w[-2] in 'aeiou' and w[-3] not in 'aeiou': f |= {w+w[-1]+'ing', w+w[-1]+'ed', w+w[-1]+'er'}
    return f
NAMES = set('tom mary john jack bill ken jane mike bob tony nancy betty lucy paul peter george henry susan kate anne emily jim joe sam ben tim ann mr mrs ms dr japan japanese english american america tokyo london england french france china chinese german germany paris europe asia canada australia kyoto osaka italy spain russia korea india africa january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday christmas'.split())
NAMES -= {'may','march','bill','jack','tom','mike','mary'}   # 普通の語としても使うものは、あとで文頭以外を調べて直す
NAMES |= {'tom','mary','jack','mike','bill'}                 # コーパスではほぼ人名
BLOCK = set('rape sex sexual murder kill killed suicide naked nude prostitute damn hell shit fuck bitch idiot stupid drunk cigarette gun bomb weapon drug drugs porn'.split())
def detok_en(toks):
    out = []
    for t in toks:
        if out and (t.startswith("'") or t in ("n't", "'s", "'m", "'re", "'ve", "'ll", "'d")) :
            out[-1] += t
        elif out and t in ('.', ',', '?', '!', ';', ':', '%'):
            out[-1] += t
        else:
            out.append(t)
    s = ' '.join(out)
    s = re.sub(r"\bi\b", "I", s)
    s = re.sub(r"\bi'(m|ll|ve|d)\b", lambda m: "I'" + m.group(1), s)
    words = s.split(' ')
    for i, w in enumerate(words):
        core = re.sub(r"[^a-z']", '', w.lower())
        if core in NAMES or core.rstrip("'s") in NAMES:
            words[i] = w[0].upper() + w[1:]
    s = ' '.join(words)
    s = s[0].upper() + s[1:] if s else s
    s = s.replace(' - ', ' – ')
    return s
def detok_ja(text):
    toks = text.split()
    out = ''
    for i, t in enumerate(toks):
        if out and re.match(r'[A-Za-z0-9]', t) and re.search(r'[A-Za-z0-9]$', out): out += ' '
        out += t
    out = re.sub(r'\.$', '。', out)
    out = out.replace(',', '、').replace('?', '？').replace('!', '！')
    return out
def open_text(path):
    if path.endswith('.bz2'): return bz2.open(path, 'rt', encoding='utf-8', errors='replace')
    if path.endswith('.gz'): return gzip.open(path, 'rt', encoding='utf-8', errors='replace')
    return open(path, encoding='utf-8', errors='replace')
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--en'); ap.add_argument('--ja'); ap.add_argument('--tsv', nargs='+'); ap.add_argument('--no-merge', action='store_true')
    ap.add_argument('--master', default=os.path.join(HERE, 'data', 'words_master.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'js', 'data', 'examples.js'))
    a = ap.parse_args()
    pairs = []
    if a.tsv:
        seen_en = set()
        for path in a.tsv:
            with open_text(path) as fh:
                for line in fh:
                    p = line.rstrip('\n').split('\t')
                    if len(p) >= 4 and p[0].isdigit() and p[2].isdigit(): en, ja = p[1], p[3]   # Tatoebaの形式：英語ID, 英語, 日本語ID, 日本語
                    elif len(p) >= 2: en, ja = p[0], p[1]
                    else: continue
                    key = en.strip().lower()
                    if not en.strip() or not ja.strip() or key in seen_en: continue
                    seen_en.add(key); pairs.append((en.split(), ja))
    elif a.en and a.ja:
        en = open(a.en, encoding='utf-8').read().splitlines(); ja = open(a.ja, encoding='utf-8').read().splitlines()
        for e, j in zip(en, ja):
            if e.strip() and j.strip(): pairs.append((e.split(), j))
    else:
        sys.exit('対訳ファイルを指定してください。例： python3 make_examples.py --tsv eng-jpn.tsv.bz2')
    print(f'対訳の文の数: {len(pairs)}')
    words = json.load(open(a.master, encoding='utf-8'))
    # 見出し語の活用形 → 見出し語
    idx = collections.defaultdict(list)
    single = [w for w in words if re.fullmatch(r"[A-Za-z]+", w['en'])]
    for w in single:
        for f in forms(w['en']): idx[f].append(w['id'])
    phr = [w for w in words if not re.fullmatch(r"[A-Za-z]+", w['en'])]
    # 文の候補
    cand = collections.defaultdict(list)   # id -> [(score, sentence index, surface)]
    sents = []
    for toks_raw, ja in pairs:
        toks = [t.lower() for t in toks_raw]
        alpha = [re.sub(r"[^a-z]", '', t) for t in toks]
        if not (4 <= len([t for t in alpha if t]) <= 14): continue
        if any(t in BLOCK for t in alpha): continue
        if not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', ja) or len(ja.replace(' ', '')) > 60: continue
        en = detok_en(toks_raw)
        if re.search(r" '|' ", en) or '"' in en: continue   # 引用符の位置が崩れた文は使わない
        if re.search(r"(^| )'|' |\"", en): continue   # 引用符が混ざった文は使わない
        si = len(sents); sents.append((en, detok_ja(ja)))
        zip_ = [ZIPF(t) for t in alpha if t]
        mean_z = sum(zip_) / max(1, len(zip_))
        seen = set()
        for i, t in enumerate(alpha):
            for wid in idx.get(t, ()):
                if wid in seen: continue
                seen.add(wid)
                cand[wid].append((si, i, t))
        sents[si] = (en, sents[si][1], mean_z, len(alpha))
    byid = {w['id']: w for w in words}
    chosen = {}; used = collections.Counter()
    # 難しい語（出現が少ない語）から先に選ぶ
    for wid in sorted(cand, key=lambda k: len(cand[k])):
        w = byid[wid]; best = None
        for si, i, t in cand[wid]:
            en, ja, mean_z, n = sents[si]
            exact = 1.0 if t == w['en'].lower() else 0.0
            score = -abs(n - 8) * 0.35 + mean_z * 0.6 + exact - used[si] * 1.5
            if best is None or score > best[0]: best = (score, si, t)
        si, t = best[1], best[2]
        used[si] += 1
        en, ja = sents[si][0], sents[si][1]
        m = re.search(r"\b" + re.escape(t) + r"\b", en, flags=re.I) or re.search(re.escape(t[:max(3, len(t) - 3)]) + r"\w*", en, flags=re.I)
        surf = m.group(0) if m else ''
        if surf: chosen[wid] = [en, ja, surf]
    # 熟語（複数語）は、そのままの形で含む文を探す
    for w in phr:
        key = re.sub(r"[^a-z' ]", '', re.sub(r"\s*\.\.\.\s*$", '', w['en']).lower()).strip()
        if len(key.split()) < 2: continue
        for en, ja, mz, n in [s for s in sents if len(s) == 4]:
            if re.search(r"\b" + re.escape(key) + r"\b", en.lower()):
                m = re.search(re.escape(key), en, flags=re.I); chosen[w['id']] = [en, ja, m.group(0)]; break
    kept = 0
    if not a.no_merge and os.path.exists(a.out):   # 新しい対訳に無い語は、今ある例文を残す
        for line in open(a.out, encoding='utf-8'):
            m = re.match(r'EXAMPLES\[(\d+)\]=(.*);\s*$', line)
            if m and int(m.group(1)) not in chosen:
                try: chosen[int(m.group(1))] = json.loads(m.group(2)); kept += 1
                except ValueError: pass
        if kept: print(f'今ある例文を引き継いだ語: {kept}')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write("// 単語ごとの例文（英語・日本語訳・強調する語）。出典：田中コーパス／Tatoebaプロジェクト（CC BY 2.0 FR）。 ※make_examples.py で自動生成\n")
        for wid in sorted(chosen):
            f.write(f"EXAMPLES[{wid}]={json.dumps(chosen[wid], ensure_ascii=False, separators=(',', ':'))};\n")
    by = collections.defaultdict(lambda: [0, 0])
    for w in words:
        by[w.get('lv', '?')][1] += 1
        if w['id'] in chosen: by[w.get('lv', '?')][0] += 1
    print(f"例文を付けた語: {len(chosen)} / {len(words)}（{len(chosen) * 100 // len(words)}%）")
    for lv in ['7', '6', '5', '4', '3', 'p2', '2', 'p1', '1']:
        n, t = by[lv]; print(f"  {lv:>2}: {n} / {t}（{n * 100 // max(1, t)}%）")
if __name__ == '__main__':
    main()
