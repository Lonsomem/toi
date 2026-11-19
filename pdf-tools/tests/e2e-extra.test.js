// 사용: LANG=C.UTF-8 node e2e-extra.test.js <합성PDF폴더>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const URL = 'file:///home/user/toi/pdf-manual-search.html';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => PDFENGINE.state.ready, null, { timeout: 30000 });
  // 1) 무거운 표 문서
  const t0 = Date.now();
  await p.setInputFiles('#pdfInput', [{ name: 'heavy.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'heavy_tables.pdf')) }]);
  await p.waitForFunction(() => app.docs.some(d => d.fileName === 'heavy.pdf'), null, { timeout: 280000 });
  const sec = (Date.now() - t0) / 1000;
  const H = await p.evaluate(() => { const d = app.docs.find(x => x.fileName === 'heavy.pdf'); return { n: d.numPages, rep: d.report, p1: d.pages[0].text, p300: d.pages[299].text }; });
  ok(H.n === 300 && H.rep.fail === 0 && H.rep.tables === 300, '무거운 표 300쪽: 표 300개 모두 인식, 실패 0 (' + sec.toFixed(1) + '초, 쪽당 ' + (sec / 300 * 1000).toFixed(0) + 'ms)');
  const rows1 = H.p1.split('\n').filter(l => l.charAt(0) === '␞');
  ok(rows1.length === 45 && rows1.every(r => r.split('␟').length === 6), '1쪽: 45행 × 6열 정확');
  ok(H.p300.indexOf('p300r44c5 셀내용') >= 0 && H.p300.indexOf('p300r0c0 셀내용') >= 0, '300쪽 첫/마지막 셀 포함');
  // 2) 암호 PDF: 비밀번호 입력
  p.once('dialog', d => d.accept('pw1234'));
  await p.setInputFiles('#pdfInput', [{ name: 'locked.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'locked.pdf')) }]);
  await p.waitForFunction(() => app.docs.some(d => d.fileName === 'locked.pdf'), null, { timeout: 60000 });
  ok(await p.evaluate(() => app.docs.find(d => d.fileName === 'locked.pdf').pages.map(x => x.text).join('|')) === '암호문서 1쪽 비밀표식LOCK1|암호문서 2쪽 비밀표식LOCK2|암호문서 3쪽 비밀표식LOCK3', '암호 PDF: 비밀번호 입력 후 3쪽 추출');
  // 3) 암호 취소 → 앱이 멈추지 않고 원본 뷰어로 안내
  p.once('dialog', d => d.dismiss());
  await p.setInputFiles('#pdfInput', [{ name: 'locked2.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'locked.pdf')) }]);
  await p.waitForTimeout(2500);
  ok(await p.evaluate(() => !document.getElementById('parseModal').classList.contains('open') && !app.docs.some(d => d.fileName === 'locked2.pdf')), '암호 입력 취소: 진행창 닫힘, 문서 미등록, 앱 정상');
  // 4) 중단: 처리 중 cancel → 지금까지 쪽 저장 + 보고서에 중단 표시
  const pr = p.setInputFiles('#pdfInput', [{ name: 'cancelme.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'heavy_tables.pdf')) }]);
  await p.waitForFunction(() => document.getElementById('parseModal').classList.contains('open'), null, { timeout: 10000 });
  await p.waitForTimeout(700);
  await p.evaluate(() => app.cancelParsing());
  await p.waitForFunction(() => app.docs.some(d => d.fileName === 'cancelme.pdf'), null, { timeout: 60000 });
  const C = await p.evaluate(() => { const d = app.docs.find(x => x.fileName === 'cancelme.pdf'); return { n: d.numPages, got: d.pages.length, cancelled: d.report.cancelled }; });
  ok(C.cancelled && C.got > 0 && C.got < C.n && C.n === 300, '중단: ' + C.got + '/' + C.n + '쪽까지 저장, 보고서에 중단 표시');
  ok(/중단/.test(await p.evaluate(() => { app.openReportModal(); return document.getElementById('reportBody').innerText; })), '보고서에 "PDF 300쪽 중 N쪽만 처리됨" 경고 표시');
  // 5) 한 쪽 실패해도 계속 (getPage 실패 주입)
  const F = await p.evaluate(async () => {
    const fake = { getPage: n => n === 2 ? Promise.reject(new Error('깨진 쪽')) : Promise.resolve({ getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100], width: 100, height: 100 }), getTextContent: () => Promise.resolve({ items: [{ str: 'ok' + n, transform: [10, 0, 0, 10, 5, 50], width: 20, height: 10 }] }), getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }), cleanup() { } }) };
    const out = [];
    for (let n = 1; n <= 3; n++) out.push(await app.extractOnePage(fake, n, { ruled: true, borderless: true }));
    return out.map(r => r.page.st || 'ok');
  });
  ok(JSON.stringify(F) === '["ok","fail","ok"]', '한 쪽 실패해도 다음 쪽 계속 처리: ' + JSON.stringify(F));
  // 6) 스크린샷
  await p.evaluate(() => { const d = app.docs.find(x => x.fileName === 'heavy.pdf'); app.openReader(d.id, 1); app.closeReportModal(); });
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  console.log('fails', fails);
  await b.close(); process.exit(fails ? 1 : 0);
})();
