#!/usr/bin/env python3
"""英単語のカタカナ表記（発音の見当をつける補助）を作るスクリプト
   python3 make_kana.py   … data/words_master.json の各単語に "kn" を書き込みます（要: pip install cmudict）
   カタカナの [ ] で囲んだ部分が、強く読む場所（アクセント）です。"""
import json, os, re, sys
import cmudict
CMU = cmudict.dict()
HERE = os.path.dirname(os.path.abspath(__file__))

ROW = {  # 子音ごとの ア・イ・ウ・エ・オ の段
 '':  'アイウエオ', 'K': 'カキクケコ', 'G': 'ガギグゲゴ', 'S': 'サシスセソ', 'Z': 'ザジズゼゾ', 'T': 'タティトゥテト', 'D': 'ダディドゥデド',
 'N': 'ナニヌネノ', 'HH': 'ハヒフヘホ', 'B': 'バビブベボ', 'P': 'パピプペポ', 'M': 'マミムメモ', 'R': 'ラリルレロ', 'L': 'ラリルレロ',
 'W': 'ワウィウウェウォ', 'Y': 'ヤイユイェヨ', 'F': 'ファフィフフェフォ', 'V': 'バビブベボ', 'SH': 'シャシシュシェショ', 'CH': 'チャチチュチェチョ',
 'JH': 'ジャジジュジェジョ', 'ZH': 'ジャジジュジェジョ', 'TH': 'サシスセソ', 'DH': 'ザジズゼゾ', 'NG': 'ンガンギングンゲンゴ',
}
def split_row(s):   # 'ティ' のような2文字を含む段を5つに分ける
    out, i = [], 0
    while len(out) < 5 and i < len(s):
        if i + 1 < len(s) and s[i + 1] in 'ィゥェォャュョ': out.append(s[i:i + 2]); i += 2
        else: out.append(s[i]); i += 1
    return out
ROWS = {k: split_row(v) for k, v in ROW.items()}
ROWS['T'] = ['タ', 'ティ', 'トゥ', 'テ', 'ト']; ROWS['D'] = ['ダ', 'ディ', 'ドゥ', 'デ', 'ド']
ROWS['W'] = ['ワ', 'ウィ', 'ウ', 'ウェ', 'ウォ']; ROWS['Y'] = ['ヤ', 'イ', 'ユ', 'イェ', 'ヨ']
ROWS['F'] = ['ファ', 'フィ', 'フ', 'フェ', 'フォ']; ROWS['NG'] = ['ンガ', 'ンギ', 'ング', 'ンゲ', 'ンゴ']
VI = {'a': 0, 'i': 1, 'u': 2, 'e': 3, 'o': 4}
# 母音 → (段, 長音・二重母音の続き)
VOW = {'AA': ('a', 'ー'), 'AE': ('a', ''), 'AH': ('a', ''), 'AO': ('o', 'ー'), 'AW': ('a', 'ウ'), 'AY': ('a', 'イ'), 'EH': ('e', ''),
       'ER': ('a', 'ー'), 'EY': ('e', 'イ'), 'IH': ('i', ''), 'IY': ('i', 'ー'), 'OW': ('o', 'ー'), 'OY': ('o', 'イ'), 'UH': ('u', ''), 'UW': ('u', 'ー')}
SHORT = {'AE', 'AH', 'EH', 'IH', 'UH', 'AA'}
STOP = {'P', 'T', 'K', 'B', 'D', 'G', 'CH', 'JH'}
CODA = {'N': 'ン', 'M': 'ム', 'NG': 'ング', 'L': 'ル', 'S': 'ス', 'Z': 'ズ', 'T': 'ト', 'D': 'ド', 'K': 'ク', 'G': 'グ', 'P': 'プ', 'B': 'ブ',
        'F': 'フ', 'V': 'ブ', 'TH': 'ス', 'DH': 'ズ', 'SH': 'シュ', 'CH': 'チ', 'JH': 'ジ', 'ZH': 'ジュ', 'HH': 'ハ', 'R': 'ル', 'W': 'ウ', 'Y': 'イ'}
ONSET_OK = {('P','L'),('B','L'),('K','L'),('G','L'),('F','L'),('P','R'),('B','R'),('T','R'),('D','R'),('K','R'),('G','R'),('F','R'),('TH','R'),('SH','R'),
            ('S','P'),('S','T'),('S','K'),('S','M'),('S','N'),('S','L'),('S','W'),('K','W'),('G','W'),('T','W'),('D','W'),('S','F'),('HH','Y'),
            ('P','Y'),('B','Y'),('T','Y'),('D','Y'),('K','Y'),('M','Y'),('N','Y'),('F','Y'),('V','Y'),('L','Y'),('S','Y'),('Z','Y'),('TH','W')}
