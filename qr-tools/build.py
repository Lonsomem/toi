#!/usr/bin/env python3
"""qr-tools/src 의 조각을 합쳐 수신기 단일 HTML(qr-receiver.html)을 만든다. (송신은 pdf-manual-search.html 에 내장됨)
사용: python3 qr-tools/build.py"""
import os, re
base = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(base)
rd = lambda *p: open(os.path.join(base, *p), encoding='utf-8').read()

def safe(js):
    # 인라인 <script> 안에서 HTML 파서가 오해할 수 있는 시퀀스 방지
    assert '</script' not in js.lower(), '</script 시퀀스 발견'
    return js

def build(template, repl, out):
    html = rd('src', template)
    for k, v in repl.items():
        assert ('/*@@%s@@*/' % k) in html
        html = html.replace('/*@@%s@@*/' % k, safe(v))
    open(os.path.join(root, out), 'w', encoding='utf-8', newline='\n').write(html)
    print(out, len(html.encode('utf-8')) // 1024, 'KB')

core = rd('src', 'core.js')
build('receiver.template.html', {'CORE': core, 'JSQR': rd('vendor', 'jsQR.js'), 'UI': rd('src', 'receiver-ui.js')}, 'qr-receiver.html')
