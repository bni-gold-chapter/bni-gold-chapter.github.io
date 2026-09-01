# -*- coding: utf-8 -*-
"""從 bio-template.pptx 產生「網頁版投影片」所需的兩樣東西：

1. slides/bg-N.png ── 純設計背景（把有填空的格子清空後渲染，線條/底色/LOGO 都在）
2. slides.json     ── 每個要填字的方框：位置、字級、對齊、段落內容（含 {{token}}）

網頁拿這兩樣就能排出跟原版 PPT 一樣的橫式版面，列印即為 PDF。

用法：python3 tools/build-slide-view.py bio-template.pptx slides/
需要 libreoffice + poppler-utils（pdftoppm）。
"""
import html, json, os, re, shutil, subprocess, sys, zipfile

EMU_W, EMU_H = 12192000, 6858000          # 13.333 x 7.5 吋

# 原版模板沒有圖片框，這裡指定兩個放圖位置（座標由模板量出）：
#  photo  ── SLOGAN 頁左側那塊灰色 panel，比例配合 3:4 裁切不變形
#  qrcode ── 綜合資訊頁「QRcode(官網或line)」那格，置中放在說明文字下方
IMG_SLOTS = [
    {'id': 'photo',  'slide': 6,  'x': 0,       'y': 837819,  'w': 3840480, 'h': 5120640},
    {'id': 'qrcode', 'slide': 11, 'x': 10136767, 'y': 2960000, 'w': 1400000, 'h': 1400000},
]
RE_TC = re.compile(r'<a:tc(?:\s[^>]*)?>.*?</a:tc>', re.S)
RE_TR = re.compile(r'<a:tr\s[^>]*>.*?</a:tr>', re.S)
RE_SP = re.compile(r'<p:sp>.*?</p:sp>', re.S)
RE_GF = re.compile(r'<p:graphicFrame>.*?</p:graphicFrame>', re.S)
RE_P = re.compile(r'<a:p>.*?</a:p>', re.S)
RE_TOKEN = re.compile(r'\{\{(\w+)\}\}')


def xfrm(xml):
    m = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/>\s*<a:ext cx="(\d+)" cy="(\d+)"', xml)
    return tuple(int(v) for v in m.groups()) if m else None


