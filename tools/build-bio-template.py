# -*- coding: utf-8 -*-
"""把 BNI 四加一原始 PPT 轉成「帶 {{token}} 的模板」。
網頁匯出時只要把 token 換成使用者填的字，就能得到與原版一模一樣的 PPT。

用法：python3 tools/build-bio-template.py <原始.pptx> <輸出.pptx>
"""
import re, sys, zipfile, shutil

# ── 每個欄位：(投影片, 種類, 定位, token) ───────────────────────────────
# cell(列, 格)：格的索引含被合併的佔位格，與 PowerPoint 的欄位置一致
# para 指定段落時＝在該段落後面接上 token（保留原本的提示字，如「短期目標：」）
CELL, SHAPE, RUN, RUNS, ADD = 'cell', 'shape', 'run', 'runs', 'add'

# 版面（slideLayout）頁尾的分會名是原廠佔位字，母片層不會被 token 取代，
# 直接在這裡換成本分會名稱。
CHAPTER = [('XX', '全鑫白金'), ('XXXX CHAPTER', 'GOLD CHAPTER')]
# 「全鑫白金分會」比原本的「XX 分會」長，頁尾那個小框要放寬，不然會折行掉出版面
CHAPTER_BOX = 2100000

# slide7（30 秒自我介紹第二頁）原檔整頁空白，補一個可填字的文字框
S7_BODY = dict(x=766765, y=800100, w=10658470, h=5200000, sz=2000)
EDITS = [
    # ── slide1 封面 ──（分會名是混合字體，只換單一 run 保留樣式）
    (1, RUN, (0, 0), 'ch_zh'), (1, RUN, (0, 2), 'ch_en'),
    (1, SHAPE, 1, 'cover_name'), (1, SHAPE, 2, 'cover_ind'),
    (1, SHAPE, 3, 'cover_name_en'), (1, SHAPE, 4, 'cover_ind_en'),
    # ── slide6 SLOGAN 1 ──
    (6, SHAPE, 0, 's6_rep'), (6, SHAPE, 1, 's6_company'),
    # 姓名與英文名在原版是「同一行、兩種字體」，各換一個 run 才不會擠掉版面
    (6, RUN, (2, 0), 's6_name'), (6, RUNS, (2, 1), 's6_nameEn'),
    (6, SHAPE, 3, 's6_slogan'), (6, SHAPE, 4, 's6_next'),
    (6, RUN, (5, 0), 's6_need'),                                    # 需求引薦
    *[(6, RUN, (6, i), f's6_serv{i+1}') for i in range(3)],         # 服務項目三點
    # ── slide7 SLOGAN 2（原檔空白頁，加一個自我介紹內容框）──
    (7, SHAPE, 0, 's7_slogan'), (7, SHAPE, 1, 's7_next'),
    (7, ADD, S7_BODY, 's7_body'),
    # ── slide9 會員資料表1 商業資訊 ──
    (9, CELL, (0, 2), 'b_nameline'), (9, CELL, (0, 4), 'b_birth'),
    (9, CELL, (0, 7), 'b_zodiac'), (9, CELL, (0, 10), 'b_editdate'),
    (9, CELL, (1, 2), 'b_company'), (9, CELL, (1, 8), 'b_edu'),
    (9, CELL, (2, 2), 'b_job'), (9, CELL, (3, 2), 'b_pro'), (9, CELL, (4, 2), 'b_addr'),
    (9, CELL, (5, 2), 'b_prev1'), (9, CELL, (5, 7), 'b_prev1y'), (9, CELL, (5, 11), 'b_cury'),
    (9, CELL, (6, 2), 'b_prev2'), (9, CELL, (6, 7), 'b_prev2y'),
    # ── slide10 會員資料表2 個人資訊 ──
    (10, CELL, (0, 2), 'p_spouse'), (10, CELL, (1, 2), 'p_kids'), (10, CELL, (2, 2), 'p_pets'),
    (10, CELL, (3, 2), 'p_hobby'), (10, CELL, (4, 2), 'p_activity'),
    (10, CELL, (5, 2), 'p_city'), (10, CELL, (5, 4), 'p_years'),
    # ── slide11 會員資料表3 綜合資訊 ──
    (11, CELL, (0, 2), 'g_wish'), (11, CELL, (1, 2), 'g_secret'), (11, CELL, (2, 2), 'g_key'),
    # ── slide13 GAINS（第 0 列右格已有「短期/中期/長期目標：」三段，接在後面）──
    (13, CELL, (0, 1, 0), 'ga_short'), (13, CELL, (0, 1, 1), 'ga_mid'), (13, CELL, (0, 1, 2), 'ga_long'),
    (13, CELL, (1, 1), 'ga_accomplish'), (13, CELL, (2, 1), 'ga_interest'),
    (13, CELL, (3, 1), 'ga_network'), (13, CELL, (4, 1), 'ga_skill'),
    # ── slide15 業務人脈圈：10 列職業 + 前三名 ──
    *[(15, CELL, (i, 1), f'cs_{i}') for i in range(1, 11)],
    (15, CELL, (3, 3), 'cs_top3'),
    # ── slide17 最近十位客戶：10 列 + 引薦定義 ──
    *[(17, CELL, (i, 1), f'cu_{i}') for i in range(1, 11)],
    (17, CELL, (3, 4), 'cu_note'),
    (17, CELL, (9, 4, 4), 'cu_general'), (17, CELL, (9, 4, 5), 'cu_ideal'),
    (17, CELL, (9, 4, 6), 'cu_dream'), (17, CELL, (9, 4, 7), 'cu_bad'),
    # ── slide19 一對一追蹤表1（題目在格內，答案接在題目後）──
    (19, CELL, (0, 1, -1), 'd_q1'), (19, CELL, (1, 1, -1), 'd_q2'),
    (19, CELL, (2, 1, -1), 'd_q3'), (19, CELL, (3, 1, -1), 'd_q4'),
    # ── slide20 一對一追蹤表2 ──
    (20, CELL, (0, 1, -1), 'd_q5'), (20, CELL, (1, 1, -1), 'd_q6'),
    (20, CELL, (2, 1, -1), 'd_q7'), (20, CELL, (3, 1, -1), 'd_q8'),
    (20, CELL, (4, 1, -1), 'd_q9'),
    # ── slide22 產業九宮格 ──
    (22, CELL, (0, 0), 'gr_1'), (22, CELL, (0, 1), 'gr_2'), (22, CELL, (0, 2), 'gr_3'),
    (22, CELL, (1, 0), 'gr_4'), (22, CELL, (1, 1), 'gr_center'), (22, CELL, (1, 2), 'gr_5'),
    (22, CELL, (2, 0), 'gr_6'), (22, CELL, (2, 1), 'gr_7'), (22, CELL, (2, 2), 'gr_8'),
]

