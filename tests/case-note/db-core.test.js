// case-note.html 의 <script id="db-core"> (데이터 모양 전담 모듈, docs/adr/0001) 테스트
// 사용: node tests/case-note/db-core.test.js      (브라우저·npm 패키지 불필요, Node 16+)
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'case-note.html'), 'utf8');
const m = html.match(/<script id="db-core">([\s\S]*?)<\/script>/);

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const clone = x => JSON.parse(JSON.stringify(x));
// 키 순서는 데이터가 아니므로 정렬 후 비교
const canon = x => Array.isArray(x) ? x.map(canon) : (x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (o[k] = canon(x[k]), o), {}) : x);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const finish = () => { console.log(fails ? `\n${fails}건 실패` : '\n전부 통과'); process.exit(fails ? 1 : 0); };

if (!m) { ok(false, '<script id="db-core"> 블록 존재'); finish(); }
const code = m[1];
const ctx = vm.createContext({ btoa, atob, console });
vm.runInContext(code, ctx);
const D = ctx.DBCore;
const NOW = '2026-11-24 10:00';
const decodeDBin = b64 => vm.runInContext('decodeDB', ctx)(b64);

// ---- 오프라인: 네트워크 접근 코드 없음
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//.test(code), '오프라인: db-core 에 네트워크 접근 코드 없음');

// ---- S1: 기본 정규화 — 빠진 것만 채우고, 모르는 속성은 보존, 멱등
{
  const raw = {
    version: 4, savedAt: '2026-11-01 09:00', futureTopLevel: { keep: true },
    template: { checklist: ['기록 검토'], forms: [], customFields: [], myTplExtra: 1 },
    cases: [{ id: 'c1', caseNumber: '2026-1', status: '수사중', title: '사기', futureField: '보존',
              checklist: [{ text: '고소인 조사', done: false, myItemExtra: 'x' }] }]
  };
  const db = D.normalizeDB(clone(raw), { now: NOW });
  const c = db.cases[0];
  ok(db.version === 4 && db.savedAt === '2026-11-01 09:00', 'S1 version/savedAt 유지');
  ok(Array.isArray(db.ddayTrackers), 'S1 ddayTrackers 기본값');
  ok(db.futureTopLevel && db.futureTopLevel.keep === true, 'S1 모르는 최상위 속성 보존');
  ok(db.template.myTplExtra === 1 && c.futureField === '보존' && c.checklist[0].myItemExtra === 'x', 'S1 모르는 템플릿/사건/항목 속성 보존');
  ok(c.charge === '' && c.crimeFact === '' && c.reference === '' && c.overview === '' && c.remarks === '', 'S1 사건 문자열 필드 기본값');
  ok(Array.isArray(c.schedules) && Array.isArray(c.forms) && Array.isArray(c.autoLoadedFormIds) && typeof c.customValues === 'object', 'S1 사건 배열/객체 기본값');
  ok(!!c.checklist[0].id && c.checklist[0].text === '고소인 조사', 'S1 체크리스트 id 생성, 내용 유지');
  ok(c.people.filter(p => p.role === 'case').length === 1, 'S1 사건공통 관계인 1명 보장');
  ok(db.template.statusOptions.length === 7 && db.template.statusOptions.find(o => o.value === '종결').closedTab === true, 'S1 상태 설정 기본 7종');
  ok(Array.isArray(db.template.chargeFactExamples) && Array.isArray(db.template.globalForms) && db.template.globalForms.length > 0, 'S1 예문함 [] / 공통서식 기본값');
  ok(['case', 'complainant', 'accused', 'witness'].every(r => Array.isArray(db.template.personRoleFields[r])), 'S1 관계인 역할 필드 4종');
  const again = D.normalizeDB(clone(db), { now: '2030-01-01 00:00' });
  ok(same(again, db), 'S1 멱등: 두 번 정규화 = 한 번');
  ok(same(raw.cases[0].checklist[0], { text: '고소인 조사', done: false, myItemExtra: 'x' }), 'S1 입력 객체를 변경하지 않음');
}