def para_info(p):
    """一個段落 → {a:對齊, ml:縮排, ind:首行, bu:項目符號, ls:行距%, runs:[…]}"""
    ppr = (re.search(r'<a:pPr[^>]*(?:/>|>)', p) or [''])[0]
    align = (re.search(r'algn="(\w+)"', ppr) or [None, 'l'])[1]
    marL = int((re.search(r'marL="(-?\d+)"', ppr) or [0, 0])[1])
    indent = int((re.search(r'indent="(-?\d+)"', ppr) or [0, 0])[1])
    # 項目符號：<a:buChar char="•"/>；<a:buNone/> 表示這段沒有符號
    bu = ''
    if '<a:buNone/>' not in p:
        m = re.search(r'<a:buChar[^>]*char="([^"]*)"', p)
        if m:
            bu = html.unescape(m.group(1))
    lnspc = re.search(r'<a:lnSpc><a:spcPct val="(\d+)"/></a:lnSpc>', p)
    ls = int(lnspc.group(1)) / 100000 if lnspc else 0
    bef = re.search(r'<a:spcBef><a:spcPts val="(\d+)"/></a:spcBef>', p)
    runs = []
    for r in re.findall(r'<a:r>.*?</a:r>', p, re.S):
        t = html.unescape(''.join(re.findall(r'<a:t>(.*?)</a:t>', r, re.S)))
        if t == '':
            continue
        rpr = (re.search(r'<a:rPr[\s\S]*?(?:/>|</a:rPr>)', r) or [''])[0]
        sz = int((re.search(r'sz="(\d+)"', rpr) or [0, 1400])[1]) if 'sz="' in rpr else 1400
        b = 'b="1"' in rpr
        col = (re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', rpr) or [None, None])[1]
        runs.append({'t': t, 'sz': sz, 'b': b, 'c': col})
    out = {'a': align, 'r': runs}
    if marL:   out['ml'] = marL
    if indent: out['ind'] = indent
    if bu:     out['bu'] = bu
    if ls:     out['ls'] = round(ls, 3)
    if bef:    out['sb'] = int(bef.group(1))
    return out


def body_paras(body):
    return [para_info(p) for p in RE_P.findall(body)]


def anchor_of(body):
    m = re.search(r'<a:bodyPr[^>]*anchor="(\w+)"', body)
    return m.group(1) if m else 't'


# OOXML 的預設內縮（文字框與表格儲存格都是這組數字）
DEF_INS = (91440, 45720, 91440, 45720)


def insets(tag, names=('lIns', 'tIns', 'rIns', 'bIns')):
    """從 <a:bodyPr> / <a:tcPr> 取上下左右內縮，沒寫的用預設值。"""
    return [int((re.search(n + r'="(-?\d+)"', tag) or [0, d])[1])
            for n, d in zip(names, DEF_INS)]


def collect(xml, sidx):
    """回傳這張投影片上所有「含 token 的方框」，以及要在背景中清空的區塊。"""
    boxes, blanks = [], []

    # ── 文字框 ──
    for sp in RE_SP.findall(xml):
        if not RE_TOKEN.search(sp):
            continue
        body = (re.search(r'<p:txBody>.*?</p:txBody>', sp, re.S) or [''])[0]
        pos = xfrm(sp)
        if not body or not pos:
            continue
        bpr = (re.search(r'<a:bodyPr[^>]*(?:/>|>)', body) or [''])[0]
        boxes.append({'slide': sidx, 'x': pos[0], 'y': pos[1], 'w': pos[2], 'h': pos[3],
                      'anchor': anchor_of(body), 'ins': insets(bpr), 'p': body_paras(body)})
        blanks.append(sp)

    # ── 表格 ──
    for gf in RE_GF.findall(xml):
        if not RE_TOKEN.search(gf):
            continue
        pos = xfrm(gf)
        tbl = re.search(r'<a:tbl>.*?</a:tbl>', gf, re.S)
        if not pos or not tbl:
            continue
        tbl = tbl.group(0)
        cols = [int(c) for c in re.findall(r'<a:gridCol w="(\d+)"', tbl)]
        rows = RE_TR.findall(tbl)
        heights = [int(re.search(r'<a:tr h="(\d+)"', r).group(1)) for r in rows]
        for ri, tr in enumerate(rows):
            for ci, tc in enumerate(RE_TC.findall(tr)):
                if not RE_TOKEN.search(tc):
                    continue
                body = (re.search(r'<a:txBody>.*?</a:txBody>', tc, re.S) or [''])[0]
                if not body:
                    continue
                gs = int((re.search(r'gridSpan="(\d+)"', tc) or [0, 1])[1]) if 'gridSpan=' in tc else 1
                rs = int((re.search(r'rowSpan="(\d+)"', tc) or [0, 1])[1]) if 'rowSpan=' in tc else 1
                x = pos[0] + sum(cols[:ci])
                y = pos[1] + sum(heights[:ri])
                w = sum(cols[ci:ci + gs])
                h = sum(heights[ri:ri + rs])
                # 表格的垂直對齊放在 <a:tcPr anchor="...">，不是 bodyPr
                tcpr = (re.search(r'<a:tcPr[^>]*(?:/>|>)', tc) or [''])[0]
                anc = (re.search(r'anchor="(\w+)"', tcpr) or [None, None])[1] or anchor_of(body)
                boxes.append({'slide': sidx, 'x': x, 'y': y, 'w': w, 'h': h, 'anchor': anc,
                              'ins': insets(tcpr, ('marL', 'marT', 'marR', 'marB')),
                              'p': body_paras(body)})
                blanks.append(tc)
    return boxes, blanks


def blank_out(xml, blanks):
    """把要用網頁排版的區塊，在背景用的 pptx 中清空文字。"""
    for chunk in blanks:
        cleaned = re.sub(r'<a:t>.*?</a:t>', '<a:t></a:t>', chunk, flags=re.S)
        xml = xml.replace(chunk, cleaned, 1)
    return xml


def main(tpl, outdir):
    os.makedirs(outdir, exist_ok=True)
    zin = zipfile.ZipFile(tpl)
    names = sorted([n for n in zin.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
                   key=lambda n: int(re.findall(r'\d+', n)[0]))
    all_boxes, cleaned = [], {}
    for n in names:
        sidx = int(re.findall(r'\d+', n)[0])
        xml = zin.read(n).decode('utf8')
        boxes, blanks = collect(xml, sidx)
        all_boxes += boxes
        cleaned[n] = blank_out(xml, blanks)

    # 產生「只有設計、沒有填寫內容」的 pptx，用來渲染背景
    bgpptx = os.path.join(outdir, '_bg.pptx')
    zout = zipfile.ZipFile(bgpptx, 'w', zipfile.ZIP_DEFLATED)
    for it in zin.infolist():
        zout.writestr(it, cleaned[it.filename].encode('utf8')
                      if it.filename in cleaned else zin.read(it.filename))
    zout.close()

    # pptx → pdf → png
    prof = 'file:///tmp/_lo_slideview'
    subprocess.run(['soffice', '--headless', f'-env:UserInstallation={prof}',
                    '--convert-to', 'pdf', bgpptx, '--outdir', outdir],
                   check=True, capture_output=True, timeout=600)
    pdf = os.path.join(outdir, '_bg.pdf')
    subprocess.run(['pdftoppm', '-png', '-r', '110', pdf, os.path.join(outdir, 'bg')],
                   check=True, capture_output=True, timeout=600)
    os.remove(bgpptx)
    os.remove(pdf)

    # 統一檔名為 bg-1.png…（pdftoppm 會補零）
    for f in sorted(os.listdir(outdir)):
        m = re.match(r'bg-0*(\d+)\.png$', f)
        if m and f != f'bg-{int(m.group(1))}.png':
            os.rename(os.path.join(outdir, f), os.path.join(outdir, f'bg-{int(m.group(1))}.png'))

    data = {'w': EMU_W, 'h': EMU_H, 'slides': len(names),
            'boxes': all_boxes, 'imgs': IMG_SLOTS}
    with open(os.path.join(outdir, 'slides.json'), 'w', encoding='utf8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))

    pngs = len([f for f in os.listdir(outdir) if f.endswith('.png')])
    size = sum(os.path.getsize(os.path.join(outdir, f)) for f in os.listdir(outdir))
    print(f'投影片 {len(names)} 張　背景圖 {pngs} 張　填寫方框 {len(all_boxes)} 個　'
          f'合計 {size/1048576:.1f} MB')
    return 0 if pngs == len(names) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
