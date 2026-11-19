// 사용: LANG=C.UTF-8 node e2e.test.js <합성PDF폴더>   (Playwright 필요, 사전: python3 gen_pdfs.py <폴더>)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
const URL = 'file:///home/user/toi/pdf-manual-search.html';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const ext = []; p.on('request', r => { const u = r.url(); if (!/^(file:|blob:|data:)/.test(u)) ext.push(u); });
  await p.goto(URL);
  await p.waitForFunction(() => PDFENGINE.state.ready || PDFENGINE.state.error, null, { timeout: 30000 });
  ok(await p.evaluate(() => PDFENGINE.state.ready), '내장 엔진 로드(외부 통신 없음) — ' + (await p.textContent('#engineBadge')));
  // 외부 요청이 한 건도 없었는지
  // (로컬 file:// 외 요청은 없어야 함: 요청 목록 검사)
  // ---- 표 PDF (한글 파일명은 버퍼로 전달)
  await p.setInputFiles('#pdfInput', [{ name: '보완수사_표_매뉴얼.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'tables.pdf')) }]);
  await p.waitForFunction(() => app.docs.some(d => d.fileName === '보완수사_표_매뉴얼.pdf'), null, { timeout: 60000 });
  const d1 = await p.evaluate(() => { const d = app.docs.find(x => x.fileName === '보완수사_표_매뉴얼.pdf'); return { n: d.numPages, pages: d.pages.length, rep: d.report }; });
  ok(d1.n === 8 && d1.pages === 8, '표 PDF 8쪽 모두 목록 유지 (빈 쪽 포함) — ' + JSON.stringify({ ok: d1.rep.ok, blank: d1.rep.blank, img: d1.rep.img, tables: d1.rep.tables, bl: d1.rep.borderless }));
  ok(d1.rep.blank === 1 && d1.rep.img === 1 && d1.rep.tables >= 4, '보고서: 빈 쪽 1, 이미지 쪽 1, 선 표 ≥4');
  // 리더: 표가 실제 table 로 렌더
  await p.evaluate(() => { const d = app.docs.find(x => x.fileName === '보완수사_표_매뉴얼.pdf'); app.openReader(d.id, 1); });
  ok(await p.evaluate(() => document.querySelectorAll('#readerBox table.rtbl tr').length) === 5, '리더에 표(5행) 렌더');
  // 줄바꿈을 가로지르는 검색 + 표 셀 검색
  await p.fill('#searchInput', '이행기한은 원칙적으로');
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => app.results.length) >= 1, '줄바꿈 넘는 문장 검색됨');
  await p.fill('#searchInput', '검사 + 보완수사 + 편철');
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => app.results.length) >= 1, '표 셀 안의 다중단어 검색됨');
  // ---- 1300쪽
  const t0 = Date.now();
  await p.setInputFiles('#pdfInput', [{ name: '장문_1300쪽.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(dir, 'long_1300.pdf')) }]);
  await p.waitForFunction(() => app.docs.some(d => d.fileName === '장문_1300쪽.pdf'), null, { timeout: 240000 });
  const sec = (Date.now() - t0) / 1000;
  const L = await p.evaluate(() => { const d = app.docs.find(x => x.fileName === '장문_1300쪽.pdf'); return { n: d.numPages, pages: d.pages.length, rep: d.report, last: d.pages[d.pages.length - 1].pageNum, id: d.id }; });
  ok(L.n === 1300 && L.pages === 1300 && L.last === 1300, '1300쪽 문서: 목록 1300개, 마지막 쪽 1300 (' + sec.toFixed(1) + '초)');
  ok(L.rep.blank === truth.long.blank.length && L.rep.img === truth.long.image_only.length && L.rep.fail === 0, '빈 쪽 ' + L.rep.blank + ' / 이미지 ' + L.rep.img + ' / 실패 0 일치');
  // 800쪽 이후 이동 (원본에서 막혔던 동작)
  await p.evaluate(id => app.openReader(id, 799), L.id);
  for (let i = 0; i < 6; i++) await p.evaluate(() => app.movePage(1));
  ok(await p.evaluate(() => app.activePageNum) === 805, '◀▶ 로 800쪽 넘어 805쪽까지 이동 (빈 쪽 포함 순서)');
  await p.evaluate(() => app.jumpToPage(1299));
  ok(await p.evaluate(() => app.activePageNum) === 1299 && /제1299쪽 고유표식P1299/.test(await p.textContent('#readerBox')), '1299쪽 직접 이동·본문 표시');
  await p.evaluate(() => app.jumpToPage(1300));
  ok(await p.evaluate(() => app.activePageNum) === 1300 && /빈 쪽/.test(await p.textContent('#readerBox')) && /1300\/1300쪽/.test(await p.textContent('#pageIndicator')), '1300쪽(빈 쪽) 안내 표시, 지표 1300/1300쪽');
  await p.fill('#searchInput', '고유표식P1299');
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => app.results.length) === 1, '1299쪽 고유표식 검색 1건');
  const tS = Date.now(); await p.fill('#searchInput', '보완수사 + 이행기한'); await p.waitForTimeout(500);
  const nres = await p.evaluate(() => app.results.length);
  const tSearch = await p.evaluate(() => { const t = performance.now(); app.search(); return performance.now() - t; });
  ok(nres > 900 && tSearch < 1500, '다중 검색 ' + nres + '건, 1회 ' + Math.round(tSearch) + 'ms');
  // ---- 새로고침 후 IndexedDB 복원
  await p.reload();
  await p.waitForFunction(() => app.docs.length >= 2 && PDFENGINE.state.ready, null, { timeout: 60000 });
  const R = await p.evaluate(() => app.docs.map(d => d.fileName + ':' + d.numPages));
  ok(R.indexOf('장문_1300쪽.pdf:1300') >= 0 && R.indexOf('보완수사_표_매뉴얼.pdf:8') >= 0, '새로고침 후 IndexedDB 에서 복원: ' + R.join(', '));
  // ---- 단일 HTML 저장 → 새 컨텍스트(IDB 없음)에서 열어 복원
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.evaluate(() => app.downloadEmbeddedHtml())]);
  const savedPath = '/tmp/pdf_saved.html'; await dl.saveAs(savedPath);
  const sz = fs.statSync(savedPath).size;
  console.log('저장된 HTML 크기', (sz / 1048576).toFixed(2), 'MB');
  const html = fs.readFileSync(savedPath, 'utf8');
  ok((html.match(/id="pdfjs-injected"/g) || []).length === 0, '저장본에 주입된 엔진 스크립트 중복 없음');
  ok(/<script id="embedded-pdf-index-b64" type="text\/plain">Z1:/.test(html), '내장 색인이 Z1 압축 형식');
  const ctx2 = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p2 = await ctx2.newPage(); const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto('file://' + savedPath);
  await p2.waitForFunction(() => app.docs.length >= 2 && PDFENGINE.state.ready, null, { timeout: 60000 });
  const R2 = await p2.evaluate(() => app.docs.map(d => d.fileName + ':' + d.numPages + ':' + d.pages.length));
  ok(R2.indexOf('장문_1300쪽.pdf:1300:1300') >= 0, '저장본(깨끗한 브라우저)에서 문서 복원: ' + R2.join(', '));
  await p2.fill('#searchInput', '고유표식P0777'); await p2.waitForTimeout(500);
  ok(await p2.evaluate(() => app.results.length) === 1, '저장본에서 검색 동작');
  ok(ext.length === 0, '외부 네트워크 요청 0건 ' + JSON.stringify(ext.slice(0, 3)));
  ok(errs.length === 0 && errs2.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.concat(errs2).slice(0, 3)));
  console.log('fails', fails);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
