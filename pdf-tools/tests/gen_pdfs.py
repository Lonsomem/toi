#!/usr/bin/env python3
"""테스트용 합성 PDF 생성 (reportlab + 나눔고딕). 정답은 <out>/truth.json
사용: python3 gen_pdfs.py <출력폴더>"""
import sys, os, json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Table, TableStyle, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from PIL import Image
import io

out = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(out, exist_ok=True)
pdfmetrics.registerFont(TTFont('NG', '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'))
pdfmetrics.registerFont(TTFont('NGB', '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'))
st = ParagraphStyle('c', fontName='NG', fontSize=9, leading=12)
stb = ParagraphStyle('b', fontName='NGB', fontSize=9, leading=12)
body = ParagraphStyle('body', fontName='NG', fontSize=10.5, leading=16)

def png():
    im = Image.new('RGB', (120, 60), (200, 60, 60))
    b = io.BytesIO(); im.save(b, 'PNG'); b.seek(0); return ImageReader(b)

def para(c, text, x, y, w, style=body):
    p = Paragraph(text, style); _, h = p.wrap(w, 1000); p.drawOn(c, x, y - h); return y - h

def table(c, data, x, y, colw, style_cmds, style=st):
    d = [[Paragraph(str(v), style) if v != '' else '' for v in row] for row in data]
    t = Table(d, colWidths=colw)
    t.setStyle(TableStyle(style_cmds)); w, h = t.wrap(0, 0); t.drawOn(c, x, y - h); return y - h

truth = {}

# ---------------- A: 표/병합/빈 쪽/이미지 쪽/회전/HWP식
c = canvas.Canvas(f'{out}/tables.pdf', pagesize=A4)
W, H = A4
GRID = [('GRID', (0, 0), (-1, -1), 0.7, colors.black), ('VALIGN', (0, 0), (-1, -1), 'TOP')]
# p1
y = para(c, '제1장 보완수사 요구 처리절차', 50, H - 50, W - 100, stb)
y = para(c, '검사로부터 보완수사 요구서를 접수한 경우 즉시 요구사항을 확인하고 이행계획을 수립하여야 한다. 이행기한은 원칙적으로 접수 후 1개월 이내이며 부득이한 사유가 있으면 연장할 수 있다.', 50, y - 8, W - 100)
t1 = [
    ['구분', '처리 내용', '기한', '비고'],
    ['접수', '검사의 보완수사 요구서를 접수하고 사건기록에 편철한 뒤 담당 수사관에게 즉시 배당한다', '즉시', '전산입력 병행'],
    ['검토', '요구사항 중 이행 가능한 항목과 불가능한 항목을 구분하여 이행계획서를 작성한다', '3일 이내', '불가 사유 명시'],
    ['이행', '피의자 신문 및 참고인 조사 등 보완수사를 실시하고 결과를 수사보고서로 작성한다', '1개월 이내', '연장 시 사유 기재'],
    ['결과', '이행 결과를 검사에게 통보한다', '완료 즉시', '']
]
y = table(c, t1, 50, y - 10, [50, 270, 70, 100], GRID)
truth['tables_p1_rows'] = t1
y = para(c, '※ 위 표의 기한은 영업일이 아닌 달력일 기준이다.', 50, y - 10, W - 100)
c.showPage()
# p2: 선 없는 표 3열
t2 = [['사건유형', '필요 영장', '신청 시 유의사항'],
      ['사기', '계좌 압수수색영장', '피해금 입금 계좌와 거래 기간을 특정하여 신청하며 범죄수익 흐름 규명 필요성을 기재한다'],
      ['보이스피싱', '통신사실확인자료', '가입자 정보와 기지국 위치 정보를 구분하여 요청하고 보존기간 경과 여부를 먼저 확인한다'],
      ['명의도용', '통신 압수수색영장', '개통 일시와 개통 아이피 및 가입신청서 원본 확보 여부를 함께 확인한다'],
      ['중고거래', '계좌 및 통신', '동일 계좌 다른 경찰서 접수 건 여부를 연관사건 조회로 확인한다']]