// ---- S2: 구버전 마이그레이션(평면 변수 → 사건관계인) + 저장 전 검증 인코딩
{
  const raw = { version: 4, template: { variables: [{ id: 'v1', name: '피해금액', defaultValue: '' }] },
    cases: [{ id: 'c1', variableValues: { v1: '300만원' }, extraVariables: [{ id: 'x1', name: '계좌', value: '국민 123' }] }] };
  const db = D.normalizeDB(raw, { now: NOW });
  const cp = db.cases[0].people.find(p => p.role === 'case');
  ok(db.template.personRoleFields.case.some(f => f.id === 'v1') && !('variables' in db.template), 'S2 template.variables → 사건공통 역할 필드');
  ok(cp.fieldValues.v1 === '300만원' && cp.extraFields.some(f => f.id === 'x1') && !('variableValues' in db.cases[0]), 'S2 사건 평면 변수 → 사건공통 관계인');
  const kdb = D.normalizeDB({ version: 4, template: {}, cases: [{ id: 'k', crimeFact: '피의자는 ○○○에게 “돈”을 — 😀 편취하였다.\n줄바꿈' }] }, { now: NOW });
  const b64 = D.encodeVerified(kdb);
  ok(same(decodeDBin(b64), kdb), 'S2 한글·특수문자·이모지 인코딩 왕복 일치');
  ok(same(decodeDBin(D.encodeVerified({ v: '짝 없는 서로게이트 \uD800' })), { v: '짝 없는 서로게이트 \uD800' }), 'S2 깨진 유니코드도 손실 없이 왕복');
  // 인코더가 데이터를 망가뜨리는 상황을 흉내 → 검증이 막아야 함
  const realEncode = ctx.encodeDB;
  ctx.encodeDB = obj => realEncode(JSON.parse(JSON.stringify(obj).replace('편취', '????')));
  let threw = false; try { D.encodeVerified(kdb); } catch (e) { threw = true; }
  ctx.encodeDB = realEncode;
  ok(threw, 'S2 인코딩 결과가 원본과 다르면 예외 → 파일 쓰지 않음');
}

// ---- S3: 공유 JSON 덮어쓰기 — 파일에 있는 섹션만 교체, 없는 섹션은 현재 것 유지 (유실 버그 재현)
{
  const cur = D.normalizeDB({ version: 4, template: {
      statusOptions: [{ id: 's1', value: '내사중', group: 'active' }, { id: 's2', value: '종결', group: 'done' }],
      chargeFactExamples: [{ id: 'e1', charge: '사기', title: '중고거래', content: '피의자는 OO' }],
      personRoleFields: { case: [{ id: 'f1', name: '일시' }], complainant: [], accused: [], witness: [] },
      checklist: ['기록 검토'], forms: [{ id: 'fm1', title: '수사보고', content: '...' }] },
    cases: [{ id: 'c1', status: '내사중' }] }, { now: NOW });
  // (a) 오래된 파일: checklist 만 있음 → 나머지 섹션은 현재 것 유지
  const oldFile = { version: 1, template: { checklist: ['새 항목'] }, cases: [{ id: 'n1', status: '진행중' }] };
  const r1 = D.applyShareJson(cur, clone(oldFile), 'replace', { now: NOW }).db;
  ok(same(r1.template.statusOptions, cur.template.statusOptions), 'S3a 파일에 없는 상태 설정 유지');
  ok(same(r1.template.chargeFactExamples, cur.template.chargeFactExamples), 'S3a 파일에 없는 범죄사실 예문 유지');
  ok(same(r1.template.personRoleFields, cur.template.personRoleFields), 'S3a 파일에 없는 관계인 역할 필드 유지');
  ok(same(r1.template.forms, cur.template.forms), 'S3a 파일에 없는 기본 서식 유지');
  ok(same(r1.template.checklist, ['새 항목']), 'S3a 파일에 있는 섹션은 교체');
  ok(r1.cases.length === 1 && r1.cases[0].id === 'n1' && r1.cases[0].status === '수사중', 'S3a 사건 교체 + 구버전 상태 별칭(진행중→수사중)');
  // (b) 왕복: 내보내기 → 덮어쓰기 가져오기 = 동일
  const share = D.toShareJson(cur, { scope: 'all', caseIds: ['c1'], exportedAt: NOW });
  ok(share.version === 1 && share.exportedAt === NOW, 'S3b 공유 JSON version 1');
  const blank = D.normalizeDB({ version: 4, template: {}, cases: [] }, { now: NOW });
  const r2 = D.applyShareJson(blank, JSON.parse(JSON.stringify(share)), 'replace', { now: NOW }).db;
  ok(same(r2.cases, cur.cases), 'S3b 왕복: 사건 동일');
  ok(same(r2.template, cur.template), 'S3b 왕복: 템플릿 동일(상태 설정·예문·관계인 포함)');
  // (c) 사용자 정의 상태가 별칭과 이름이 같으면 바꾸지 않음
  const cur2 = D.normalizeDB({ version: 4, template: { statusOptions: [{ id: 'a', value: '진행중' }] }, cases: [] }, { now: NOW });
  const r3 = D.applyShareJson(cur2, { version: 1, cases: [{ id: 'z', status: '진행중' }] }, 'replace', { now: NOW }).db;
  ok(r3.cases[0].status === '진행중', 'S3c 설정에 있는 상태 이름은 별칭 변환 안 함');
}

