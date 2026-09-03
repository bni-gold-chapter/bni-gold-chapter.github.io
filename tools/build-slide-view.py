# -*- coding: utf-8 -*-
"""從 bio-template.pptx 產生「網頁版投影片」所需的兩樣東西：

1. slides/bg-N.png ── 純設計背景（把有填空的格子清空後渲染，線條/底色/LOGO 都在）
2. slides.json     ── 每個要填字的方框：位置、字級、對齊、段落內容（含 {{token}}）

網頁拿這兩樣就能排出跟原版 PPT 一樣的橫式版面，列印即為 PDF。

用法：python3 tools/build-slide-view.py bio-template.pptx slides/
方框位置**不能只靠 <a:tr h> 算**：那是「最小列高」，實際渲染時 LibreOffice /
PowerPoint 會為了塞下內容把列撐高（GAINS 左欄那種長說明文字就會撐高），算出來
的座標會跟背景圖的框線對不起來，越後面的列差越多。所以這裡多渲染一張「探測
圖」：把每個要填字的儲存格塗成一個獨一無二的顏色，再從圖上把那塊顏色的實際
位置量回來。

需要 libreoffice + poppler-utils（pdftoppm）與 Pillow。
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


def collect(xml, sidx, probe_from=0):
    """回傳這張投影片上所有「含 token 的方框」，以及要在背景中清空的區塊。"""
    boxes, blanks, cells = [], [], []

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
                              'p': body_paras(body),
                              '_probe': probe_color(probe_from + len(cells))})
                blanks.append(tc)
                cells.append(tc)
    return boxes, blanks, cells


def probe_color(i):
    """給每個要填字的儲存格一個獨一無二的顏色。用偏藍的色系，
    才不會跟版面本來就有的黑／白／灰／BNI 紅搞混。"""
    return '%02X%02XFE' % (8 + (i % 30) * 8, 8 + ((i // 30) % 30) * 8)


def paint(chunk, color):
    """把儲存格塗成指定顏色（<a:tcPr> 的填色要放在框線之後）。"""
    fill = f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
    m = re.search(r'<a:tcPr(\s[^>]*)?/>', chunk)
    if m:
        return chunk.replace(m.group(0), f'<a:tcPr{m.group(1) or ""}>{fill}</a:tcPr>', 1)
    m = re.search(r'<a:tcPr(?:\s[^>]*)?>.*?</a:tcPr>', chunk, re.S)
    if m:
        return chunk.replace(m.group(0), m.group(0).replace('</a:tcPr>', fill + '</a:tcPr>'), 1)
    return chunk.replace('</a:tc>', f'<a:tcPr>{fill}</a:tcPr></a:tc>', 1)


def blank_out(xml, blanks):
    """把要用網頁排版的區塊，在背景用的 pptx 中清空文字。"""
    for chunk in blanks:
        cleaned = re.sub(r'<a:t>.*?</a:t>', '<a:t></a:t>', chunk, flags=re.S)
        xml = xml.replace(chunk, cleaned, 1)
    return xml


def render(pptx, outdir, prefix, dpi, profile):
    """pptx → pdf → png，回傳依頁碼排好的檔名清單。"""
    subprocess.run(['soffice', '--headless', f'-env:UserInstallation=file://{profile}',
                    '--convert-to', 'pdf', pptx, '--outdir', outdir],
                   check=True, capture_output=True, timeout=900)
    pdf = os.path.splitext(pptx)[0] + '.pdf'
    subprocess.run(['pdftoppm', '-png', '-r', str(dpi), pdf, os.path.join(outdir, prefix)],
                   check=True, capture_output=True, timeout=900)
    os.remove(pdf)
    out = {}
    for f in os.listdir(outdir):
        m = re.match(re.escape(prefix) + r'-0*(\d+)\.png$', f)
        if m:
            out[int(m.group(1))] = os.path.join(outdir, f)
    return out


def measure(pngs, boxes):
    """從探測圖量出每個儲存格實際的位置，換算回 EMU 覆蓋原本用列高算的座標。"""
    from PIL import Image
    want = {}
    for b in boxes:
        if b.get('_probe'):
            want.setdefault(b['slide'], {})[b['_probe']] = b
    fixed = 0
    for sidx, by_color in want.items():
        if sidx not in pngs:
            continue
        im = Image.open(pngs[sidx]).convert('RGB')
        W, H = im.size
        px = im.load()
        found = {}
        for y in range(H):
            for x in range(W):
                r, g, bl = px[x, y]
                if abs(bl - 0xFE) > 2:
                    continue
                key = '%02X%02XFE' % (r, g)
                if key not in by_color:
                    continue
                cur = found.get(key)
                found[key] = (x, y, x, y) if not cur else \
                    (min(cur[0], x), min(cur[1], y), max(cur[2], x), max(cur[3], y))
        for key, (x0, y0, x1, y1) in found.items():
            b = by_color[key]
            b['x'] = round(x0 / W * EMU_W)
            b['y'] = round(y0 / H * EMU_H)
            b['w'] = round((x1 - x0 + 1) / W * EMU_W)
            b['h'] = round((y1 - y0 + 1) / H * EMU_H)
            fixed += 1
    for b in boxes:
        b.pop('_probe', None)
    return fixed


def main(tpl, outdir):
    os.makedirs(outdir, exist_ok=True)
    zin = zipfile.ZipFile(tpl)
    names = sorted([n for n in zin.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
                   key=lambda n: int(re.findall(r'\d+', n)[0]))
    all_boxes, cleaned, probed = [], {}, {}
    for n in names:
        sidx = int(re.findall(r'\d+', n)[0])
        xml = zin.read(n).decode('utf8')
        boxes, blanks, cells = collect(xml, sidx)
        all_boxes += boxes
        clean = blank_out(xml, blanks)
        cleaned[n] = clean
        # 探測用：內容跟背景圖完全一樣（一樣清空文字），只是把儲存格塗上顏色，
        # 這樣兩張圖的排版才會一致，量到的位置才對得上背景。
        pr = clean
        colors = [b['_probe'] for b in boxes if b.get('_probe')]
        for tc, color in zip(cells, colors):
            blank_tc = re.sub(r'<a:t>.*?</a:t>', '<a:t></a:t>', tc, flags=re.S)
            if blank_tc in pr:
                pr = pr.replace(blank_tc, paint(blank_tc, color), 1)
        probed[n] = pr

    # 先把整包讀成記憶體快照：writestr() 會改寫傳進去的 ZipInfo，
    # 直接沿用 zin.infolist() 寫第二個檔時，來源的偏移量就被弄壞了。
    snapshot = [(it.filename, it.date_time, zin.read(it.filename)) for it in zin.infolist()]

    def build(src_map, path):
        z = zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED)
        for name, when, raw in snapshot:
            z.writestr(zipfile.ZipInfo(name, when),
                       src_map[name].encode('utf8') if name in src_map else raw,
                       zipfile.ZIP_DEFLATED)
        z.close()

    probe_pptx = os.path.join(outdir, '_probe.pptx')
    build(probed, probe_pptx)
    probe_pngs = render(probe_pptx, outdir, '_probe', 110, '/tmp/_lo_probe')
    fixed = measure(probe_pngs, all_boxes)
    os.remove(probe_pptx)
    for f in probe_pngs.values():
        os.remove(f)

    bg_pptx = os.path.join(outdir, '_bg.pptx')
    build(cleaned, bg_pptx)
    bg_pngs = render(bg_pptx, outdir, 'bg', 110, '/tmp/_lo_slideview')
    os.remove(bg_pptx)
    for i, f in bg_pngs.items():                 # 統一檔名為 bg-1.png…
        want = os.path.join(outdir, f'bg-{i}.png')
        if f != want:
            os.rename(f, want)

    data = {'w': EMU_W, 'h': EMU_H, 'slides': len(names),
            'boxes': all_boxes, 'imgs': IMG_SLOTS}
    with open(os.path.join(outdir, 'slides.json'), 'w', encoding='utf8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))

    pngs = len([f for f in os.listdir(outdir) if f.endswith('.png')])
    size = sum(os.path.getsize(os.path.join(outdir, f)) for f in os.listdir(outdir))
    print(f'投影片 {len(names)} 張　背景圖 {pngs} 張　填寫方框 {len(all_boxes)} 個　'
          f'（其中 {fixed} 個由實際渲染量到位置）　合計 {size / 1048576:.1f} MB')
    return 0 if pngs == len(names) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