VOWELS = set(VOW)
def is_v(p): return re.sub(r'\d', '', p) in VOWELS
def split_onset(cons):
    """母音と母音の間の子音を、前の音節の末尾と次の音節の頭に分ける"""
    n = len(cons)
    if n <= 1: return [], cons
    k = n - 1
    while k > 0:   # できるだけ長く次の音節の頭に付ける
        cand = cons[k - 1:]
        if len(cand) >= 2 and (cand[0], cand[1]) in ONSET_OK: k -= 1
        else: break
    return cons[:k], cons[k:]
def mora(c, v):   # 子音 c + 母音(段 v)
    row = ROWS.get(c)
    return row[VI[v]] if row else ''
def onset_kana(cons, v):
    out = ''
    cons = list(cons)
    # 子音+Y（ミュ・ビュ など）
    if len(cons) >= 2 and cons[-1] == 'Y' and cons[-2] not in ('HH',):
        c = cons[-2]
        base = {'T': 'チ', 'D': 'ジ', 'S': 'シ', 'Z': 'ジ', 'TH': 'シ', 'F': 'フ', 'V': 'ヴ'}.get(c) or ROWS[c][1]
        small = {'a': 'ャ', 'u': 'ュ', 'o': 'ョ', 'e': 'ェ', 'i': ''}[v]
        for x in cons[:-2]: out += mora(x, 'o' if x in ('T', 'D') else 'u')
        return out + base + small
    for x in cons[:-1]: out += mora(x, 'o' if x in ('T', 'D') else 'u')
    if cons: out += mora(cons[-1], v)
    else: out += ROWS[''][VI[v]]
    return out
def letter_groups(sp):
    return re.findall(r'[aeiouy]+', sp.lower())
