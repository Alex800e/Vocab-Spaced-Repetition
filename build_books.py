#!/usr/bin/env python3
"""本（data/books/○○.json）から、Webページ用の js/data/book_○○.js を作るスクリプト
   python3 build_books.py で実行します。
   本のデータ(JSON)は、本文(lines)と、学習する単語・フレーズ(entries)でできています。
   entries の各項目：id, no(本の中の番号), en, ja, pos, kind(word か phrase), ctx(本文のどこに出てくるか), rb(ふりがな), kn(カタカナ)"""
import glob, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(f'{HERE}/js/data', exist_ok=True)
for p in sorted(glob.glob(f'{HERE}/data/books/*.json')):
    b = json.load(open(p, encoding='utf-8'))
    if 'entries' not in b: continue
    out = f"// 本：{b['title']}（学習する単語・フレーズ {len(b['entries'])}件） ※build_books.py で自動生成\nBOOKS_DATA.push(" + json.dumps(b, ensure_ascii=False, separators=(',', ':')) + ");\n"
    open(f"{HERE}/js/data/book_{b['id']}.js", 'w', encoding='utf-8').write(out)
    print(b['title'], len(b['entries']), '件 →', f"js/data/book_{b['id']}.js")
