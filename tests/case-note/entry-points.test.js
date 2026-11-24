// 진입점 → db-core 연결 테스트 (docs/case-note.md 14절, ADR-0001)
// 사용: PLAYWRIGHT_DIR=~/.cache/toi-test LANG=C.UTF-8 node tests/case-note/entry-points.test.js
// 내장 DB 를 바꾼 사본을 임시 폴더에 만들어 연다(원본 case-note.html 은 건드리지 않음).
const fs = require('fs');
const os = require('os');
const path = require('path');
const pwDir = process.env.PLAYWRIGHT_DIR;
const { chromium } = require(pwDir ? path.join(pwDir, 'node_modules', 'playwright') : 'playwright');
const SRC = path.resolve(__dirname, '..', '..', 'case-note.html');
const HTML = fs.readFileSync(SRC, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'case-note-ep-'));
const enc = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
function withEmbedded(name, b64) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, HTML.replace(/(<script id="embedded-db-b64" type="text\/plain">)[\s\S]*?(<\/script>)/, (_, a, b) => a + b64 + b));
  return 'file://' + f;
}

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// 구버전 모양 DB: statusOptions·chargeFactExamples·personRoleFields 없음, 사건은 평면 변수(variableValues)
const LEGACY = {
  version: 4, savedAt: '2026-01-01 10:00:00', myKey: '보존',
  template: { checklist: ['기록 검토'], forms: [], customFields: [] },
  cases: [{ id: 'c1', caseNumber: '2026-000001', title: '구버전 사건', status: '수사중', variableValues: { 일시: '2026-01-01' } }],
  ddayTrackers: [{ title: '공소시효', date: '2027-01-01' }]
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const open = async (url, before) => {
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    if (before) await p.addInitScript(before);
    await p.goto(url); return p;
  };
  const lastToast = p => p.evaluate(() => { const t = document.querySelectorAll('#toastContainer .toast'); return t.length ? t[t.length - 1].textContent.trim() : ''; });

  // ---- L1: 구버전 내장 DB → 정규화되어 열림(모르는 키 보존, D-day 유지, 저장 시 유지)
  {
    const p = await open(withEmbedded('legacy.html', enc(LEGACY)), () => localStorage.clear());
    const r = await p.evaluate(() => {
      const cs = app.cases[0], casePerson = (cs.people || []).find(x => x.role === 'case');
      const saved = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(app.syncEmbeddedBase64Tag().encoded), c => c.charCodeAt(0))));
      return {
        statuses: app.template.statusOptions.length, ex: Array.isArray(app.template.chargeFactExamples),
        roles: !!app.template.personRoleFields, casePersonVal: casePerson && casePerson.fieldValues,
        flat: 'variableValues' in cs, dday: app.ddayTrackers.length, ddayId: !!(app.ddayTrackers[0] || {}).id, myKey: saved.myKey
      };
    });
    ok(r.statuses >= 1 && r.ex && r.roles, 'L1 구버전 템플릿에 상태·예문·관계인 설정 기본값');
    ok(!r.flat && JSON.stringify(r.casePersonVal || {}).includes('2026-01-01'), 'L1 평면 변수 → 사건 관계인으로 이전');
    ok(r.dday === 1 && r.ddayId, 'L1 D-day 유지(+id)');
    ok(r.myKey === '보존', 'L1 모르는 최상위 키가 저장본에 보존');
    ok(p.errs.length === 0, 'L1 JS 오류 없음 ' + p.errs.join(' | '));
    await p.close();
  }

  // ---- L2: 손상된 내장 DB → 읽기 전용(샘플 아님), 저장 중지, 백업 복구 제안 → 복구 시 정규화 + 저장 재개
  {
    const backup = Object.assign({}, LEGACY, { cases: [{ id: 'b1', title: '백업 사건', variableValues: { 일시: '2026-02-02' } }] });
    const p = await open(withEmbedded('corrupt.html', '!!!손상된데이터!!!'), `
      localStorage.clear();
      localStorage.setItem('CASE_NOTE_SINGLE_FILE_B64_V4', ${JSON.stringify(enc(backup))});
      localStorage.setItem('CASE_NOTE_SINGLE_FILE_META_V4', JSON.stringify({ savedAt: '2020-01-01 00:00:00', unsaved: false }));`);
    const r = await p.evaluate(() => ({
      ro: app.readOnly === true, cases: app.cases.length,
      errShown: document.getElementById('dbErrorBanner').classList.contains('show'),
      recShown: document.getElementById('recoveryBanner').classList.contains('show'),
      tag: document.getElementById('embedded-db-b64').textContent
    }));
    ok(r.ro && r.cases === 0, `L2 손상 DB → 읽기 전용, 샘플 안 띄움 (사건 ${r.cases}건)`);
    ok(r.errShown, 'L2 오류 배너 표시');
    ok(r.recShown, 'L2 (저장된 것으로 표시된) 백업이라도 복구 제안');
    // 저장 시도: 내장 태그·임시저장·파일 모두 그대로
    const r2 = await p.evaluate(() => {
      app.cases.push({ id: 'x', title: '편집' }); app.onStateChanged();
      let threw = false; try { app.buildCleanHtmlDocumentString(); } catch (e) { threw = true; }
      return { tag: document.getElementById('embedded-db-b64').textContent, ls: localStorage.getItem('CASE_NOTE_SINGLE_FILE_META_V4'), threw };
    });
    ok(r2.tag === r.tag, 'L2 읽기 전용 중 내장 DB 안 바뀜');
    ok(r2.ls.includes('2020-01-01'), 'L2 읽기 전용 중 임시저장(백업) 안 덮어씀');
    ok(r2.threw, 'L2 읽기 전용 중 HTML 저장본 생성 거부');
    // 백업 복구
    const r3 = await p.evaluate(() => {
      app.applyRecoveredData();
      const cs = app.cases[0];
      return { ro: app.readOnly, n: app.cases.length, people: Array.isArray(cs.people), flat: 'variableValues' in cs,
        dday: app.ddayTrackers.length, errShown: document.getElementById('dbErrorBanner').classList.contains('show'),
        tagChanged: document.getElementById('embedded-db-b64').textContent.length > 100 };
    });
    ok(!r3.ro && r3.n === 1 && r3.people && !r3.flat, 'L2 복구 → 정규화된 백업 사건, 읽기 전용 해제');
    ok(r3.dday === 1, 'L2 복구 시 D-day 도 복원');
    ok(!r3.errShown && r3.tagChanged, 'L2 복구 후 오류 배너 숨김 + 저장 재개');
    ok(p.errs.length === 0, 'L2 JS 오류 없음 ' + p.errs.join(' | '));
    await p.close();
  }

  // ---- L3: 내장 DB 가 비어 있을 때만 샘플
  {
    const p = await open(withEmbedded('empty.html', ''), () => localStorage.clear());
    const r = await p.evaluate(() => ({ ro: !!app.readOnly, n: app.cases.length, people: app.cases.every(c => Array.isArray(c.people)) }));
    ok(!r.ro && r.n > 0 && r.people, 'L3 빈 내장 DB → 샘플(정규화됨)');
    await p.close();
  }

  // ---- S1: 저장 검증 실패 → 내장 태그·임시저장 안 바뀜 + 오류 안내
  {
    const p = await open(withEmbedded('legacy2.html', enc(LEGACY)), () => localStorage.clear());
    const r = await p.evaluate(() => {
      app.onStateChanged();
      const before = document.getElementById('embedded-db-b64').textContent, lsBefore = localStorage.getItem('CASE_NOTE_SINGLE_FILE_B64_V4');
      const orig = window.encodeDB; window.encodeDB = o => orig(Object.assign({}, o, { cases: [] })); // 고장 난 인코더 흉내
      app.cases[0].title = '바뀐 제목'; app.onStateChanged();
      let threw = false; try { app.buildCleanHtmlDocumentString(); } catch (e) { threw = true; }
      window.encodeDB = orig;
      return { same: document.getElementById('embedded-db-b64').textContent === before, lsSame: localStorage.getItem('CASE_NOTE_SINGLE_FILE_B64_V4') === lsBefore, threw };
    });
    ok(r.same && r.lsSame, 'S1 검증 실패 시 내장 DB·임시저장 그대로');
    ok(r.threw, 'S1 검증 실패 시 HTML 저장본 생성 거부');
    ok(/저장/.test(await lastToast(p)), 'S1 오류 안내 토스트 — "' + await lastToast(p) + '"');
    await p.close();
  }

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails}건 실패` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