def word_kana(phones, spelling=''):
    ph = [(re.sub(r'\d', '', p), (re.search(r'\d', p) or [''])[0] if re.search(r'\d', p) else '') for p in phones]
    # 音節に分ける
    syl, i, n = [], 0, len(ph)
    nuc = [k for k, (p, s) in enumerate(ph) if p in VOWELS]
    if not nuc: return None
    cur = {'on': ph[:nuc[0]], 'v': ph[nuc[0]], 'co': []}
    syls = [cur]
    for a, b in zip(nuc, nuc[1:] + [n]):
        cons = [p for p, _ in ph[a + 1:b]]
        if b == n: syls[-1]['co'] = cons; break
        co, on = split_onset(cons)
        syls[-1]['co'] = co
        syls.append({'on': [(p, '') for p in on], 'v': ph[b], 'co': []})
    syls[0]['on'] = [p for p, _ in syls[0]['on']] if syls[0]['on'] and isinstance(syls[0]['on'][0], tuple) else syls[0]['on']
    for s_ in syls[1:]: s_['on'] = [p if isinstance(p, str) else p[0] for p in s_['on']]
    out = []
    groups = letter_groups(spelling)
    use_hint = len(groups) == len(syls)
    for si, s_ in enumerate(syls):
        vp, vs = s_['v']
        row, ext = VOW[vp]
        hint = ''
        if use_hint:
            g = groups[si]; hint = g[-1] if g[-1] != 'y' else 'i'
        if vp == 'AH' and vs == '0' and hint:
            row = {'a': 'a', 'e': 'e', 'i': 'i', 'o': 'o', 'u': 'a'}[hint]
        on, co = list(s_['on']), list(s_['co'])
        last_syl = si == len(syls) - 1
        # AA は、つづりで o が a より先にあれば「オ」（hot, hospital）
        sl = spelling.lower()
        if vp == 'AA' and 'o' in sl and ('a' not in sl or sl.index('o') < sl.index('a')): row, ext = 'o', ''
        if vp == 'AA' and on and on[-1] == 'W': row, ext = 'o', ''   # want, watch → ウォ
        # 語末の AH0 + L/N/M は母音を消す（apple → プル）
        if vp == 'AH' and vs == '0' and last_syl and co and co[0] in ('L', 'N', 'M') and len(co) == 1 and on and hint in ('', 'e'):
            kana = (onset_kana(on[:-1], 'u') if len(on) > 1 else '') + mora(on[-1], 'o' if on[-1] in ('T', 'D') else 'u') + CODA[co[0]]
            out.append((kana, False)); continue
        # AE + K/G → キャ・ギャ
        kana = onset_kana(on, row)
        if vp == 'AE' and on and on[-1] in ('K', 'G') and len(on) == 1: kana = ROWS[on[-1]][1] + 'ャ'
        if on and on[-1] == 'HH' and vp == 'ER': kana = 'ハ'
        has_r = bool(co and co[0] == 'R' and vp != 'ER')
        if has_r and vp in ('AA', 'AO', 'IY', 'UW', 'OW'): ext = ''
        kana += ext
        # 強く読む、語頭以外の開音節 AE（banana → ナー）
        if vp == 'AE' and vs == '1' and not co and si > 0 and not (si + 1 < len(syls) and syls[si + 1]['on'] == []): kana += 'ー'
        # 母音 + R
        if co and co[0] == 'R' and vp != 'ER':
            add = {'AA': 'ー', 'AO': 'ー', 'EH': 'ア', 'IH': 'ア', 'IY': 'ア', 'UH': 'ア', 'UW': 'ア', 'AH': 'ー', 'AY': 'ア', 'AW': 'ア', 'EY': 'ア', 'OW': 'ー', 'OY': 'ア'}.get(vp, 'ー')
            if kana.endswith('ー') and add == 'ー': add = ''
            kana += add; co = co[1:]
        elif co and co[0] == 'R' and vp == 'ER': co = co[1:]
        # 末尾の子音
        gem = False
        for ci, c in enumerate(co):
            nxt = co[ci + 1] if ci + 1 < len(co) else None
            if c == 'M' and nxt in ('P', 'B'): kana += 'ン'; continue
            if c in STOP and vp in SHORT and ci == 0 and (last_syl or nxt is not None) and not gem:
                if last_syl or c in ('K', 'P', 'T', 'G', 'B', 'D') and nxt is None: kana += 'ッ'; gem = True
            if c == 'N' and nxt is None: kana += 'ン'; continue
            if c == 'NG' and (nxt in ('K', 'G') or (si + 1 < len(syls) and syls[si + 1]['on'] and syls[si + 1]['on'][0] in ('G', 'K'))): kana += 'ン'; continue
            kana += CODA.get(c, '')
        # 次の音節が弱い母音で、AE/AH の後ろに P/K が来る（apple → アップル）
        if not last_syl and vp in ('AE', 'AH') and not co:
            nx = syls[si + 1]
            if len(nx['on']) == 1 and nx['on'][0] in ('P', 'K') and nx['v'][1] in ('0',) and vs == '1': kana += 'ッ'
        out.append((kana, vs == '1'))
    if not any(st for _, st in out):
        # 強勢1が無い（弱形など）→ 最初の強勢2、無ければ最初の音節
        k = next((i for i, s_ in enumerate(syls) if s_['v'][1] == '2'), 0)
        out[k] = (out[k][0], True)
    return out
STOPWORDS = set('a an the of to in on at it is are am was were be i you he she we they my your his her its our their me him us them and or but so if as for with from by that this these those do does did not no can will would'.split())
def to_kana(en):
    text = re.sub(r"\s*\.\.\.\s*$", '', en).replace('’', "'")
    words = re.findall(r"[A-Za-z][A-Za-z']*", text)
    if not words or len(words) > 8: return None
    parts = []
    for w in words:
        key = w.lower()
        pr = CMU.get(key) or CMU.get(key.rstrip("'s")) if key not in CMU else CMU[key]
        if not pr: return None
        syl = word_kana(min(pr, key=lambda p: (len(p), sum('ER' in x for x in p))), key)
        if not syl: return None
        if len(words) > 1 and key in STOPWORDS: parts.append(''.join(k for k, _ in syl))
        else: parts.append(''.join(f'[{k}]' if st else k for k, st in syl))
    return ' '.join(parts)
def load_overrides():
    ov = {}
    p = f'{HERE}/data/kana_overrides.tsv'
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if line.strip() and not line.startswith('#'):
                en, kn = line.rstrip('\n').split('\t'); ov[en.strip().lower()] = kn.strip()
    return ov
if __name__ == '__main__':
    p = f'{HERE}/data/words_master.json'
    m = json.load(open(p, encoding='utf-8'))
    ov = load_overrides()
    n = 0
    for w in m:
        k = ov.get(w['en'].lower()) or to_kana(w['en'])
        if k: w['kn'] = k; n += 1
        else: w.pop('kn', None)
    json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(f'カタカナを付けた語: {n} / {len(m)}')
