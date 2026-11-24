// 사용: node extract.test.js <합성PDF폴더>   (gen_pdfs.py 로 생성, cwd 에 node_modules/pdfjs-dist@3.11.174 필요)
const fs = require('fs'), path = require('path');
const PL = require('../src/layout.js');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const dir = process.argv[2];
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

async function extract(file, opt, onPage) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, verbosity: 0, cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ disableCombineTextItems: true });
    const ol = await page.getOperatorList();
    const pd = PL.fromPdfJs(tc, ol, pdfjs.OPS, vp.transform, vp.width, vp.height);
    const r = PL.composePage(pd, opt);
    pages.push({ p, text: r.text, stats: r.stats, hasImage: pd.hasImage, hasText: pd.items.length > 0 });
    page.cleanup();
  }
  return { n: doc.numPages, pages };
}
const norm = s => String(s).replace(/\s+/g, ' ').trim();
function rowsOf(text) { return text.split('\n').filter(l => l.charAt(0) === PL.ROW).map(l => l.slice(1).split(PL.CELL).map(norm)); }
function hasRows(text, expected, label) {
  const got = rowsOf(text);
  let miss = [];
  expected.forEach(er => {
    const e = er.map(norm);
    const found = got.some(g => {
      // 병합 셀로 빈 칸이 생긴 경우를 허용: 기대 셀 중 비어있지 않은 것이 모두 같은 순서로 존재
      const ne = e.filter(Boolean), ng = g.filter(Boolean);
      return ne.length === ng.length && ne.every((v, i) => v === ng[i]);
    });
    if (!found) miss.push(e.join('|'));
  });
  ok(miss.length === 0, label + (miss.length ? ' 누락: ' + JSON.stringify(miss) : ''));
}

(async () => {
  const t = await extract(path.join(dir, 'tables.pdf'), {});
  ok(t.n === 8, '표 PDF 쪽수 8');
  hasRows(t.pages[0].text, truth.tables_p1_rows, 'p1 선 표(셀 내 줄바꿈 병합)');
  ok(t.pages[0].text.indexOf('제1장 보완수사 요구 처리절차') === 0, 'p1 제목이 맨 앞(읽기 순서)');
  ok(/※ 위 표의 기한은/.test(t.pages[0].text.split('\n').pop()), 'p1 표 뒤 문단이 표 다음에 위치');
  hasRows(t.pages[1].text, truth.tables_p2_rows, 'p2 선 없는 표 추정');
  ok(t.pages[2].text === '' && !t.pages[2].hasText && !t.pages[2].hasImage, 'p3 빈 쪽 판정');
  ok(t.pages[3].text === '' && t.pages[3].hasImage, 'p4 이미지 쪽 판정');
  hasRows(t.pages[4].text, truth.tables_p5_rows, 'p5 병합 셀(colspan/rowspan)');
  hasRows(t.pages[5].text, truth.tables_p6_rows, 'p6 회전 쪽(/Rotate 90)');
  hasRows(t.pages[6].text, truth.tables_p7_rows, 'p7 HWP식 글자단위+이중인쇄');
  ok(t.pages[6].text.indexOf('주주') < 0, 'p7 이중 인쇄 글자 중복 없음');
  const p8 = t.pages[7].text;
  ok(p8.indexOf(PL.ROW) < 0 && truth.tables_p8_lines.every(l => p8.indexOf(l) >= 0) && p8.split('\n').length === 6, 'p8 쪽 테두리+머리말 선: 표로 오인하지 않고 줄 구조 유지');
  // 표 감지를 끄면 이전처럼 줄 단위로만 나오는지(옵션 동작)
  const off = await extract(path.join(dir, 'tables.pdf'), { ruled: false, borderless: false });
  ok(rowsOf(off.pages[0].text).length === 0, '표 감지 끄기 옵션 동작');

  const t0 = Date.now();
  const L = await extract(path.join(dir, 'long_1300.pdf'), {});
  const sec = (Date.now() - t0) / 1000;
  ok(L.n === truth.long.pages, '장문 PDF 쪽수 ' + L.n);
  ok(L.pages.length === 1300, '쪽 목록 1300개 유지');
  const blankFound = L.pages.filter(x => !x.hasText && !x.hasImage).map(x => x.p);
  const imgFound = L.pages.filter(x => !x.hasText && x.hasImage).map(x => x.p);
  ok(JSON.stringify(blankFound) === JSON.stringify(truth.long.blank), '빈 쪽 ' + blankFound.length + '개 정확히 판정');
  ok(JSON.stringify(imgFound) === JSON.stringify(truth.long.image_only), '이미지 쪽 ' + imgFound.length + '개 정확히 판정');
  let markerOk = 0, markerBad = [];
  L.pages.forEach(x => { if (x.hasText) { if (x.text.indexOf('고유표식P' + String(x.p).padStart(4, '0')) >= 0) markerOk++; else markerBad.push(x.p); } });
  ok(markerBad.length === 0, '텍스트 쪽 ' + markerOk + '개 모두 고유표식 포함 (마지막 쪽 1299 포함: ' + (L.pages[1298].text.indexOf('P1299') >= 0) + ')');
  const tblPages = L.pages.filter(x => x.stats.tables > 0).map(x => x.p);
  ok(JSON.stringify(tblPages) === JSON.stringify(truth.long.tables.filter(p => truth.long.blank.indexOf(p) < 0 && truth.long.image_only.indexOf(p) < 0)), '표가 있는 쪽 ' + tblPages.length + '개 판정');
  console.log('1300쪽 추출 시간(Node, 단일 스레드):', sec.toFixed(1), '초');
  console.log('fails', fails);
  process.exit(fails ? 1 : 0);
})();