// ---- S4: 공유 JSON 병합 — 추가만, 기존 항목은 그대로
{
  const cur = D.normalizeDB({ version: 4, template: {
      statusOptions: [{ id: 's1', value: '수사중', emoji: '🔵' }],
      chargeFactExamples: [{ id: 'e1', charge: '사기', title: '중고거래', content: '본문A' }] },
    cases: [{ id: 'c1', title: '기존', status: '수사중' }] }, { now: NOW });
  const file = { version: 1, template: {
      statusOptions: [{ id: 'x1', value: '수사중', emoji: '🟥' }, { id: 'x2', value: '내사중' }],
      chargeFactExamples: [{ id: 'other', charge: '사기', title: '중고거래', content: '본문A' }, { id: 'e2', charge: '횡령', title: '업무상', content: '본문B' }] },
    cases: [{ id: 'c1', title: '파일쪽 같은 id' }, { id: 'c2', title: '새 사건', status: '진행중' }] };
  const { db, summary } = D.applyShareJson(cur, clone(file), 'merge', { now: NOW });
  const st = db.template.statusOptions;
  ok(st.length === 2 && st[0].emoji === '🔵' && st.some(o => o.value === '내사중'), 'S4 상태: 같은 이름은 기존 유지, 새 이름만 추가');
  const ex = db.template.chargeFactExamples;
  ok(ex.length === 2 && ex.some(e => e.id === 'e2'), 'S4 예문: 같은 죄명+제목+본문은 건너뛰고 새 예문만 추가');
  ok(db.cases.length === 2 && db.cases.find(c => c.id === 'c1').title === '기존', 'S4 사건: 같은 id 는 건너뜀(기존 유지)');
  ok(db.cases.find(c => c.id === 'c2').status === '수사중', 'S4 새 사건 상태 별칭 적용');
  ok(summary.addedCases === 1 && summary.skippedCases === 1 && summary.addedTpl === 2, `S4 결과 요약 ${JSON.stringify(summary)}`);
  ok(cur.template.statusOptions.length === 1 && cur.cases.length === 1, 'S4 현재 DB 객체는 변경하지 않음');
  let threw = false; try { D.applyShareJson(cur, { hello: 1 }, 'merge'); } catch (e) { threw = true; }
  ok(threw, 'S4 사건/템플릿 없는 파일은 거부');
}

// ---- S5: 새 사건 만들기(makeCase) — 새 사건 버튼·외부 목록 가져오기가 같은 규칙 사용
{
  const tpl = D.normalizeDB({ version: 4, template: { statusOptions: [{ value: '내사중' }, { value: '종결' }],
    checklist: ['기록 검토', '고소인 조사'], forms: [{ id: 'f1', title: '수사보고', content: '본문' }] }, cases: [] }, { now: NOW }).template;
  const c = D.makeCase(tpl, { now: NOW });
  ok(c.status === '내사중', 'S5 상태 = 설정의 첫 번째 상태');
  ok(c.createdAt === '2026-11-24' && c.updatedAt === NOW && /^\d{4}-\d{6}$/.test(c.caseNumber), 'S5 날짜·임시 사건번호');
  ok(c.checklist.map(x => x.text).join() === '기록 검토,고소인 조사' && c.checklist.every(x => x.id && x.done === false), 'S5 템플릿 체크리스트 복사');
  ok(c.forms.length === 1 && c.forms[0] !== tpl.forms[0] && c.forms[0].content === '본문', 'S5 템플릿 서식은 복제(공유 안 함)');
  ok(c.people.some(p => p.role === 'case') && Array.isArray(c.schedules), 'S5 정식 사건 모양');
  ok(same(D.normalizeCase(clone(c), tpl, 'x'), c), 'S5 makeCase 결과는 이미 정규화됨');
  const e = D.makeCase(tpl, { now: NOW, fields: { caseNumber: '2026-777', title: '외부', charge: '사기' } });
  ok(e.caseNumber === '2026-777' && e.title === '외부' && e.charge === '사기' && e.status === '내사중', 'S5 지정 값 우선(외부 가져오기용)');
}

finish();
