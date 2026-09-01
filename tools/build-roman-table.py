# -*- coding: utf-8 -*-
"""產生 bio.html 裡的 PY_GROUPS 全字對照表（中文姓名 → 護照拼音）。

台灣護照用的是威妥瑪拼音，這裡把漢語拼音依規則轉過去，涵蓋 CJK 基本區
（U+4E00–U+9FFF）全部有讀音的漢字。個別字若要改（破音字、姓氏特殊讀音、慣用寫法），不要改這支程式，
直接寫進 bio.html 的 SURNAME_TXT / PINYIN_TXT —— 那兩張表會覆蓋本表。

用法：pip install pypinyin && python3 tools/build-roman-table.py
輸出貼進 bio.html 的 const PY_GROUPS = `…`
"""
import re, sys
from collections import defaultdict
from pypinyin import pinyin, Style

# 聲母：送氣符號在護照上不寫，所以 b/p 都是 P、d/t 都是 T、g/k 都是 K…
INITIALS = [('zh', 'ch'), ('ch', 'ch'), ('sh', 'sh'), ('b', 'p'), ('p', 'p'),
            ('d', 't'), ('t', 't'), ('g', 'k'), ('k', 'k'), ('z', 'ts'), ('c', 'ts'),
            ('j', 'ch'), ('q', 'ch'), ('x', 'hs'), ('r', 'j'), ('f', 'f'), ('h', 'h'),
            ('l', 'l'), ('m', 'm'), ('n', 'n'), ('s', 's'), ('w', 'w'), ('y', 'y')]

# 不規則的整音節
WHOLE = {
    'zi': 'tzu', 'ci': 'tzu', 'si': 'ssu', 'zhi': 'chih', 'chi': 'chih',
    'shi': 'shih', 'ri': 'jih', 'yi': 'yi', 'ya': 'ya', 'ye': 'yeh', 'yao': 'yao',
    'you': 'yu', 'yan': 'yen', 'yin': 'yin', 'yang': 'yang', 'ying': 'ying',
    'yong': 'yung', 'yu': 'yu', 'yue': 'yueh', 'yuan': 'yuan', 'yun': 'yun',
    'wu': 'wu', 'wa': 'wa', 'wo': 'wo', 'wai': 'wai', 'wei': 'wei', 'wan': 'wan',
    'wen': 'wen', 'wang': 'wang', 'weng': 'weng', 'er': 'erh', 'e': 'o', 'o': 'o',
    'a': 'a', 'ai': 'ai', 'ao': 'ao', 'ou': 'ou', 'an': 'an', 'ang': 'ang',
    'en': 'en', 'eng': 'eng', 'ei': 'ei',
}


def wade_giles(py):
    py = py.strip().lower()
    if py in WHOLE:
        return WHOLE[py].upper()
    ini = wg = ''
    fin = py
    for a, b in INITIALS:
        if py.startswith(a):
            ini, wg, fin = a, b, py[len(a):]
            break
    if not ini:
        return py.upper()
    f = fin.replace('ü', 'v')
    if ini in ('j', 'q', 'x', 'y'):              # ju/qu/xu 的 u 其實是 ü
        f = re.sub(r'^u', 'v', f)
    for a, b in [('iong', 'iung'), ('ong', 'ung'), ('ian', 'ien'), ('ie', 'ieh'),
                 ('ve', 'veh')]:
        if f == a:
            f = b
            break
    if f == 'e' and ini in ('g', 'k', 'h'):      # ke→ko, he→ho
        f = 'o'
    if f == 'uo':                                # kuo/huo/shuo 留 u；duo→to, luo→lo
        f = 'uo' if ini in ('g', 'k', 'h', 'sh') else 'o'
    if f == 'ui' and ini in ('g', 'k'):          # gui→kuei
        f = 'uei'
    return (wg + f.replace('v', 'u')).upper()    # 護照不寫 ü


def main():
    groups = defaultdict(list)
    for cp in range(0x4E00, 0xA000):
        ch = chr(cp)
        py = pinyin(ch, style=Style.NORMAL, errors=lambda x: None)
        if not py or not py[0] or not py[0][0]:
            continue
        w = wade_giles(py[0][0])
        if re.fullmatch(r'[A-Z]+', w):
            groups[w].append(ch)

    items = [k + ':' + ''.join(v) for k, v in sorted(groups.items())]
    lines, cur = [], ''
    for t in items:
        if len(cur) + len(t) + 1 > 110:
            lines.append(cur)
            cur = t
        else:
            cur = (cur + ' ' + t) if cur else t
    if cur:
        lines.append(cur)
    sys.stdout.write('\n'.join(lines) + '\n')
    n = sum(len(v) for v in groups.values())
    print(f'\n音節 {len(groups)} 個、字 {n} 個', file=sys.stderr)


if __name__ == '__main__':
    main()
