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

  // ---- J: 공유 JSON(v1) 가져오기/내보내기 — 실제 파일 입력·다운로드 경로로
  const importFile = async (p, name, obj, mode) => {
    const f = path.join(TMP, name); fs.writeFileSync(f, '﻿' + JSON.stringify(obj), 'utf8');
    await p.evaluate(m => { app.openBackupModal(); document.querySelector(`input[name="importMode"][value="${m}"]`).checked = true; }, mode);
    await p.setInputFiles('input[type="file"][onchange*="importPureJson"]', f);
    await p.waitForTimeout(150);
    if (mode === 'replace') { await p.click('#confirmModalOkBtn'); await p.waitForTimeout(50); }
  };
  const exportFile = async (p, scope) => {
    await p.evaluate(() => app.openBackupModal());
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(s => app.exportPureJson(s), scope)]);
    return JSON.parse(fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, ''));
  };
  {
    // J1: 덮어쓰기 — 파일에 없는 섹션(상태 설정·예문·관계인 필드)은 현재 것 유지 (유실 버그 재현)
    const p = await open(withEmbedded('j1.html', enc(LEGACY)), () => localStorage.clear());
    await p.evaluate(() => {
      app.template.statusOptions.push({ id: 'st_my', value: '내상태', label: '내상태' });
      app.template.chargeFactExamples.push({ id: 'ex_my', charge: '사기', title: '내 예문', content: '피의자는 OO' });
      app.onStateChanged();
    });
    await importFile(p, 'j1.json', { version: 1, template: { checklist: ['새 할일'] }, cases: [{ id: 'n1', title: '새 사건', status: '진행중' }] }, 'replace');
    const r = await p.evaluate(() => ({
      st: app.template.statusOptions.some(o => o.value === '내상태'), ex: app.template.chargeFactExamples.some(e => e.id === 'ex_my'),
      chk: app.template.checklist.join('|'), n: app.cases.length, status: app.cases[0].status, people: Array.isArray(app.cases[0].people),
      dday: app.ddayTrackers.length
    }));
    ok(r.st && r.ex, 'J1 덮어쓰기: 파일에 없는 상태 설정·예문 유지');
    ok(r.chk === '새 할일' && r.n === 1 && r.people, 'J1 덮어쓰기: 파일에 있는 섹션·사건은 교체(정규화됨)');
    ok(r.status === '수사중', `J1 구버전 상태 별칭 적용 (${r.status})`);
    ok(r.dday === 1, 'J1 덮어쓰기: D-day 유지');

    // J2: 병합 — 추가만, 요약 토스트
    await importFile(p, 'j2.json', { version: 1, template: { statusOptions: [{ value: '내상태', label: '바뀐라벨' }, { value: '새상태' }] },
      cases: [{ id: 'n1', title: '중복' }, { id: 'n2', title: '추가' }] }, 'merge');
    const r2 = await p.evaluate(() => ({ n: app.cases.length, mine: app.template.statusOptions.find(o => o.value === '내상태').label,
      added: app.template.statusOptions.some(o => o.value === '새상태') }));
    const t2 = await lastToast(p);
    ok(r2.n === 2 && r2.mine === '내상태' && r2.added, 'J2 병합: 같은 id 사건·같은 이름 상태는 건드리지 않고 새 것만 추가');
    ok(/\+1건/.test(t2) && /중복 1건/.test(t2), 'J2 병합 요약 — "' + t2 + '"');

    // J3: 내보내기 → 새 파일에 덮어쓰기 → 같은 사건·템플릿
    const out = await exportFile(p, 'all');
    ok(out.version === 1 && out.cases.length === 2 && out.template.chargeFactExamples.some(e => e.id === 'ex_my'), 'J3 내보내기 v1 형식(사건·예문 포함)');
    const tpl = await exportFile(p, 'template');
    ok(tpl.cases.length === 0 && tpl.template.statusOptions.length > 0, 'J3 템플릿만 내보내기');
    const before = await p.evaluate(() => JSON.stringify({ t: app.template, c: app.cases }));
    const q = await open(withEmbedded('j3.html', enc({ version: 4, cases: [] })), () => localStorage.clear());
    await importFile(q, 'j3.json', out, 'replace');
    const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);
    const after = await q.evaluate(() => JSON.stringify({ t: app.template, c: app.cases }));
    ok(canon(JSON.parse(before)) === canon(JSON.parse(after)), 'J3 내보내기→덮어쓰기 왕복 동일');
    ok(p.errs.length === 0 && q.errs.length === 0, 'J JS 오류 없음 ' + p.errs.concat(q.errs).join(' | '));
    await p.close(); await q.close();
  }
  {
    // J4: 읽기 전용(손상 DB)에서 공유 JSON 덮어쓰기 = 복원 → 읽기 전용 해제, 저장 재개
    const p = await open(withEmbedded('j4.html', '!!!손상!!!'), () => localStorage.clear());
    await importFile(p, 'j4.json', { version: 1, template: {}, cases: [{ id: 'r1', title: '복원' }] }, 'replace');
    const r = await p.evaluate(() => ({ ro: app.readOnly, n: app.cases.length, err: document.getElementById('dbErrorBanner').classList.contains('show'),
      tag: document.getElementById('embedded-db-b64').textContent.length > 100 }));
    ok(!r.ro && r.n === 1 && !r.err && r.tag, 'J4 읽기 전용 중 JSON 덮어쓰기 → 복원·저장 재개');
    await p.close();
  }

  // ---- N: 새 사건(새 사건 버튼·외부 목록 가져오기) → DBCore.makeCase
  {
    const p = await open(withEmbedded('n1.html', enc(LEGACY)), () => localStorage.clear());
    const r = await p.evaluate(() => {
      app.template.statusOptions.unshift({ id: 'st_first', value: '내사중', label: '내사중' });
      app.createNewCase();
      const c = app.cases[0];
      return { status: c.status, people: c.people.filter(x => x.role === 'case').length, chk: c.checklist.map(x => x.text).join('|'),
        sched: Array.isArray(c.schedules), auto: Array.isArray(c.autoLoadedFormIds), open: app.currentCaseId === c.id };
    });
    ok(r.status === '내사중' && r.people === 1 && r.chk === '기록 검토' && r.sched && r.auto && r.open, 'N1 새 사건 = 정식 모양(첫 상태·사건 관계인·체크리스트)');
    const r2 = await p.evaluate(() => {
      app.externalImport = Object.assign(app.externalImport || {}, {
        rows: [{ no: '2026-100', nm: '외부 사건', st: '송치', memo: '메모1' }, { no: '2026-000001', nm: '중복' }, { no: '', nm: '빈 번호' }],
        mapping: { no: 'caseNumber', nm: 'title', st: 'status', memo: 'reference' }
      });
      const n0 = app.cases.length;
      app.importExternalCases();
      const c = app.cases.find(x => x.caseNumber === '2026-100');
      return { added: app.cases.length - n0, title: c && c.title, status: c && c.status, ref: c && c.reference,
        people: c && c.people.filter(x => x.role === 'case').length, forms: c && c.forms.length, sched: c && Array.isArray(c.schedules) };
    });
    ok(r2.added === 1 && r2.title === '외부 사건' && r2.ref === 'memo: 메모1', 'N2 외부 목록: 중복·빈 사건번호 건너뛰고 1건 추가, 매핑 값 반영');
    ok(r2.status === '송치결정' && r2.people === 1 && r2.forms === 0 && r2.sched, `N2 외부 사건 = 정식 모양(별칭 상태 ${r2.status}, 서식 없음 유지)`);
    ok(p.errs.length === 0, 'N JS 오류 없음 ' + p.errs.join(' | '));
    await p.close();
  }

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `\n${fails}건 실패` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