# 原版有些框是照範例字數做的，實務上會寫比較多，直接把框調整成合理高度
# （投影片, 文字框序號, 新的高度 EMU）
RESIZE = [(6, 5, 1100000)]      # slide6「需求引薦」：一行 → 約三行

TOKEN = '{{%s}}'
RE_TC = re.compile(r'<a:tc(?:\s[^>]*)?>.*?</a:tc>', re.S)
RE_TR = re.compile(r'<a:tr\s[^>]*>.*?</a:tr>', re.S)
RE_SP = re.compile(r'<p:sp>.*?</p:sp>', re.S)
RE_P  = re.compile(r'<a:p>.*?</a:p>', re.S)


def style_from(para):
    """取這段落的字型設定，做為注入 run 的樣式。"""
    m = re.search(r'<a:rPr(\s[^>]*)?>(.*?)</a:rPr>', para, re.S)
    if m:
        return (m.group(1) or ''), m.group(2)
    m = re.search(r'<a:rPr(\s[^>]*)?/>', para)
    if m:
        return (m.group(1) or ''), ''
    m = re.search(r'<a:endParaRPr(\s[^>]*)?>(.*?)</a:endParaRPr>', para, re.S)
    if m:
        return (m.group(1) or ''), m.group(2)
    m = re.search(r'<a:endParaRPr(\s[^>]*)?/>', para)
    if m:
        return (m.group(1) or ''), ''
    return ' lang="zh-TW" dirty="0"', ''


def append_token(para, token):
    """在段落尾端接上一個帶 token 的 run（保留原有提示文字）。"""
    attrs, inner = style_from(para)
    run = f'<a:r><a:rPr{attrs}>{inner}</a:rPr><a:t>{TOKEN % token}</a:t></a:r>' if inner \
        else f'<a:r><a:rPr{attrs}/><a:t>{TOKEN % token}</a:t></a:r>'
    m = re.search(r'<a:endParaRPr', para)
    if m:
        return para[:m.start()] + run + para[m.start():]
    return para.replace('</a:p>', run + '</a:p>')


