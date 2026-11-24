// 범죄사실란 "미입력 표시줄" 테스트 (docs/case-note.md 13절)
// 사용: LANG=C.UTF-8 node tests/case-note/missing-slots.test.js
// Playwright 필요. 저장소 밖에 설치해도 됨: PLAYWRIGHT_DIR=<node_modules 가 있는 폴더> 로 지정
//   예) mkdir -p ~/.cache/toi-test && cd ~/.cache/toi-test && npm i playwright && npx playwright install chromium-headless-shell
//       PLAYWRIGHT_DIR=~/.cache/toi-test LANG=C.UTF-8 node tests/case-note/missing-slots.test.js
const path = require('path');
const pwDir = process.env.PLAYWRIGHT_DIR;
const { chromium } = require(pwDir ? path.join(pwDir, 'node_modules', 'playwright') : 'playwright');
const URL = 'file://' + path.resolve(__dirname, '..', '..', 'case-note.html');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  await p.evaluate(() => app.openCaseDetail(app.cases[0].id));
  const bar = '#crimeFactMissingBar';
  const barText = async () => (await p.$(bar)) && await p.isVisible(bar) ? (await p.textContent(bar)).replace(/\s+/g, ' ').trim() : '';

  // ---- T1: 입력 내용에 따라 미입력 개수·항목 표시, 0곳이면 사라짐
  await p.fill('#detailCrimeFact', '피의자는 2026. 1. 1. 구글(GOOGLE) 메신저로 피해자 OO에게 연락하여 금 ○○○원을 OO은행 계좌로 송금받고 {{고소인2.이름}} 에게도 같은 방법으로 접근하였다.');
  const t1 = await barText();
  ok(/미입력 4곳/.test(t1), `T1 개수(OO×2, ○○○, {{…}}; GOOGLE 제외) — "${t1}"`);
  ok(t1.includes('OO ×2') && t1.includes('○○○') && t1.includes('{{고소인2.이름}}'), 'T1 항목 표시');
  await p.fill('#detailCrimeFact', '피의자는 피해자 홍길동에게 금 100만원을 송금받았다.');
  ok(await barText() === '', 'T1 미입력 0곳이면 표시줄 숨김');

  // ---- T3: 미입력이 남은 채 [📋 복사] → 경고 토스트, 0곳이면 경고 없음
  const lastToast = async () => p.evaluate(() => { const t = document.querySelectorAll('#toastContainer .toast'); return t.length ? t[t.length - 1].textContent.trim() : ''; });
  await p.fill('#detailCrimeFact', '피해자 OO에게 {{고소인2.이름}} 명의로');
  await p.evaluate(() => app.copyFieldText('crimeFact', '범죄사실'));
  const t3 = await lastToast();
  ok(/미입력 2곳 포함/.test(t3), `T3 복사 시 경고 — "${t3}"`);
  await p.fill('#detailCrimeFact', '피해자 홍길동에게');
  await p.evaluate(() => app.copyFieldText('crimeFact', '범죄사실'));
  const t3b = await lastToast();
  ok(/복사되었습니다/.test(t3b) && !/미입력/.test(t3b), `T3 0곳이면 일반 복사 안내 — "${t3b}"`);

  // ---- T5: 저장본(Quine)에 표시줄 내용이 박히지 않음 + 한 화면 핏 유지
  const many = Array.from({ length: 12 }, (_, i) => `{{고소인${i + 2}.이름}}`).join(' ') + ' OO ○○ OOO';
  await p.fill('#detailCrimeFact', many);
  const saved = await p.evaluate(() => app.buildCleanHtmlDocumentString());
  const m5 = saved.match(/<div id="crimeFactMissingBar"[^>]*>([\s\S]*?)<\/div>/);
  ok(m5 && m5[1].trim() === '', 'T5 저장본의 표시줄은 비어 있음(dynamicContainerIds)');
  ok(m5 && !/display:\s*flex/.test(m5[0]), 'T5 저장본에서 빈 표시줄이 보이지 않음(인라인 display 없음)');
  const fit = await p.evaluate(() => {
    const bar = document.getElementById('crimeFactMissingBar').getBoundingClientRect();
    const card = document.getElementById('crimeFactMissingBar').closest('.bento-card').getBoundingClientRect();
    const ta = document.getElementById('detailCrimeFact').getBoundingClientRect();
    return { barIn: bar.bottom <= card.bottom + 1 && bar.bottom <= innerHeight, taH: ta.height, pageScroll: document.documentElement.scrollHeight > innerHeight };
  });
  ok(fit.barIn && fit.taH >= 60 && !fit.pageScroll, `T5 한 화면 핏(표시줄 카드 안, 입력칸 높이 ${Math.round(fit.taH)}px, 페이지 스크롤 없음)`);

  ok(errs.length === 0, 'JS 오류 없음 ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `\n${fails}건 실패` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
