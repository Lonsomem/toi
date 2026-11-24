// QR 전송 종단 간: 검색기(송신 내장) → QR 렌더 → jsQR 판독(20% 프레임 손실) → 수신기 → 자동 저장된 JSON → 새 검색기에서 불러오기
// 사용: LANG=C.UTF-8 node e2e-transfer.test.js <합성PDF폴더>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const SEARCH = 'file:///home/user/toi/pdf-manual-search.html', RECV = 'file:///home/user/toi/qr-receiver.html';
const JSQR = '/home/user/toi/qr-tools/vendor/jsQR.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

async function transfer(ctx, A, opts) {
  // 송신: 모달 열기 → 자동 준비·재생. QR 캔버스를 jsQR 로 판독해 수신기 페이지에 20% 손실로 전달
  const B = await ctx.newPage();
  const errs = []; [A, B].forEach(p => p.on('pageerror', e => errs.push(e.message)));
  await B.goto(RECV);
  await A.evaluate(() => { window.__texts = []; });
  if (opts.viewer) await A.evaluate(() => { document.getElementById('qrViewer').checked = true; });
  // 빠른 시험을 위해 초당 프레임을 30 으로(주사율 60Hz → 2틱)
  await A.evaluate(() => { document.getElementById('qrFps').value = '30'; });
  await A.evaluate(() => QRSEND.open());
  await A.waitForFunction(() => QRSEND.state.playing, null, { timeout: 120000 });
  const dlP = B.waitForEvent('download', { timeout: 200000 }).catch(() => null);
  let fed = 0, drop = 0; const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    const batch = await A.evaluate(() => { const t = window.__texts; window.__texts = []; return t; });
    for (const t of batch) { if (t === null) continue; if (Math.random() < 0.2) { drop++; continue; } await B.evaluate(tx => window.__qrxRecv.onFrame(QX.decodeScanned(tx, null)), t); fed++; }
    if (await B.evaluate(() => !!window.__qrxRecv.R.files)) break;
    await A.waitForTimeout(120);
  }
  const files = await B.evaluate(() => (window.__qrxRecv.R.files || []).map(f => ({ name: f.name, size: f.size })));
  return { B, files, fed, drop, errs, dlP, sec: (Date.now() - t0) / 1000 };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const A = await ctx.newPage();
  const errsA = []; A.on('pageerror', e => errsA.push(e.message));
  const ext = []; A.on('request', r => { const u = r.url(); if (!/^(file:|blob:|data:)/.test(u)) ext.push(u); });
  await A.goto(SEARCH);
  await A.waitForFunction(() => PDFENGINE.state.ready, null, { timeout: 30000 });
  await A.addScriptTag({ path: JSQR });
  await A.evaluate(() => {
    const o = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (img, x, y) {
      if (img.width > 250 && document.getElementById('qrModal').classList.contains('open')) {
        const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        window.__texts.push(r && r.data.indexOf('QX') === 0 ? r.data : null);
      }
      return o.apply(this, arguments);
    };
  });
  // 문서 등록: 표 PDF(빈·이미지 쪽 포함) + 1300쪽
  await A.setInputFiles('#pdfInput', [
    { name: '보완수사_표_매뉴얼.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'tables.pdf')) },
    { name: '장문_1300쪽.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'long_1300.pdf')) }]);
  await A.waitForFunction(() => app.docs.some(d => d.fileName === '장문_1300쪽.pdf') && app.docs.some(d => d.fileName === '보완수사_표_매뉴얼.pdf'), null, { timeout: 120000 });
  // 샘플 2권은 체크 해제(전송 대상에서 제외되는지도 함께 확인)
  await A.evaluate(() => app.docs.forEach(d => { if (/^0[12]_/.test(d.fileName)) d.checked = false; }));
  const want = await A.evaluate(() => app.docs.filter(d => d.checked !== false).map(d => ({ name: d.fileName, n: d.numPages, pages: d.pages.length, blank: d.pages.filter(p => p.st === 'blank').length, img: d.pages.filter(p => p.st === 'img').length, toc: d.toc.length, txt: d.pages.map(p => p.text).join('\u0001') })));

  // ===== 1) JSON 만 전송 (기본)
  const r1 = await transfer(ctx, A, { viewer: false });
  console.log('전송 1:', r1.sec.toFixed(1) + '초, 프레임', r1.fed, '손실', r1.drop, r1.files);
  ok(r1.files.length === 1 && /^매뉴얼색인_\d{8}_\d{4}_2권\.json$/.test(r1.files[0].name), '수신 파일 1개: ' + (r1.files[0] && r1.files[0].name) + ' (체크 해제한 샘플 2권은 제외)');
  const dl = await r1.dlP;
  ok(!!dl, '수신기가 완료 즉시 자동 저장(다운로드) 실행');
  const jpath = '/tmp/pdf_recv.json'; await dl.saveAs(jpath);
  const js = JSON.parse(fs.readFileSync(jpath, 'utf8'));
  ok(js.v === 2 && js.kind === 'pdf-manual-index' && js.docs.length === 2, '전송 JSON 구조 (v2, 2권)');
  ok(js.docs.every(d => !d.toc && d.numPages > 0), '목차·보조 데이터는 제외된 슬림 형식');
  ok(/매뉴얼 2권 · 1308쪽/.test(await r1.B.textContent('#verifyMsg')), '수신기 요약 표시: ' + (await r1.B.textContent('#verifyMsg')));
  // 글 있는 쪽의 텍스트가 원본과 같은지
  const gotTxt = js.docs.map(d => ({ name: d.fileName, txt: d.pages.map(p => p.text).join('\u0001') }));
  const L = want.find(w => w.name === '장문_1300쪽.pdf'), Lj = js.docs.find(d => d.fileName === '장문_1300쪽.pdf');
  ok(Lj.bl.length === L.blank && Lj.im.length === L.img && Lj.pages.length === L.pages - L.blank - L.img, '빈 쪽 ' + L.blank + '·이미지 쪽 ' + L.img + '은 번호 목록으로만 전송, 글 쪽 ' + Lj.pages.length + '개');
  ok(fs.statSync(jpath).size < 5e6, '수신 JSON 크기 ' + (fs.statSync(jpath).size / 1024).toFixed(0) + ' KB');

  // ===== 2) 깨끗한 브라우저(외부망 역할)에서 JSON 불러오기 → 쪽 번호·표·검색 복원
  const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const C = await ctx2.newPage(); const errsC = []; C.on('pageerror', e => errsC.push(e.message));
  await C.goto(SEARCH);
  await C.waitForFunction(() => PDFENGINE.state.ready, null, { timeout: 30000 });
  await C.setInputFiles('#pdfInput', [{ name: '매뉴얼색인.json', mimeType: 'application/json', buffer: fs.readFileSync(jpath) }]);
  await C.waitForFunction(() => app.docs.some(d => d.fileName === '장문_1300쪽.pdf'), null, { timeout: 30000 });
  const got = await C.evaluate(() => app.docs.filter(d => /1300|표_매뉴얼/.test(d.fileName)).map(d => ({ name: d.fileName, n: d.numPages, pages: d.pages.length, blank: d.pages.filter(p => p.st === 'blank').length, img: d.pages.filter(p => p.st === 'img').length, toc: d.toc.length, txt: d.pages.map(p => p.text).join('\u0001') })));
  want.forEach(w => {
    const g = got.find(x => x.name === w.name);
    ok(g && g.n === w.n && g.pages === w.pages && g.blank === w.blank && g.img === w.img, w.name + ': 쪽 ' + w.n + '개·빈 ' + w.blank + '·이미지 ' + w.img + ' 모두 복원 (쪽 번호 유지)');
    ok(g && g.txt === w.txt, w.name + ': 본문 텍스트가 원본과 완전히 동일 (한글·표 표식 포함)');
    ok(g && g.toc === w.toc, w.name + ': 목차 ' + w.toc + '개 수신 측에서 재생성');
  });
  await C.fill('#searchInput', '고유표식P1299'); await C.waitForTimeout(500);
  ok(await C.evaluate(() => app.results.length) === 1, '불러온 데이터로 검색 동작');
  await C.evaluate(() => app.jumpToPage(1300));
  ok(/빈 쪽/.test(await C.textContent('#readerBox')), '1300쪽(빈 쪽) 이동·안내 정상');

  // ===== 3) 검색기 포함 옵션
  await A.evaluate(() => QRSEND.close());
  const r2 = await transfer(ctx, A, { viewer: true });
  console.log('전송 2(검색기 포함):', r2.sec.toFixed(1) + '초', r2.files);
  ok(r2.files.length === 2 && r2.files.some(f => f.name === 'PDF검색기_검색전용.html'), '검색기 포함 시 파일 2개 (JSON + 검색 전용 HTML)');
  const htmlBytes = await r2.B.evaluate(() => { const f = window.__qrxRecv.R.files.find(x => /\.html$/.test(x.name)); return Array.from(f.data); });
  // (테스트 도구가 송신 페이지에 주입한 jsQR 스크립트는 앱 코드가 아니므로 크기 계산에서 제외)
  let htmlStr = Buffer.from(htmlBytes).toString('utf8');
  htmlStr = htmlStr.replace(/<script type="text\/javascript">[\s\S]*?<\/script>/, '');
  const htmlSize = Buffer.byteLength(htmlStr);
  ok(htmlSize < 260 * 1024 && htmlSize > 100 * 1024, '검색 전용 HTML 크기 ' + (htmlSize / 1024).toFixed(0) + ' KB (엔진 제외, 전체판은 약 900KB)');
  fs.writeFileSync('/tmp/pdf_viewer_only.html', htmlStr);
  const ctx3 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const D = await ctx3.newPage(); const errsD = []; D.on('pageerror', e => errsD.push(e.message));
  await D.goto('file:///tmp/pdf_viewer_only.html');
  await D.waitForFunction(() => PDFENGINE.state.viewerOnly, null, { timeout: 20000 });
  ok(/검색 전용/.test(await D.textContent('#engineBadge')), '수신한 HTML 은 검색 전용 모드로 열림: ' + (await D.textContent('#engineBadge')));
  await D.setInputFiles('#pdfInput', [{ name: 'x.json', mimeType: 'application/json', buffer: fs.readFileSync(jpath) }]);
  await D.waitForFunction(() => app.docs.some(d => d.fileName === '장문_1300쪽.pdf'), null, { timeout: 30000 });
  await D.fill('#searchInput', '고유표식P0501'); await D.waitForTimeout(500);
  ok(await D.evaluate(() => app.results.length) === 1, '검색 전용 HTML 에서 JSON 불러오기·검색 정상');
  ok(ext.length === 0, '외부 네트워크 요청 0건 ' + JSON.stringify(ext.slice(0, 3)));
  const all = errsA.concat(r1.errs, r2.errs, errsC, errsD);
  ok(all.length === 0, '페이지 오류 없음 ' + JSON.stringify(all.slice(0, 3)));
  console.log('fails', fails);
  await b.close(); process.exit(fails ? 1 : 0);
})();