def replace_body(body, token):
    """把整個 txBody 換成單一段落（沿用原樣式），內容為 token。"""
    paras = RE_P.findall(body)
    if not paras:
        return body
    first = paras[0]
    ppr = re.search(r'<a:pPr(?:\s[^>]*)?(?:/>|>.*?</a:pPr>)', first, re.S)
    attrs, inner = style_from(first)
    rpr = f'<a:rPr{attrs}>{inner}</a:rPr>' if inner else f'<a:rPr{attrs}/>'
    newp = '<a:p>' + (ppr.group(0) if ppr else '') + \
           f'<a:r>{rpr}<a:t>{TOKEN % token}</a:t></a:r></a:p>'
    start = body.index(paras[0])
    end = body.index(paras[-1]) + len(paras[-1])
    return body[:start] + newp + body[end:]


def edit_cell(xml, row, cell, para, token):
    tbl_m = re.search(r'<a:tbl>.*?</a:tbl>', xml, re.S)
    tbl = tbl_m.group(0)
    rows = RE_TR.findall(tbl)
    tr = rows[row]
    tcs = RE_TC.findall(tr)
    tc = tcs[cell]
    body_m = re.search(r'<a:txBody>.*?</a:txBody>', tc, re.S)
    body = body_m.group(0)
    if para is None:
        newbody = replace_body(body, token)
    else:
        # 用位置取代：空白段落的 XML 常常完全相同，用字串取代會全部命中同一段
        spans = [m.span() for m in RE_P.finditer(body)]
        a, b = spans[para if para >= 0 else len(spans) + para]
        newbody = body[:a] + append_token(body[a:b], token) + body[b:]
    newtc = tc.replace(body, newbody, 1)
    newtr = tr.replace(tc, newtc, 1)
    newtbl = tbl.replace(tr, newtr, 1)
    return xml.replace(tbl, newtbl, 1)


def edit_shape(xml, idx, token):
    sps = RE_SP.findall(xml)
    withtext = [s for s in sps if re.search(r'<a:t>', s)]
    sp = withtext[idx]
    # 文字框用 <p:txBody>，表格才是 <a:txBody>
    body_m = re.search(r'<p:txBody>.*?</p:txBody>', sp, re.S)
    body = body_m.group(0)
    newsp = sp.replace(body, replace_body(body, token), 1)
    return xml.replace(sp, newsp, 1)


def edit_run(xml, shape_idx, run_idx, token):
    """只把某個文字框的第 N 個 run 換成 token，其餘樣式與 run 全部保留。
    原文若有前後空白（例如「王小明 」後面接英文名）要留著，不然兩段會黏在一起。"""
    sps = RE_SP.findall(xml)
    withtext = [sp for sp in sps if re.search(r'<a:t>', sp)]
    sp = withtext[shape_idx]
    spans = [m.span(1) for m in re.finditer(r'<a:t>(.*?)</a:t>', sp, re.S)]
    a, b = spans[run_idx]
    orig = sp[a:b]
    pre = post = ''
    if orig.strip():                       # 整段都是空白就直接換掉
        pre = orig[:len(orig) - len(orig.lstrip())]
        post = orig[len(orig.rstrip()):]
    newsp = sp[:a] + pre + TOKEN % token + post + sp[b:]
    return xml.replace(sp, newsp, 1)


def edit_runs(xml, shape_idx, start, token):
    """token 放進第 start 個 run，後面的 run 全部清空。
    原檔常把一句英文拆成好幾個 run（WANG / XIAO / MING），只換第一個會留下殘字。"""
    sps = RE_SP.findall(xml)
    withtext = [sp for sp in sps if re.search(r'<a:t>', sp)]
    sp = withtext[shape_idx]
    spans = [m.span(1) for m in re.finditer(r'<a:t>(.*?)</a:t>', sp, re.S)]
    new = sp
    for i in range(len(spans) - 1, start - 1, -1):      # 由後往前改，位置才不會跑掉
        a, b = spans[i]
        new = new[:a] + (TOKEN % token if i == start else '') + new[b:]
    return xml.replace(sp, new, 1)