y = para(c, '제2절 영장 신청 기준 (선 없는 표)', 50, H - 50, W - 100, stb)
y = table(c, t2, 50, y - 14, [80, 130, 300], [('VALIGN', (0, 0), (-1, -1), 'TOP')])
truth['tables_p2_rows'] = t2
c.showPage()
# p3: 빈 쪽
c.showPage()
# p4: 이미지 쪽
c.drawImage(png(), 100, 500, 240, 120)
c.showPage()
# p5: 병합 셀 (colspan, rowspan) + 선 표
t5 = [['항목', '세부 내용', '', '담당'],
      ['A', '가나다라마바사', '아자차카타파하', '홍길동'],
      ['B', '긴 문장이 한 칸 안에서 여러 줄로 줄바꿈 되어도 하나의 셀 문장으로 이어져야 한다', '', '김철수'],
      ['C', '단일', '셀', '이영희']]
cmds = GRID + [('SPAN', (1, 0), (2, 0)), ('SPAN', (1, 2), (2, 2)), ('SPAN', (3, 1), (3, 1))]
y = para(c, '병합 셀 시험', 50, H - 50, W - 100, stb)
y = table(c, t5, 50, y - 12, [40, 150, 150, 80], cmds)
truth['tables_p5_rows'] = t5
c.showPage()
# p6: 회전 쪽 — 내용을 90도 돌려 그리고 /Rotate 90 으로 가로(읽기 방향)로 보이게 (실제 가로 스캔/서식과 동일)
c.saveState(); c.translate(W, 0); c.rotate(90)
y = para(c, '회전된 쪽의 표', 50, W - 50, H - 100, stb)
t6 = [['번호', '내용'], ['1', '회전 쪽에서도 표가 읽혀야 한다'], ['2', '두 번째 행']]
y = table(c, t6, 50, y - 12, [50, 300], GRID)
c.restoreState()
truth['tables_p6_rows'] = t6
c.showPage()
# p7: HWP 식 서식 — 글자 하나씩 그리기 + 이중 인쇄(가짜 굵게) + 두꺼운 테두리 사각형
def draw_chars(cv, s, x, y, size=10, step=None, font='NG', bold=False):
    cv.setFont(font, size)
    for ch in s:
        cv.drawString(x, y, ch)
        if bold: cv.drawString(x + 0.35, y, ch)
        x += step or pdfmetrics.stringWidth(ch, font, size)
    return x
c.setLineWidth(1.5)
form = [('성 명', '홍 길 동'), ('주민등록번호', '800101-1234567'), ('주 소', '서울특별시 종로구 세종대로 1'), ('연락처', '010-1234-5678')]
ytop = H - 120
c.rect(60, ytop - 4 * 28, 440, 4 * 28)
for i, (lab, val) in enumerate(form):
    yy = ytop - (i + 1) * 28
    c.line(60, yy, 500, yy)
    c.line(170, yy, 170, yy + 28)
    draw_chars(c, lab, 68, yy + 9, 10, step=10.5, bold=True)
    draw_chars(c, val, 178, yy + 9, 10)
c.setLineWidth(1)
draw_chars(c, '문서번호  제 2026-00123 호', 60, H - 60, 11)
truth['tables_p7_rows'] = [[f[0], f[1]] for f in form]
c.showPage()
# p8: 쪽 전체 테두리 + 머리말 구분선 + 본문 줄 (표가 아님 — 표로 오인하면 안 됨)
c.setLineWidth(1)
c.rect(40, 40, W - 80, H - 80)
c.line(40, H - 100, W - 40, H - 100)
body_lines = ['수사보고서 본문 첫째 줄입니다 보완수사 요구에 따라 작성합니다', '둘째 줄에는 피의자 인적사항 특정 경위를 기재합니다', '셋째 줄: 통신사실확인자료 회신 결과 분석 내용', '넷째 줄: 향후 수사계획 및 관할 이송 검토 의견',
              '다섯째 줄: 이상과 같이 보고합니다']
