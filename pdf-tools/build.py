#!/usr/bin/env python3
"""pdf-tools/src 의 조각 + vendor 의 PDF.js(압축·Base64)를 합쳐 단일 HTML(pdf-manual-search.html)을 만든다.
사용: python3 pdf-tools/build.py"""
import os, json, zlib, base64, glob
base = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(base)
rd = lambda *p: open(os.path.join(base, *p), encoding='utf-8').read()
rb = lambda *p: open(os.path.join(base, *p), 'rb').read()

def slot(data: bytes) -> str:
    """raw deflate 후 Base64: '<원본크기>:<b64>'  (엔진 로더·QX.inflate 가 해제)"""
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    z = c.compress(data) + c.flush()
    return '%d:%s' % (len(data), base64.b64encode(z).decode('ascii'))

def safe(js):
    assert '</script' not in js.lower(), '</script 시퀀스 발견'
    return js

V = os.path.join('vendor', 'pdfjs-3.11.174')
cm = {}
for f in sorted(glob.glob(os.path.join(base, V, 'cmaps', '*.bcmap'))):
    cm[os.path.basename(f)[:-6]] = base64.b64encode(open(f, 'rb').read()).decode('ascii')

html = rd('src', 'template.html')
app_js = rd('src', 'app.js').replace('/*@@SAMPLES@@*/', rd('src', 'samples.js'))
repl = {
    'PDFJS_MAIN': slot(rb(V, 'pdf.min.js')),
    'PDFJS_WORKER': slot(rb(V, 'pdf.worker.min.js')),
    'PDFJS_CMAPS': slot(json.dumps(cm).encode('ascii')),
    'ZLIB': safe(open(os.path.join(root, 'qr-tools', 'src', 'core.js'), encoding='utf-8').read()),
    'LAYOUT': safe(rd('src', 'layout.js')),
    'ENGINE': safe(rd('src', 'engine.js')),
    'APP': safe(app_js),
}
for k, v in repl.items():
    m = '/*@@%s@@*/' % k
    assert m in html, m
    html = html.replace(m, v)
out = os.path.join(root, 'pdf-manual-search.html')
open(out, 'w', encoding='utf-8', newline='\n').write(html)
print('pdf-manual-search.html', len(html.encode('utf-8')) // 1024, 'KB')