def add_box(xml, g, token):
    """在投影片上補一個新的文字框（原檔沒有、但需要讓會員填字的地方）。"""
    sp = (
        f'<p:sp><p:nvSpPr><p:cNvPr id="9200" name="{token}"/>'
        '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{g["x"]}" y="{g["y"]}"/>'
        f'<a:ext cx="{g["w"]}" cy="{g["h"]}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
        '<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440"'
        ' bIns="45720" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>'
        f'<a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-TW" altLang="en-US"'
        f' sz="{g["sz"]}" b="1" dirty="0">'
        '<a:latin typeface="Microsoft JhengHei" panose="020B0604030504040204"'
        ' pitchFamily="34" charset="-120"/>'
        '<a:ea typeface="Microsoft JhengHei" panose="020B0604030504040204"'
        ' pitchFamily="34" charset="-120"/></a:rPr>'
        f'<a:t>{TOKEN % token}</a:t></a:r></a:p></p:txBody></p:sp>'
    )
    return xml.replace('</p:spTree>', sp + '</p:spTree>', 1)


def resize_shape(xml, idx, h):
    sps = RE_SP.findall(xml)
    withtext = [sp for sp in sps if re.search(r'<a:t>', sp)]
    sp = withtext[idx]
    new = re.sub(r'(<a:ext cx="\d+" cy=")\d+(")', r'\g<1>%d\g<2>' % h, sp, count=1)
    return xml.replace(sp, new, 1)


def main(src, out):
    shutil.copy(src, out)
    zin = zipfile.ZipFile(src)
    slides = {}
    for slide, kind, loc, token in EDITS:
        name = f'ppt/slides/slide{slide}.xml'
        if name not in slides:
            slides[name] = zin.read(name).decode('utf8')
        try:
            if kind == ADD:
                slides[name] = add_box(slides[name], loc, token)
            elif kind == RUNS:
                slides[name] = edit_runs(slides[name], loc[0], loc[1], token)
            elif kind == RUN:
                slides[name] = edit_run(slides[name], loc[0], loc[1], token)
            elif kind == CELL:
                row, cell = loc[0], loc[1]
                para = loc[2] if len(loc) > 2 else None
                slides[name] = edit_cell(slides[name], row, cell, para, token)
            else:
                slides[name] = edit_shape(slides[name], loc, token)
        except Exception as e:
            print(f'  !! slide{slide} {loc} {token}: {e}')
    for slide, idx, h in RESIZE:
        name = f'ppt/slides/slide{slide}.xml'
        if name not in slides:
            slides[name] = zin.read(name).decode('utf8')
        slides[name] = resize_shape(slides[name], idx, h)

    # 版面（母片層）頁尾的「XX 分會 / XXXX CHAPTER」換成本分會名
    layouts = 0
    for n in zin.namelist():
        if not re.match(r'ppt/slideLayouts/slideLayout\d+\.xml$', n):
            continue
        x = zin.read(n).decode('utf8')
        def fix_footer(sp):
            """只動「XX 分會 / XXXX CHAPTER」那一個文字框：換字，並加寬到放得下。"""
            if '<a:t>XX</a:t>' not in sp:
                return sp
            for a, b in CHAPTER:
                sp = sp.replace(f'<a:t>{a}</a:t>', f'<a:t>{b}</a:t>')
            return re.sub(r'(<a:ext cx=")\d+(")', r'\g<1>%d\g<2>' % CHAPTER_BOX, sp, count=1)
        new = RE_SP.sub(lambda m: fix_footer(m.group(0)), x)
        if new != x:
            slides[n] = new
            layouts += 1
    print(f'　版面頁尾分會名已更新：{layouts} 個')

    # 重寫 zip
    zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for it in zin.infolist():
        data = slides[it.filename].encode('utf8') if it.filename in slides else zin.read(it.filename)
        zout.writestr(it, data)
    zout.close()
    # 驗證
    import xml.dom.minidom as md
    zc = zipfile.ZipFile(out)
    bad = 0
    for n in zc.namelist():
        if n.endswith('.xml'):
            try:
                md.parseString(zc.read(n))
            except Exception as e:
                bad += 1
                print('  XML 錯誤:', n, e)
    found = sum(len(re.findall(r'\{\{(\w+)\}\}', zc.read(n).decode('utf8')))
                for n in zc.namelist() if n.startswith('ppt/slides/slide'))
    print(f'完成：{out}　token {found}/{len(EDITS)}　XML 錯誤 {bad}')
    return 0 if bad == 0 and found == len(EDITS) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
