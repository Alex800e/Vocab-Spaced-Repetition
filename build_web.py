#!/usr/bin/env python3
"""単語データの更新用スクリプト（python3 build_web.py で実行）

  data/words_master.json  … 単語データの元（ここを編集します）
  data/theme_overrides.tsv … テーマの手動修正（英語<TAB>テーマ記号 を1行ずつ。無くてもOK）
  ↓ 実行すると
  js/data/words_*.js      … Webページ用（級ごと）
  data/txt/○級英単語.txt  … 元のtxtと同じ形式（#, 英語, 日本語, 品詞）

単語を追加するには、words_master.json の末尾に
  {"id": 10396, "en": "example", "ja": "例，見本", "pos": "名詞", "lv": "3", "th": "mind"}
のように足します（id は今ある最大の番号+1。lv は 7,6,5,4,3,p2,2,p1,1。漢字のふりがなは "rb": "{例|れい}，{見本|みほん}" の形式）。
"""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
LV = [('7','7級'),('6','6級'),('5','5級'),('4','4級'),('3','3級'),('p2','準2級'),('2','2級'),('p1','準1級'),('1','1級')]
def key(en): return re.sub(r'[.?!]+$','',re.sub(r'\s+',' ',en.strip().replace('’',"'"))).lower()
m = json.load(open(f'{HERE}/data/words_master.json', encoding='utf-8'))
ov = {}
p = f'{HERE}/data/theme_overrides.tsv'
if os.path.exists(p):
    for line in open(p, encoding='utf-8'):
        if line.strip() and not line.startswith('#'):
            en, th = line.rstrip('\n').split('\t'); ov[key(en)] = th.strip()
for w in m:
    if key(w['en']) in ov: w['th'] = ov[key(w['en'])]
seen = {}
for w in m:
    k = key(w['en'])
    if k in seen: print('重複:', w['en'], seen[k], w['id'])
    seen[k] = w['id']
json.dump(m, open(f'{HERE}/data/words_master.json','w',encoding='utf-8'), ensure_ascii=False, indent=0)
os.makedirs(f'{HERE}/js/data', exist_ok=True); os.makedirs(f'{HERE}/data/txt', exist_ok=True)
for lv, name in LV:
    rows = sorted([w for w in m if w['lv'] == lv], key=lambda w: w['id'])
    lines = []
    for w in rows:
        o = {'id':w['id'],'en':w['en'],'ja':w['ja'],'pos':w.get('pos',''),'th':w.get('th','other')}
        if w.get('rb'): o['rb'] = w['rb']
        lines.append(' ' + json.dumps(o, ensure_ascii=False, separators=(',',':')) + ',')
    open(f'{HERE}/js/data/words_{lv}.js','w',encoding='utf-8').write(
        f'// {name}の英単語（{len(rows)}語） ※build_web.py で自動生成\nWORDS_LV[{json.dumps(lv)}]=[\n' + '\n'.join(lines) + '\n];\n')
    out = [{'#':i+1,'英語':w['en'],'日本語':w['ja'],'品詞':w.get('pos','')} for i,w in enumerate(rows)]
    open(f'{HERE}/data/txt/{name}英単語.txt','w',encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=2))
    print(name, len(rows), '語')
print('合計', len(m), '語')