c.setFont('NG', 11); c.drawString(60, H - 80, '쪽 테두리 시험 문서')
for i, ln in enumerate(body_lines):
    c.drawString(60, H - 130 - i * 18, ln)
truth['tables_p8_lines'] = body_lines
c.showPage()
c.save()
# p6 을 PDF 수준에서 90도 회전 (reportlab 의 setPageRotation 은 이후 쪽 텍스트가 사라지는 문제가 있어 사용하지 않음)
from pypdf import PdfReader, PdfWriter
rd = PdfReader(f'{out}/tables.pdf'); wr = PdfWriter()
for i, pg in enumerate(rd.pages):
    if i == 5: pg.rotate(90)
    wr.add_page(pg)
wr.write(open(f'{out}/tables.pdf', 'wb'))

# ---------------- B: 1300쪽
N = 1300
c = canvas.Canvas(f'{out}/long_1300.pdf', pagesize=A4)
blank, imgonly, tbl = [], [], []
for i in range(1, N + 1):
    if i % 5 == 0:
        blank.append(i); c.showPage(); continue
    if i % 13 == 0:
        imgonly.append(i); c.drawImage(png(), 100, 500, 120, 60); c.showPage(); continue
    c.setFont('NGB', 11); c.drawString(50, H - 50, f'제{i}쪽 고유표식P{i:04d}')
    c.setFont('NG', 10)
    c.drawString(50, H - 80, f'보완수사 요구 사항은 {i}번 쪽에 있다. 이행기한 연장 사유를 기재한다.')
    c.drawString(50, H - 96, '피의자 인적사항이 특정되기 전에는 이송할 수 없다.')
    if i % 11 == 0:
        tbl.append(i)
        rows = [['구분', f'내용{i}', '기한'], ['접수', f'표행{i}-A', '즉시'], ['검토', f'표행{i}-B', '3일']]
        table(c, rows, 50, H - 130, [60, 200, 60], GRID)
    c.showPage()
c.save()
truth['long'] = {'pages': N, 'blank': blank, 'image_only': imgonly, 'tables': tbl}

# ---------------- C: 표가 매우 많은 무거운 문서 (300쪽 × 45행 × 6열 격자)
c = canvas.Canvas(f'{out}/heavy_tables.pdf', pagesize=A4)
heavy_expect = {}
for pg in range(1, 301):
    c.setFont('NG', 7)
    x0, y0, cw, rh, nr, nc = 30, H - 50, 88, 16, 45, 6
    for r in range(nr + 1): c.line(x0, y0 - r * rh, x0 + nc * cw, y0 - r * rh)
    for k in range(nc + 1): c.line(x0 + k * cw, y0, x0 + k * cw, y0 - nr * rh)
    for r in range(nr):
        for k in range(nc):
            c.drawString(x0 + k * cw + 3, y0 - (r + 1) * rh + 5, f'p{pg}r{r}c{k} 셀내용')
    c.showPage()
c.save()
heavy_expect = {'pages': 300, 'rows': 45, 'cols': 6}
truth['heavy'] = heavy_expect

# ---------------- D: 암호 PDF (열기 암호 pw1234) — 3쪽
c = canvas.Canvas(f'{out}/locked_plain.pdf', pagesize=A4)
for i in range(1, 4):
    c.setFont('NG', 12); c.drawString(50, H - 60, f'암호문서 {i}쪽 비밀표식LOCK{i}'); c.showPage()
c.save()
from pypdf import PdfReader as _R, PdfWriter as _W
_w = _W(); [_w.add_page(p) for p in _R(f'{out}/locked_plain.pdf').pages]; _w.encrypt('pw1234')
_w.write(open(f'{out}/locked.pdf', 'wb'))
os.remove(f'{out}/locked_plain.pdf')

json.dump(truth, open(f'{out}/truth.json', 'w'), ensure_ascii=False, indent=1)
print('ok', out)
