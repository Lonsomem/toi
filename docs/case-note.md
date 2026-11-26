# 사건 관리 노트 (`case-note.html`) 개발 메모

경찰 수사관용 사건 관리 단일 HTML. 서버 없이 **파일 자기 자신을 덮어써서** 데이터를 보관한다(Quine 구조).
코드 위치는 함수명으로 찾을 것(`grep -n "함수명(" case-note.html`). 줄 번호는 자주 바뀐다.

## 1. 아키텍처 (훼손 금지)
- 외부 의존 0: CSS/HTML/Vanilla JS/SVG 아이콘 전부 한 파일.
- **내장 DB**: 하단 `<script id="embedded-db-b64" type="text/plain">` 안에 `encodeDB({version:4, savedAt, template, cases, ddayTrackers})` 결과(UTF-8 안전 Base64: `btoa(unescape(encodeURIComponent(JSON)))`). `decodeDB` 는 역변환. (`activityLog`/`dashboardPrefs` 는 2026-11-24 디자인 롤백으로 제거됨 — 9절 참고)
- **자기 덮어쓰기**: File System Access API. `connectSelfHtmlFile()` → 핸들 저장, `writeSelfHtmlToFileHandle()` 가 `buildCleanHtmlDocumentString()` 결과를 디스크에 기록. `onStateChanged()` 에서 0.5초 디바운스 + Ctrl+S(`saveOrConnectHtmlFile`).
- **buildCleanHtmlDocumentString()**: DOM 을 `cloneNode(true)` → `dynamicContainerIds` 컨테이너 innerHTML 비움 + 입력값 초기화 + `#priorityTodoList` 비움 → `#embedded-db-b64` 만 갱신. (동적으로 그리는 영역을 새로 만들면 id 를 이 배열에 꼭 추가 — 안 하면 렌더된 HTML 이 파일에 박혀 오염.)
  현재 목록: `case-list-body, paginationBar, detailChecklistContainer, boilerplateTabs, heroPipelineStepper, tplChecklistList, tplFormsList, toastContainer, globalFormsListContainer, priorityTodoCount, todoTabNextCount, todoTabTodayCount, todoPanelSub, todoTabAllCount, exportCaseListContainer, tplRoleFieldsTabBar, tplRoleFieldsList, peopleSummaryContainer, peopleListContainer, personEditorContainer, eiKeyMapContainer, detailStatus, tplStatusOptionsList, statusFilter, caseCalendarContainer, dashboardCalendarContainer, ddayWidgetContainer, caseScopeTabs`
  (`customFieldsTabBar`/`customFieldsContainer`/`tplCustomFieldsList`는 10절에서 기능 자체가 제거되며 목록에서도 빠짐)
- **브라우저 임시 백업**: `localStorage` 키 `CASE_NOTE_SINGLE_FILE_B64_V4`(데이터) / `CASE_NOTE_SINGLE_FILE_META_V4`(`{savedAt, unsaved}`). 파일 미연결 상태에서 변경 시 저장되고, 내장본보다 새로우면 `#recoveryBanner` 로 복구 제안(`applyRecoveredData`/`dismissRecoveryBanner`).
- **onStateChanged()** 가 한 번에: Base64 태그 갱신 + localStorage 백업 + 용량 표시 + 파일 자동 덮어쓰기 예약. 데이터를 바꾸면 항상 마지막에 호출.
- **loadDatabase()**: 내장 DB 디코딩 → 하위호환 방어 코드(없으면 기본값). 새 속성 추가 시 여기에 `if (!x) x = 기본값` 추가. 현재 보정 항목: `template.globalForms`, `case.charge`, `case.crimeFact`(문자열), `case.checklist[].id`(없으면 생성).
- 화면: `100vh`, `overflow:hidden`. 전체 페이지 스크롤 없음(목록은 내부 영역만 스크롤).

## 2. 데이터 스키마
```
template = {
  statusOptions: [{id,value,emoji,badgeClass,group}], // 사건 상태 설정(9절), group: active|done|hold
  checklist: [string],                       // 신규 사건 기본 체크리스트
  forms: [{id,title,content}],               // 신규 사건 기본 개별 서식
  customFields: [{id,label,placeholder}],    // 모든 사건 공통 입력 항목
  globalForms: [{id,category,title,content}], // 📚 공통 서식 보관함(사건 무관)
  importRoleMap: { [구분값]: 'complainant'|'accused'|'witness'|'skip' } // 외부 목록 관계인 구분값 대응표(8절 6), 기본 {}
}
case = {
  id, caseNumber, status, title,
  charge, crimeFact,                         // 죄명 / 범죄사실
  overview, reference, remarks,              // 사건개요(UI 제거됨, 데이터만 보존) / 참고사항 / 비고(UI 제거됨, 데이터만 보존)
  schedules: [{id,date,title,memo}],         // 사건 일정(캘린더, 9절). date='YYYY-MM-DD'
  createdAt, updatedAt,                      // 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm'
  checklist: [{id,text,done,date,            // date='MM/DD' 완료일 자동 기록
               todayDate,todayOrder}],       // 오늘 할 일 지정(선택): 'YYYY-MM-DD', 정렬순서
  forms: [{id,title,content}],               // 사건별 서식 (템플릿에서 복제)
  customValues: { [customField.id]: string },
  priorityOrder?: number                     // 전광판(다음 할 일) 드래그 순서
}
ddayTrackers = [{id,title,date}]             // 최상위 DB 필드. 메인 화면 D-day 위젯(9절)
```
- status 값은 기본 7개(수사중/영장신청/불송치(불입건)결정/송치결정/이송판단/수사중지(관리미제)/종결, 10절)지만 템플릿 설정 "0. 사건 상태 설정"에서 자유롭게 추가·이름변경·삭제 가능(9절). "종결" 취급 여부는 문자열이 아니라 `statusOptions[].group === 'done'` 으로 판정(`app.getStatusGroup(status)`) — 이 판정이 "진행중/종결 탭"(10절) 분류 기준도 겸함.
- **`overview`/`remarks` 는 2026-11-24 부로 상세화면 입력 UI 가 제거됨**(캘린더로 대체). 필드 자체는 하위호환을 위해 스키마·`resolveVariables`·외부 가져오기 매핑에 그대로 남아있고, 이미 값이 들어있던 사건은 데이터가 안 사라지지만 더 이상 화면에서 보이거나 편집되지 않는다(데이터는 보존하되 노출만 안 하는 쪽을 택함 — 필요하면 JSON 백업/내보내기로 확인 가능).
- 서식 변수(`resolveVariables`): `{{사건번호}} {{제목}} {{죄명}} {{범죄사실}} {{사건개요}} {{참고사항}} {{비고}}`. 새 변수는 이 함수와 안내 문구(모달 2곳)에 함께 추가.
- 파일 상단 `getDefaultMasterTemplate()`, `getInitialSampleCases()` 가 최초 데이터.

## 3. JSON 공유 형식 (version 1) — 깨면 안 됨
사용자가 기존 환경과 주고받는 형식. **내장 DB(version 4)와 다르다.**
```json
{ "version": 1, "exportedAt": "2026-11-15 23:14",
  "template": { "checklist": [..], "forms": [..], "customFields": [..], "globalForms": [..](선택) },
  "cases": [ { id, caseNumber, status, title, overview, reference, remarks, updatedAt, checklist, forms, customValues,
               charge?, crimeFact?, (체크리스트 항목의 todayDate/todayOrder 선택) } ] }
```
- 내보내기 `exportPureJson(scope)`: `'all'` 전체, `'template'` 서식·템플릿만(`cases: []`, 동료 공유용). BOM(`﻿`) 포함 저장.
- 불러오기 `importPureJson(event)`: 모달의 라디오 `importMode`.
  - **병합(기본)**: 사건은 `id` 같으면 건너뜀. 템플릿은 체크리스트 문구/서식·보관함(id 또는 제목+내용 동일)/커스텀항목(id) 중복 건너뜀.
  - **덮어쓰기**: 확인 모달 후 교체. 파일에 `globalForms` 가 없으면 현재 보관함 유지.
  - `cases` 없는 템플릿 단독 파일도 허용. 누락 필드는 `normalizeImportedCase/Template` 가 기본값으로 채움.
  - 구버전 상태값 별칭: `진행중→수사중`, `종결/이송→타관이송`, `종결→송치완료`, `이송→타관이송` (`normalizeImportedStatus`).

## 4. 화면 구성
### VIEW 1 (목록)
- 상단 KPI 4종(전체/수사중·영장/송치·이송/평균 진행률) — `renderCaseList` 가 계산.
- **좌측 할 일 패널** `.todo-panel` (`renderPriorityTodoBoard`), 상태: `todoTab`(`today`|`next`|`all`), `todoShowDone`, `todoCollapsed`.
  - `★ 오늘`(기본): 사용자가 ☆ 로 지정한 항목만. `getTodayItems()`(오늘 날짜 + `todayOrder` 정렬), 드래그 정렬(`onToday*`). 완료 항목은 취소선으로 하단 유지. 지난 날짜에 지정했지만 미완료인 항목은 상단 `⏰ 못 끝낸 일` 박스(`getOverdueItems`, 개별 `오늘로/✕`, `moveAllOverdueToToday`).
  - `다음 할 일`: 사건당 첫 미완료 1건, `priorityOrder` 드래그(`onPriority*`).
  - `전체 할 일`: 사건별 접이식 그룹, `완료 포함` 토글.
  - ☆ 토글: `toggleTaskToday(caseId, idx)` / `setTaskToday(caseId, idx, flag)` (카드·상세 체크리스트·패널 공통).
  - 창이 다시 보일 때(`visibilitychange`) 날짜 변경 반영 위해 재렌더.
- 우측: 검색(사건번호·제목·죄명·범죄사실·개요·참고·비고·체크리스트·공통항목)/상태 필터/정렬 + 사건 카드 그리드(페이지당 15, 카드 드래그 순서 `onCase*`).
- 카드: 상태색 상단 띠(`status-*-card`), 죄명 칩(`.charge-chip`), 범죄사실 2줄(없으면 개요), 도넛 진행률, 미완료 2개(오늘 지정 우선, `오늘` 배지, ☆), 빠른 할 일 추가.
### VIEW 2 (상세, 3열 벤토)
- 히어로: 목록 버튼, 도넛, 사건번호/**죄명 입력(`#detailCharge`)**/상태/제목, 5단계 파이프라인(`renderHeroGraphicMetrics`).
- 1열: **범죄사실(`#detailCrimeFact`)** / 사건개요 / 참고사항 / 비고(각 📋 복사 `copyFieldText`).
- 2열: 체크보드(`renderDetailChecklist`: 체크 시 완료일 MM/DD, ▲▼ 이동, ☆ 오늘 지정, 기본 템플릿 동기화 `syncTemplateChecklistToCase`).
- 3열: 서식 퀵 런처(`renderDetailForms`, 모달 편집 `openFormEditorModal`) + 📚공통서식함 버튼 + 공통 템플릿 커스텀 항목 탭(`renderDetailCustomFields`).
### 모달
- `#globalFormsModal` 📚 공통 서식 보관함: `openGlobalFormsModal`, 좌측 목록/검색, 우측 편집기. 원문 복사 / 현재 사건 변수 치환 복사(`copyActiveGlobalForm`) / 사건 필드 삽입(`insertGlobalFormToCaseField`: crimeFact·overview·reference) / 현재 사건 서식함에 복제(`cloneGlobalFormToCurrentCase`). 한글(HWP)에서 복사한 문구 붙여넣기용. 기본 템플릿 복원(`resetDefaultTemplate`)·JSON 덮어쓰기 해도 보관함 보존.
- `#templateModal` ⚙ 기본 템플릿 설정(체크리스트/서식/공통항목).
- `#backupModal` 📦 JSON 내보내기·불러오기. `#confirmModal`(alert/confirm 대체).
- `#externalImportModal` 📥 외부 사건목록 가져오기 (2026-11-19 신규, `openExternalImportModal`): 내부 시스템 사건목록 JSON을 선택한 키만 새 사건으로 추가. 상세는 아래 "외부 사건목록 가져오기" 절 참고. 별도 파일(`case-import.html`)로 만들었던 URL fetch/CORS 우회/사건별 상세조회/값 변환 기능은 전부 걷어내고, 가장 단순한 흐름만 이 모달 하나로 통합함(사용자 요청: "그냥 다 집어치우고... 선택한 항목만... 옮겨서 받아오는 기능만").

## 8. 외부 사건목록 가져오기 (`#externalImportModal`)
1. **콘솔 스크립트 복사** (`copyExternalImportScript`): 모달을 열면 `eiConsoleScript` textarea에 고정된 스크립트가 채워짐 — 대상 페이지의 `location.href`를 `fetch`해서 `.json` 파일로 다운로드. 사용자가 그 코드를 내부 시스템 페이지의 개발자도구 콘솔에 직접 붙여넣어 실행(같은 출처라 CORS 제약 없음).
2. **파일 불러오기** (`loadExternalFile` → `handleExternalRawText`): 저장한 `.json`을 선택하면 `FileReader`로 읽음. "데이터 경로"(`eiDataPath`)에 `data.myCaseListVo` 같은 점(.) 경로를 직접 입력하면 `eiGetArrayAtPath`로 그 위치를 바로 사용(배열 인덱스 `[0]`도 지원). 비워두면 `eiFindCaseArray`가 객체 트리를 재귀적으로 훑어 "객체로 이루어진 배열"을 자동으로 찾고(후보 여럿이면 가장 긴 것 선택, 메시지에 다른 후보 경로도 표시), 지정한 경로를 못 찾으면 자동 탐지로 전환하며 경고.
3. **항목 선택·매핑** (`renderExternalKeyMap`/`updateExternalMapping`): 처음 500건에서 발견한 키마다 드롭다운으로 사건 관리 노트 필드(사건번호/접수일자→`createdAt`/제목/죄명/상태/사건개요/참고사항/비고/사용 안 함) 중 하나를 고름.
   - **값 미리보기**: 첫 행 하나가 아니라 500건 중에서 찾은 **서로 다른 실제 값을 최대 3개까지** 모아 보여줌(`keySamples`, 예: "사기 / 절도"). 키 하나가 실제로 뭘 담고 있는지 첫 행만 봐서는 모를 수 있어서 추가함.
   - **null뿐인 키는 기본적으로 숨김**(`keyHasData`로 판별): 500건 전부에서 값이 `null`/`undefined`뿐이면 매핑 목록에서 숨기고 "N개는 숨겼습니다"로 안내, **[모두 보기]**(`toggleExternalEmptyKeys`)로 다시 볼 수 있음.
   - 피의자·피해자·접수단서처럼 사건 관리 노트에 전용 필드가 없는 항목은 "참고사항"으로 보내도록 안내(옵션 라벨에 명시). **사건번호는 반드시 하나 지정**해야 하며(`importExternalCases`가 검사), 상태값은 `normalizeImportedStatus`로 정규화.
4. **가져오기** (`importExternalCases`): 매핑 안 된 키·빈 값은 무시. 사건번호가 비어있거나 **이미 같은 사건번호의 사건이 있으면 건너뜀**(추가/건너뜀 건수 안내). **여러 키를 같은 자유 텍스트 항목(사건개요/참고사항/비고)에 매핑하면 덮어쓰지 않고 `"키이름: 값"` 줄로 이어붙임**(예: 피의자·피해자·접수단서를 모두 참고사항으로 보내면 세 줄이 전부 들어감). 새 사건은 `createNewCase`와 동일한 최소 스키마로 생성(기본 템플릿 체크리스트 적용, `ensureCasePeople`로 사건공통 관계인 자동 생성, forms/people 빈 배열 등은 사용자가 상세화면에서 직접 채움) 후 `this.cases.unshift` + `onStateChanged()`.
5. **사건번호 자동 변환** (2026-11-26, `DBCore.formatExternalCaseNumber`): 사건번호로 매핑한 값이 10자리 숫자(연도4+번호6)면 `YYYY-NNNNN` 으로 바꿔서 저장·중복검사. 예) `2026011111`→`2026-11111`, `2027001111`→`2027-01111`. 번호 6자리 첫 자리가 0이 아니면 정보 손실을 막으려고 자르지 않음(`2026123456`→`2026-123456`). 다른 형식은 그대로. 이유: 내부 시스템 `rno` 는 10자리, 노트에서 쓰는 사건번호는 `YYYY-NNNNN` 형식(사용자 요청).
6. **중첩 JSON·사건관계인·기존 사건 병합** (2026-11-26, 사용자 요청: 파일 = 원본 레코드 배열, `detail.data.objpnInfoVo` 가 사람 목록):
   - **재귀 펼침** (`eiFlattenRow`/`eiScanRows`): 각 건의 중첩 객체를 `detail.data.caseInfoVo.dclrEncn` 같은 경로 키로 펼쳐 매핑 목록에 보여줌. 객체 배열은 "N건 목록" 키가 되고 **👥 사건관계인 목록**으로만 연결 가능(하나만). 객체 배열이 하나뿐이면 자동 연결. 매핑 대상에 **범죄사실**(`crimeFact`) 추가.
   - **사람 키 → 관계인 필드** (`peopleSubMap`): 사람 객체의 각 키를 `구분`(역할 판단용) 또는 관계인 필드 이름(고소인·피고소인·참고인 기본 필드 합집합: 이름/주민번호/연락처/주소/…)에 연결. 키 이름으로 추측(`trprSe`→구분, `kornNm`→이름, `mtelno`→연락처, `enrrn`→주민번호, addr→주소), 사용자가 변경 가능. 필드 이름은 **한글**(사용자 결정) → 서식 변수는 기존과 같은 `{{피고소인1.이름}}` 형식이라 `resolveVariables` 는 바꾸지 않음.
   - **구분값 → 기존 4종 역할 대응표** (사용자 결정: 역할을 새로 만들지 않고 대응): 파일에 나온 구분값마다 고소인/피고소인/참고인/가져오지 않음 선택. 기본값은 `template.importRoleMap`(지난번 선택) → 낱말 추측(`DBCore.guessPersonRole`: '피해' 포함→고소인, '피'로 시작→피고소인, 고소/진정/고발→고소인, 나머지→참고인). 가져올 때 대응표를 템플릿에 저장. 원래 구분값은 관계인의 '구분 메모'(`label`)에, 하위 분류(진정인 등)와 같으면 `subLabel` 에도.
   - **기존 사건 병합** (`DBCore.applyExternalCase`, 사용자 결정: "기존 작성 부분은 건너뛰고 비어있는 부분만"): 같은 사건번호가 있으면 건너뛰지 않고 **빈 문자열 칸만** 채움(상태·접수일 등 이미 값 있는 칸 유지). 관계인: 같은 역할·같은 이름 → 그 사람의 빈 필드만 채움 / 없으면 같은 역할의 완전히 빈 관계인 재사용 / 그래도 없으면 새로 추가(식별자 `역할명+번호` 자동). 한 번 짝지은 기존 관계인은 같은 건에서 다시 안 씀('불상' 여러 명이 하나로 합쳐지지 않게). 역할에 없는 필드(예: 참고인의 주민번호)는 그 사람의 추가 필드로. 새 사건도 같은 함수(`makeCase` 경유).
   - 결과 안내: 새 사건 / 기존 사건 빈 칸 채움 / 변경 없음 / 건너뜀(사건번호 없음) / 추가된 관계인 수.
   - 테스트: `db-core.test.js` S6·S7, `entry-points.test.js` E(실제 파일 입력으로 원본 모양 배열 → 경로 매핑·사건번호 변환·관계인·서식 변수·기존 사건 병합·대응표 저장). **검증 안 됨**: 사용자의 실제 내부 시스템 JSON 전체 키(사용자가 준 예시 구조로만 확인).
- 검증: Playwright로 중첩 경로 자동탐지·수동 지정, 필드 매핑, 상태 정규화, 중복 사건번호 스킵, 템플릿 체크리스트·사건공통 관계인 자동 적용, quine 저장 함수 정상 동작, **null뿐인 키 숨김/모두 보기 토글, 다중 값 샘플 표시, 여러 키의 참고사항 합산(덮어쓰지 않음), 접수일자→createdAt 매핑**까지 확인(22건). **검증 안 됨**: 사용자의 실제 내부 시스템 JSON 스키마.
- 참고: 동일한 URL-fetch/CORS 우회/키 선별/콘솔 스크립트 개념은 독립 파일 `case-import.html`(및 `json-viewer.html`)에도 있음 — 그쪽은 이 모달과 무관하게 더 많은 옵션(URL 직접 fetch, 클립보드 자동 붙여넣기, 사건별 상세조회, 정규식 값 변환)을 가진 범용 도구로 유지됨. 지금 사용자가 원한 건 사건 관리 노트에 바로 통합된 가장 단순한 버전.

## 5. 스타일 메모
- 원래 어두운 남색 → 파스텔 그라데이션(보라→하늘→민트) 톤으로 개편(1차, "UI 개편" 블록) → **(2026-11-19) 겨울 시즌 리디자인**(2차, "겨울 시즌 리디자인" 블록, `<style>` 맨 끝)으로 한 번 더 톤 교체. 둘 다 원본 규칙을 CSS 캐스케이드 순서로 덮어쓰는 방식(선택자 재선언, 일부는 `!important`) — 레이아웃 치수(패딩·폰트크기·그리드)는 건드리지 않고 **색상·그라데이션·그림자·장식만** 교체해 기존에 맞춰둔 "한 화면에 꽉 차는" 핏을 보존함.
- 겨울 테마: 안개 낀 아이스블루~크림 배경 그라데이션, 황혼 느낌 헤더(남색→더스티블루 그라데이션 + 서리 입자 패턴 `::before`), 버튼은 그라데이션 채움 + 호버 시 살짝 떠오르는 효과, 기존 인디고(`#4f46e5` 등) 계열 포인트 색을 더스티블루/플럼 톤으로 교체. `body` 바로 아래 `.winter-snowfall`(`position:fixed; z-index:-1`)에 눈송이 10개를 CSS `@keyframes`로 천천히 흘려보냄 — 클릭 불가(`pointer-events:none`)·레이아웃 비관여, 카드 사이 여백에서만 은은하게 비침.
- `.todo-panel`(350px), `.case-cards-grid`(auto-fill minmax 255px), `.star-btn`, `.today-badge`, `.overdue-box` 등.
- 검증: Playwright로 JS 오류 없음, 기존 원페이지 핏 테스트(700~900px 높이, 태블릿 해상도 3종) 전부 재확인 — 회귀 없음.

## 5-1. 깃허브 스타일 대시보드 리디자인 (2026-11-19)
- 색상 토큰(`:root`)을 겨울 팔레트 위에 한 번 더 덮어씀(`<style>` 맨 끝, "깃허브 스타일 리디자인" 블록) — 플랫한 회백/흰색 배경, 초록 포인트(`#1f883d`), 테두리 위주 카드(그림자 제거), `--radius-*` 6~8px 로 축소해 각진 느낌. `.winter-snowfall` 은 `display:none`, `html,body` 배경 그라데이션도 `var(--bg-body)` 단색으로 재지정(겨울 블록이 `!important` 라 캐스케이드 순서로만 이김).
- **헤더 정리**: 기존에 한 줄로 늘어서 있던 7개 버튼(파일연결·다운로드·공통서식함·템플릿설정·JSON백업·외부가져오기)을 전부 제거하고, 우측 상단 `⋮` 아이콘 하나(`.header-menu-wrap` → `#headerMenuDropdown`)로 모음. 기능은 그대로(각 버튼 onclick 유지), 클릭 시 드롭다운. `app.toggleHeaderMenu()/closeHeaderMenu()`, 바깥 클릭 시 자동 닫힘(`init()`의 전역 `document.click` 리스너 — `.header-menu-wrap`/`.column-menu-wrap` 바깥이면 각각 닫음). 저장 시 `.open` 클래스는 `buildCleanHtmlDocumentString()`에서 제거.
- **사건 목록을 카드 그리드 → 밀도 높은 `<table>`(`.case-table`)로 교체**. 컬럼: 사건번호/제목/죄명/상태/진행률/할일/관계인(기본 숨김)/수정일 + 삭제. 드래그 재정렬(`onCaseDragStart` 등)은 `<tr>` 에 그대로 적용. `itemsPerPage` 를 15→500 으로 올려 사실상 페이지네이션 없이 전체를 한 번에 보여줌(사건이 많아져도 "전체 보기" 화면을 따로 두지 않기로 함).
- **표시 열 선택**: 툴바의 ⚙️ "표시 열" 버튼 → `#columnMenuDropdown` 체크박스. 상태는 `app.dashboardPrefs.visibleColumns` 에 저장되어 DB(퀸 저장본)에 영속화됨. `app.toggleColumnVisible(key, checked)`.
- **정렬/상태 필터 기억**: 상단 `statusFilter`/`sortFilter` 선택값이 바뀔 때 `app.saveDashboardSortPref()` 가 `dashboardPrefs.tableSort/tableStatus` 에 저장하고 `onStateChanged()`. 다음 로드 시 `applyDashboardPrefsToToolbar()`(`init()`에서 호출)가 셀렉트 값을 복원.
- **활동 기여 그래프(깃허브 잔디 스타일)**: `#activityGraphContainer`(`app.renderActivityGraph()`)가 최근 18주(7×18 셀)를 그려줌. 데이터는 `app.activityLog = { 'YYYY-MM-DD': { todoCount, caseIds:[], items:[] } }` — DB 최상위에 저장(공유 JSON v1 과는 무관, 퀸 저장본 전용 필드). `app.recordActivity('todo'|'case', caseId, label)` 을 호출하는 지점: 할 일 완료 처리(목록뷰 `toggleTaskFromListView`, 상세뷰 체크리스트 토글) + 새 사건 생성(`createNewCase`, caseId 당 하루 1회만 집계). 셀에 마우스를 올리면 그날 활동 요약(`title` 속성, 최대 5개) 툴팁. 색상 4단계는 그날 최대값 대비 상대 비율로 계산(`levelOf`).
- `getDefaultDashboardPrefs()` 가 기본값(정렬=드래그순서, 상태필터=전체, 보이는 열) 정의. `loadDatabase()`에 하위호환 방어(`activityLog`/`dashboardPrefs` 없으면 기본값) 추가됨.
- 검증: Playwright로 테이블 렌더/열 숨김/활동 로그 집계/헤더 메뉴 열고닫기/퀸 저장-재로드 라운드트립까지 확인. 기존 `check_people/check_forms/check_casenote_export/check_migration` 전부 재통과(회귀 없음). `check_vars.js` 는 본 작업 이전부터 깨져 있던 스크립트(오래된 API 참조)로 무관.
- **(같은 날, 후속) 상단 수평 툴바 → 좌측 필터 사이드바로 재배치**: 검색창/상태 필터/정렬/표시 열 설정을 `.list-toolbar`(가로 한 줄)에서 `<aside class="filter-sidebar">`(테이블 왼쪽, 190px 고정폭)로 이동. 상태 필터는 `<select>` 대신 건수가 보이는 세로 pill 목록(`#statusFilterPills`, `app.renderStatusFilterPills()`)으로 교체 — 상태값은 더 이상 DOM 에서 읽지 않고 `app.activeStatusFilter` 상태로 직접 관리(`app.setStatusFilter(value)`), `dashboardPrefs.tableStatus` 에 계속 영속화됨. 정렬 셀렉트·표시 열 버튼은 그대로 사이드바 안으로 이동. "+ 새 사건" 버튼도 사이드바 맨 위로 이동.
- **(같은 날, 재후속) 기능 기준 3단 그리드로 전면 재배치**: 사용자 요청 — "애매하게 원래 배치 따라가지 말고 아예 새로 디자인 후 기능/위젯 배치". `#listView` 내부를 `.dash-grid`(`display:flex`, 3열)로 교체:
  - **좌측 레일**(`.rail-left`, 200px) = "현황/필터" 묶음 — 통계 4개를 2×2 컴팩트 숫자 그리드(`.stat-compact-grid`)로 압축 + 상태 pill 목록(`#statusFilterPills`).
  - **중앙**(`.dash-main`, flex:1) = "목록 조작/본문" 묶음 — 검색창·정렬·표시열·새 사건 버튼을 한 줄 툴바(`.table-toolbar`)로, 그 아래 `.case-table`. `#case-list-body`는 `overflow:auto`(가로 포함)로 바뀌어 좁은 화면에서는 테이블이 가로 스크롤됨(열이 잘리지 않고 스크롤로 이동).
  - **우측 레일**(`.rail-right`, 300px, 1400px 이하에서 260px) = "개인 작업 추적" 묶음 — `오늘의 할 일` 패널(`flex:1`로 늘어남) + 그 아래 활동 기여 그래프(셀 10px로 축소해 좁은 레일 폭에 맞춤).
  - 모든 하위 요소의 `id`는 그대로 유지(`statTotalCases` 등)해 JS 렌더 함수는 변경 없음 — 구조(부모 컨테이너)만 재배치.
  - 검증: 1600px/1280px 두 폭에서 스크린샷 확인(좁은 폭에서 테이블 가로 스크롤 정상 동작, 레일 카드가 뷰포트 밖으로 넘치지 않음), 기존 회귀 테스트(관계인/서식/내보내기/마이그레이션/퀸 라운드트립) 전부 재통과.
- **(같은 날, 세 번째 재설계) 사용자 요청 "깃허브 메인페이지랑 그냥 똑같이 해"** → 3단 그리드를 버리고 **깃허브 프로필 페이지 레이아웃**으로 교체:
  - `.github-profile-layout`(flex 2단) = `<aside class="profile-sidebar">`(260px, 아바타+이름+통계+할일+상태필터, 카드 테두리 없이 `border-top` 구분선으로만 섹션 나눔 — 실제 깃허브 프로필 사이드바처럼) + `<main class="profile-main">`(기여 그래프 카드 → "사건" 섹션).
  - "사건" 섹션은 **테이블 → 리포지토리 리스트 아이템 스타일**(`.repo-list`/`.repo-row`)로 교체: 사건번호가 파란 볼드 링크처럼(`.repo-name`, `var(--accent)`), 그 옆에 상태 배지, 아래 제목(설명 줄), 맨 아래 메타 줄(죄명 칩·진행률 점+%·할 일 건수·관계인 수·수정일 — `dashboardPrefs.visibleColumns` 로 토글, `renderColumnMenu()`에서 사건번호/제목은 토글 목록에서 제외해 항상 표시). 삭제 버튼은 행에 마우스를 올려야 나타남(`.repo-row-delete`, 깃허브 리포 목록의 호버 액션처럼).
  - 검색창·정렬·표시 항목·새 사건 버튼은 "사건" 섹션 헤더 우측에 한 줄 툴바로(`.repo-toolbar`), 깃허브의 "Find a repository... / Type / Language / New" 툴바와 같은 자리.
  - `renderCaseList()`의 `<table>` 생성 로직을 전부 `.repo-row` div 생성으로 교체(드래그 재정렬 핸들러는 동일하게 재사용, `<tr>`→`<div>`만 변경이라 로직 변화 없음). `renderColumnMenu()`의 토글 대상에서 `caseNumber`/`title` 제거.
  - 모든 렌더 대상 id 는 그대로 유지(구조 재배치만), 기존 회귀 테스트 전부 재통과.
- **(같은 날, 네 번째 — 반응형 수정) 태블릿/모바일에서 레이아웃이 깨지는 문제**: `.github-profile-layout`(flex row, 사이드바 260px 고정)이 좁은 화면에서 `.profile-main`을 거의 0px로 짜부라뜨림(375px 폭에서 43px까지). 기존 `@media (max-width: 1100px)` 블록(이미 `html,body`/`.main-container`를 `overflow:auto`로 풀어 한 화면 고정을 해제하던 지점)에 편승해 `.github-profile-layout { flex-direction: column; }`로 세로 1단 전환(사이드바 위, 본문 아래, 페이지 전체 스크롤). `@media (max-width: 640px)`를 추가로 둬서 "사건" 섹션 툴바(검색/정렬/표시항목/새사건)를 세로로 쌓고 폭 100%로, 헤더의 파일 동기화 배지는 숨김(⋮ 메뉴로 여전히 접근 가능). 1024/820/428/375px 네 폭에서 가로 스크롤 없음·메뉴 안 잘림·본문 폭 정상 확인, 기존 회귀 테스트 전부 재통과.

## 5-2. 사건 상태(수사중/영장신청/…) 커스터마이즈 (2026-11-19)
- `template.statusOptions: [{id, value, emoji, badgeClass, group}]` 추가 (`getDefaultStatusOptions()` 가 기존 5개값 그대로 기본값: 수사중/영장신청/송치완료/타관이송/중지각하). `badgeClass` 는 기존 5개 CSS 색상 클래스(`status-ing/-warrant/-done/-transfer/-hold`) 중 하나만 재사용(완전 자유 색상은 아님). `group` 은 `active`(현황의 "수사중·영장" 집계) / `done`(현황의 "송치·이송" 집계 + 할 일 패널에서 종결 제외) / `hold`(집계 제외) 중 하나.
- `loadDatabase()` 에 `ensureTemplateStatusOptions()` 하위호환 가드 추가(없으면 기본값, 항목별 누락 필드 보정).
- 하드코딩되어 있던 상태 문자열 비교(`c.status === '수사중' || ...`)를 전부 `this.getStatusGroup(status)`/`this.getStatusBadgeClass(status)` 조회로 교체: 현황 통계(activeCount/doneCount), 할 일 패널의 `isClosed`/`stClass`, 상세화면 `isFinished`, `getStatusBadgeClass()` 자체, `renderStatusFilterPills()`의 상태 목록, `#detailStatus` 셀렉트(`renderDetailStatusOptions()`로 동적 렌더, 과거 값이 목록에 없으면 "(설정에 없음)" 임시 옵션으로 데이터 보존).
- 템플릿 모달에 **"0. 사건 상태 설정"** 섹션 추가(`#tplStatusOptionsList`): 상태별 이모지·이름·색상(5종 중 선택)·분류(진행중/종결/기타) 행 + `[+ 상태 추가]`. `app.addTemplateStatusOption()/updateTemplateStatusOption(id,field,value)/removeTemplateStatusOption(id)`.
  - **이름(`value`) 변경 시 기존 사건들의 `status` 문자열도 함께 변경**(cascade) — 그래야 이미 "수사중"으로 저장된 사건들이 이름을 "검토중"으로 바꿨을 때 끊기지 않고 따라감.
  - **삭제**는 cascade 하지 않음(최소 1개는 항상 남겨야 함, `showToast` 경고) — 이미 그 상태를 쓰던 사건은 `status` 문자열이 그대로 남아 상세화면에서 "(설정에 없음)"으로 표시되고 데이터 자체는 보존.
  - `resetDefaultTemplate()` 은 `getDefaultMasterTemplate()` 전체를 다시 쓰므로 `statusOptions` 도 기본 5개로 복원됨(단, `globalForms` 는 보존하던 기존 동작 그대로).
- `createNewCase()` 의 기본 상태값을 하드코딩 `'수사중'` 대신 `this.getStatusOptions()[0].value` 로 변경(사용자가 목록 맨 앞을 바꾸면 새 사건도 그 값으로 시작).
- `dynamicContainerIds` 에 `detailStatus`(이제 옵션을 JS 로 그리는 select), `tplStatusOptionsList` 추가.
- 검증: 템플릿 모달에서 추가/이름변경(cascade 확인)/색상·분류 변경/최소 1개 제한/상세화면 셀렉트 반영/상태 pill 반영/현황 통계 반영까지 Playwright로 확인, 퀸 저장→재로드 라운드트립으로 `statusOptions` 보존 확인, 기존 회귀 테스트 전부 재통과.

## 9. 디자인 롤백 + 캘린더/D-day/상태설정 (2026-11-24)
사용자 요청: "최근 UI 전면 개편을 되돌리고(데이터 연속성 유지), 사건개요/비고 칸을 없애고 캘린더로 바꾸고, 메인에도 통합 캘린더 + D-day 재미 기능 추가, 기본 정렬은 사건번호순으로."

- **디자인 롤백**: `git show 34acbe7:case-note.html`(깃허브 스타일 대시보드/프로필 레이아웃 개편 **이전**, "겨울 시즌 리디자인" 버전)로 파일을 통째로 되돌림. 그 위에, 레이아웃과 무관하게 독립적인 "사건 상태 설정" 기능(원래 338cdf2 커밋)만 다시 이식 — 단 상태 필터 UI 는 pill 목록이 아니라 원래의 `<select id="statusFilter">` 드롭다운을 유지하고, 옵션만 `template.statusOptions` 기준으로 동적 렌더링(`renderStatusFilterOptions()`)하도록 바꿈. 활동 기여 그래프·좌측 프로필 사이드바·표시열 설정·⋮ 메뉴 통합 등 레이아웃 개편 전용 기능은 전부 제거됨(되돌아감).
- **사건개요/비고 UI 제거**: `#detailOverview`/`#detailRemarks` textarea 와 그 bento-card 2개를 상세화면에서 삭제. 데이터 필드 자체는 스키마에 유지(위 2절 참고). "↪ 사건개요에 삽입"(공통서식함에서 삽입) 버튼도 같이 제거(대상 필드가 더 이상 안 보이므로).
- **사건별 일정(캘린더)**: 삭제한 두 카드 자리에 월간 미니 캘린더 카드(`#caseCalendarContainer`) 추가. `case.schedules`. 날짜 클릭(`selectCaseCalendarDay`) → 그 날짜로 일정 추가 입력창 활성화(`addCaseSchedule`) → 카드 하단에 날짜순 목록(삭제 가능). 일정 있는 날짜는 빨간 점(`.mini-cal-dot`)으로 표시.
- **메인 화면 통합 캘린더**: 좌측 "오늘의 할 일" 패널을 **탭 구조**(`.panel-tabs`: 🎯 할 일 / 📅 캘린더)로 바꿔, 같은 공간 안에서 전환(폭·높이를 바꾸지 않아 기존 "한 화면 핏"에 영향 없음). 캘린더 탭은 전체 사건의 `schedules` 를 모아(`renderDashboardCalendar`) 월간 그리드 + "다가오는 일정"(또는 날짜 선택 시 그 날 일정) 목록을 보여주고, 항목 클릭 시 해당 사건 상세로 이동(`openCaseDetail`).
- **D-day 위젯**: 캘린더 탭 하단에 제목+날짜 직접 입력하는 기준일 카운터 목록(`ddayTrackers`, 최상위 DB 필드). `D-N`/`D+N`/`D-DAY` 자동 계산, 개수 제한 없음, 삭제 가능.
- **기본 정렬 변경**: `<select id="sortFilter">` 의 기본 `selected` 옵션을 `MANUAL_ORDER` → `CASENUM_DESC` 로 변경(정렬 로직 자체는 기존 그대로, 디폴트 선택지만 교체).
- **공유 데이터 생성/수신(QR) 반영**: 새 필드(`schedules`, `ddayTrackers`, `statusOptions`)는 전부 `loadDatabase()`/`createNewCase()`/`getInitialSampleCases()`에 기본값 가드가 있어 구버전 파일을 열어도 깨지지 않음.
- 검증: Playwright로 디자인 롤백 후 기존 회귀 테스트(관계인/서식/내보내기/마이그레이션) 전부 재통과 + 신규(기본 정렬값, overview/remarks UI 제거 확인, 사건별 일정 추가/삭제, 메인 캘린더 렌더+이벤트점, D-day 추가/라벨, 퀸 저장→재로드로 schedules·ddayTrackers 보존) 전부 통과. 기존 "한 화면 핏" 테스트(700~900px 높이, 목록/상세 양쪽) 회귀 없음.

## 10. 공통 템플릿 항목 제거 + 종결 탭 + 서식 이관 판단 + 상태 7종 개편 (2026-11-24)
사용자 요청: "사건별 '공통 템플릿 항목' 제거, 종결 사건은 별도 탭에서만 보이게, 종결 전환 시 서식을 공통서식함으로 옮길지 판단, 기본 상태를 7종으로."

- **'공통 템플릿 항목' 완전 제거**: 상세화면의 탭 전환형 위젯(`#customFieldsTabBar`/`#customFieldsContainer`) 과 템플릿 설정 모달의 "사건별 공통 현출 추가 항목" 섹션을 삭제. `renderDetailCustomFields/selectCustomFieldTab/updateCustomFieldValue/copyActiveCustomField/addTemplateCustomField/updateTemplateCustomField/removeTemplateCustomField` 함수 전부 제거, `activeCustomFieldIndex` 상태 제거, `dynamicContainerIds`에서 관련 id 제거. **데이터는 보존**: `template.customFields`/`case.customValues` 스키마와 공유 JSON v1 내보내기/가져오기(`customFields`)는 그대로 유지 — 과거 공유 파일 호환 때문에 깨면 안 됨(CLAUDE.md 규칙 4). 단지 UI 진입점이 없어졌을 뿐. 빈 공간은 옆 "서식 및 양식"(flex 1.05→1.5)과 "사건관계인"(flex 0.9→1.4) 카드가 채움.
- **진행중/종결 탭**: 목록 화면에 `#caseScopeTabs`(진행중 사건 N / 종결된 사건 N) 추가. `app.caseListScope`('active'|'closed', 기본 active) 상태로 `renderCaseList()`의 필터링에 `matchScope` 조건 추가. 탭 전환 시 상태 드롭다운은 'ALL'로 리셋(교차 필터로 0건 되는 혼란 방지). 상단 통계 라벨 "송치완료·타관이송" → "종결 사건"으로 변경(새 상태 체계에 맞춤). **(11절에서 분류 기준을 `group` 대신 전용 `closedTab` 플래그로 교체함 — 아래 참고.)**
- **서식 공통 보관함 이관 판단**: `updateCurrentCaseField('status', value)`에서 상태 변경 전후의 `group`을 비교해, **종결 그룹이 아니다가 종결 그룹으로 바뀌는 순간**(`offerMoveFormsToGlobal`) 그 사건에 서식이 1건이라도 있으면 확인 모달 노출 — "이 사건에 등록된 서식 N건을 공통 서식 보관함으로 복사해 두시겠습니까?". **확인** 시 `template.globalForms`에 복사(제목+내용 완전 일치면 중복 스킵, `category`는 사건 죄명), **사건의 서식은 그대로 남음**(삭제 안 함 — 종결 탭에서 사건을 다시 열면 여전히 보임). 취소해도 데이터 유실 없음.
- **사건 상태 기본 7종으로 개편**: `getDefaultStatusOptions()` → `수사중(active)/영장신청(active)/불송치(불입건)결정(done)/송치결정(done)/이송판단(done)/수사중지(관리미제)(hold)/종결(done)`. "수사중지(관리미제)"는 `hold` 그룹이라 종결 탭이 아니라 **진행중 탭에 계속 노출**(관리가 더 필요한 미제 사건이라는 취지). 배지 색상 2종 추가(`status-reject` 빨강, `status-susp` 회색) — 템플릿 설정의 색상 선택지에도 반영. `normalizeImportedStatus`(외부 가져오기 별칭 매핑)도 새 상태명에 맞춰 조정. 기존에 커스터마이즈해 둔 사용자의 `template.statusOptions`는 자동 마이그레이션하지 않음(사용자가 이미 정한 값을 존중) — "초기 기본값 복원" 또는 신규 설치 시에만 새 7종이 적용됨.
- 검증: 신규 설치 시 상태 7종 확인, 공통 템플릿 항목 UI/모달 섹션 완전 제거(JS 오류 없음), 진행중→종결 전환 시 서식 있는 사건은 확인 모달(문구 포함) 노출·확인 시 공통서식함에 중복 없이 추가·사건 서식은 보존, 종결 처리 후 기본 탭에서 사라지고 종결 탭에서만 보임, 통계 라벨 반영까지 Playwright로 확인. 기존 회귀 테스트(관계인/서식/내보내기/마이그레이션/캘린더·D-day/한 화면 핏) 전부 재통과.

## 11. 종결 탭 분류를 전용 플래그로 재작성 + 오늘 할 일에 당일 일정 표시 (2026-11-24)
사용자 피드백: "10절에서 만든 종결 탭이 `group==='done'`인 4개 상태(불송치/송치결정/이송판단/종결)를 전부 종결 탭으로 보냈는데, '종결'이라고 분류된 사건만 들어가야 한다." + "오늘 할 일에 그날 캘린더 일정도 같이 표시."

- **`statusOptions[].closedTab: boolean` 플래그 신설** — "진행중 통계/할 일 제외 집계"(`group`)와 "종결 탭 분류"(`closedTab`)를 완전히 분리된 두 축으로 재설계. 기본값은 `종결` 상태만 `closedTab:true`, 나머지(불송치/송치결정/이송판단/수사중지 포함)는 전부 `false` — 즉 **"송치결정"으로 바꿔도 더 이상 자동으로 종결 탭에 들어가지 않음**, 사용자가 명시적으로 "종결"로 바꾸거나 템플릿 설정에서 해당 상태의 "종결 탭" 체크박스를 켜야만 종결 탭으로 분류됨.
  - `ensureTemplateStatusOptions()`: 과거 저장본(10절 버전, `closedTab` 필드 없음)을 열어도 `opt.value==='종결'` 인 것만 `true`로 자동 보정 — 하위호환.
  - `isCaseInClosedTab(status)`: `statusOptions`에서 값으로 찾아 `closedTab` 반환, 설정에 없는(삭제/과거) 상태값은 안전하게 `false`(진행중 쪽에 남김).
  - `renderCaseList()`의 `matchScope`, `renderCaseScopeTabs()`의 카운트(`openTabCount`/`closedTabCount`) 전부 `isCaseInClosedTab()` 기준으로 교체.
  - 템플릿 설정 "0. 사건 상태 설정"의 각 상태 행에 **"종결 탭" 체크박스** 추가(`updateTemplateStatusOption(id, 'closedTab', checked)`). "진행중/종결 집계/기타" 분류 선택지 설명 문구도 "탭 분류"와 혼동되지 않게 수정.
- **오늘 할 일 + 당일 일정 통합 표시**: `renderPriorityTodoBoard()`의 "오늘" 탭 렌더링에 전체 사건의 `schedules` 중 `date === 오늘` 인 항목을 모아 파란색 박스(`.today-sched-box`, 기존 "지난 할 일" 주황 박스와 같은 구조 재사용)로 체크리스트 "오늘 할 일" 목록 **위에** 표시. 각 항목 클릭 시 해당 사건 상세로 이동. 체크리스트의 "오늘 할 일 지정" 개수 배지(`priorityTodoCount`)에는 포함하지 않음(둘은 별개 데이터 — 캘린더 일정은 체크 대상이 아니라 "오늘 있는 일" 안내용).
- **(같은 날, 후속 수정) 상단 "종결 사건" 통계 숫자가 탭 숫자와 안 맞는 버그**: 처음엔 이 통계를 `group==='done'` 기준으로 뒀는데, "송치결정"처럼 `group:'done'`이지만 `closedTab:false`인 상태의 사건이 있으면 — 종결 탭엔 0건인데 상단 통계는 1건으로 보여 사용자가 혼란을 겪음("종결 사건이 하나도 없는데 왜 1건으로 뜨냐"). **`doneCount`(= `#statCompletedCases`에 표시)도 `closedTabCount`와 동일하게(`isCaseInClosedTab()` 기준) 맞춰, 상단 통계와 종결 탭 숫자가 항상 일치하도록 수정**. `activeCount`(수사중·영장진행)는 그대로 `group==='active'` 기준 유지(탭과 무관한 별개 통계라 혼동 소지가 없음).
- 검증: 상태를 "송치결정"으로 바꿔도 진행중 탭에 남고, "종결"로 바꿔야 종결 탭으로 이동하는 것 확인. 템플릿 설정에 상태 7개 전부 체크박스 노출 확인. 오늘 날짜로 일정 추가 후 "오늘" 탭에 파란 박스로 표시되고 클릭 시 사건 이동 확인. "송치결정"/"종결" 전환 시 상단 "종결 사건" 숫자와 종결 탭 숫자가 항상 일치함을 확인. `closedTab` 값이 퀸 저장→재로드에도 보존됨을 확인. 기존 회귀 테스트(관계인/서식/내보내기/마이그레이션/캘린더·D-day/서식 이관/한 화면 핏) 전부 재통과.

## 12. 죄명별 범죄사실 예문 보관함 (공통 서식 보관함과 분리) (2026-11-24)
사용자 고민: "죄명별 범죄사실 예문을 공통 서식 보관함에 넣기엔 서식이 너무 많아지고 섞여서 불필요할 것 같다" → 완전히 별도의 저장소로 분리하는 방향을 제안하고 승인받아 구현.

- **데이터**: `template.chargeFactExamples: [{id, charge, title, content}]` — 죄명 하나당 여러 예문 등록 가능(수법별로). `globalForms`와 스키마·저장 위치 모두 분리(서식함이 지저분해지지 않음). `loadDatabase()`에 하위호환 가드(`!Array.isArray(...) → []`).
- **관리 모달 `#chargeFactModal`**: 공통 서식 보관함과 같은 좌(목록+검색) / 우(편집기) 레이아웃을 재사용해 러닝커브 없음. 헤더 ⋮ 메뉴 옆에 **"📖 범죄사실 예문"** 버튼으로 진입(공통서식함 버튼 바로 옆, 별개 저장소임을 명확히 함). 기능: 목록 검색, `+ 새 예문`, 죄명/제목/본문 편집, 삭제(확인 모달), 즉시복사(목록 카드의 📋), 본문 복사(`resolveVariables`로 현재 열린 사건 정보 치환), **"↪ 범죄사실에 삽입"**(현재 사건의 `crimeFact`란 끝에 이어붙임, 기존 globalForms의 `insertGlobalFormToCaseField`와 동일 패턴).
- **빠른 진입점**: 사건 상세의 "범죄사실" 위젯 헤더에 **"📖 예문 불러오기"** 버튼(`app.quickInsertChargeFact()`) 추가. 현재 사건의 `charge`와 **정확히 일치**하는 예문을 찾아:
  - 0건 → 모달을 "새 예문 추가" 상태로 열어줌(바로 등록 유도)
  - 1건 → 확인 모달("OOO 예문을 범죄사실란에 삽입하시겠습니까?")만 띄우고 확인 시 바로 삽입
  - 2건 이상 → 모달을 열고 검색창에 죄명을 자동으로 채워 후보들만 걸러서 보여줌(사람이 직접 골라 삽입)
  - 죄명 미입력 시 "먼저 사건의 죄명을 입력하세요" 안내만 하고 아무 것도 안 함.
- `dynamicContainerIds`에 `chargeFactListContainer`/`chargeFactEditorContainer` 추가.
- 검증: 모달 CRUD, 0/1/다건 매칭 분기 전부 Playwright로 확인(삽입 후 `crimeFact` 내용, 확인 모달 문구, 검색창 자동 채움 포함), 퀸 저장→재로드로 `chargeFactExamples`와 삽입된 `crimeFact` 보존 확인. 기존 회귀 테스트(관계인/서식/내보내기/마이그레이션/캘린더·D-day/종결 탭/한 화면 핏) 전부 재통과.

## 13. 범죄사실란 미입력 표시줄 (2026-11-24)
배경: CLAUDE.md 의 미구현 항목 "죄명 → 예문 자동 현출 + 슬롯 기반 초안"을 사용자와 재논의(grill 세션)한 결과, **슬롯 치환과 `OO` 대체는 이미 구현돼 있었음** — 예문 삽입(`insertChargeFactToCase`) 시 `resolveVariables()` 가 `{{식별자.필드명}}`(사건관계인 값)을 채우고, 값이 비면 `OO`, 없는 식별자/필드는 `{{...}}` 그대로 둔다. 실제로 남은 문제는 "삽입 후 어디가 비었는지 안 보인다"는 것 하나였고, 이번에 그것만 구현함.

- **표시줄 `#crimeFactMissingBar`**(범죄사실 textarea 바로 아래): `⚠ 미입력 N곳:` + 항목 칩(같은 표시는 `OO ×2` 처럼 묶음). 입력할 때마다 실시간 갱신, 0곳이면 CSS `.missing-bar:empty` 로 숨김(인라인 display 를 쓰지 않아 저장본에 흔적이 안 남음). `dynamicContainerIds` 에 추가됨.
- **미입력으로 세는 것**(`app.findMissingSlots(text)` → `{total, positions, groups}`): 남은 `{{...}}` / **영문자에 붙지 않은** `O` 2개 이상(`OO`, `OOO`; `GOOGLE`·`ZOOM` 같은 단어 속은 제외) / `○` 2개 이상(`○○`, `○○○`).
- **칩 클릭**(`app.selectNextMissingSlot(token)`): 현재 커서 뒤 다음 위치를 textarea 에서 선택 → 바로 덮어쓰기. 끝이면 처음으로 순환. 위치는 정규식 결과 기준이라 `OO` 칩이 `OOO`/`GOOGLE` 안을 잡지 않음.
- **[📋 복사]**(`copyFieldText`): 범죄사실에 미입력이 남아 있으면 복사는 그대로 하되 토스트를 `⚠ [범죄사실] 복사됨 — 미입력 N곳 포함. 붙여넣기 전 확인하세요.` 로 바꿈. 다른 필드는 기존 그대로.
- **데이터 변화 없음**: 화면 계산만. 스키마·내장 DB(v4)·공유 JSON(v1)·`loadDatabase()` 전부 그대로.
- **적용 범위**: 범죄사실란만(사건별 서식·참고사항은 미적용 — 써 보고 필요하면 확장).

이번 논의에서 확정된 결정(다른 환경에서 이어서 작업할 때 기준):
- 사건개요 자유 텍스트에서 정규식으로 날짜/금액/계좌를 프리필하는 안은 **폐기**. 사건개요 입력 UI 가 9절에서 제거됐고, 슬롯 값은 이미 구조화된 사건관계인 필드에서 오는 쪽이 정확함.
- **피해자 ≠ 고소인**. 고소인 역할(complainant)은 고소인/진정인/고발인을 포함하며, 고발인은 보통 피해자가 아니고 피해자가 고소하지 않은 사건도 있음. 지금은 예문에서 `{{고소인1.이름}}` 등을 그대로 쓰고, 사건관계인에 '피해자' 역할은 **추가하지 않기로 확정**(사용자 결정).
- 예문 삽입은 계속 **이어붙이기**(덮어쓰기/선택 모달 없음 — 데이터 유실 0 우선).
- 시각적 인라인 강조(textarea 뒤 미러 레이어)는 안 함. 필요해지면 그때 추가.
- '초안' 표기, 죄명 유사 매칭(`사기` ↔ `사기(보이스피싱)`)은 하지 않기로 함.

테스트: `tests/case-note/missing-slots.test.js` (T1 개수·항목·숨김, T3 복사 경고, T5 저장본 비어 있음·한 화면 핏). 실행법은 파일 상단 주석. 칩 클릭 순환과 예문 삽입 후 표시는 일회성 스크립트로만 확인(저장소 미포함).

## 14. db-core: 데이터 모양 전담 모듈 (2026-11-24 완료) — ADR-0001
결정·이유는 `docs/adr/0001-db-core-정규화-단일-모듈.md`. 아키텍처 리뷰에서 "데이터의 올바른 모양"이 7곳에 흩어져 실제 유실 버그를 낸 것이 확인되어, `case-note.html` 안 **`<script id="db-core">`** 한 곳으로 모음(1~4단계 완료).

- **위치**: 메인 `<script>` 바로 앞. 순수 코드(DOM·`app`·네트워크 없음). 기존 전역 `encodeDB/decodeDB`, `PERSON_ROLES`, `PERSON_ROLE_ORDER`, `createPersonRecord`, `getDefaultStatusOptions`, `getDefaultMasterTemplate` 가 이 블록으로 **이동**(전역 이름은 그대로라 기존 코드 영향 없음).
- **인터페이스** `DBCore.*`:
  - `normalizeDB(raw, {now})` → 정식 DB(v4). 빠진 것만 채움, 모르는 속성 보존, 구버전 평면 변수 마이그레이션, 멱등. 입력 불변.
  - `normalizeTemplate(t)`, `normalizeCase(c, template, now)` — 위의 부품.
  - `makeCase(template, {now, fields})` — 새 사건(새 사건 버튼·외부 목록 가져오기 공용).
  - `toShareJson(db, {scope, caseIds, exportedAt})` / `applyShareJson(db, parsed, 'replace'|'merge', {now})` → `{db, summary}`. 덮어쓰기는 **파일에 있는 섹션만** 교체, 병합은 **추가만**(상태는 같은 이름, 예문은 같은 id 또는 죄명+제목+본문이면 건너뜀). 구버전 상태 별칭은 설정에 없는 이름일 때만 적용.
  - `encodeVerified(db)` — 인코딩 후 다시 풀어 비교, 다르면 예외(파일 쓰지 말 것).
- **테스트**: `node tests/case-note/db-core.test.js` (Node 만 필요, 45개 검사 — 오프라인, 멱등, 속성 보존, 마이그레이션, 한글·이모지 왕복, 검증 실패 시 예외, 덮어쓰기 섹션 보존(유실 버그 재현), 내보내기→가져오기 왕복, 병합 규칙, makeCase).
- **진행 상황**:
  - [x] 1·2단계: db-core + 테스트 (2026-11-24)
  - [x] 3단계: 앱 진입점 5곳을 db-core 로 연결 (2026-11-24 완료)
    - [x] 3-1 로드·복구·저장 (2026-11-24): `loadDatabase` / `applyRecoveredData` 가 `DBCore.normalizeDB` 경유(`applyNormalizedDB` 로 반영). 앱이 모르는 최상위 키는 `app.dbExtra` 에 보관했다가 저장 시 되돌려 넣음. 저장은 전부 `app.encodeForSave()` → `DBCore.encodeVerified` 경유(`syncEmbeddedBase64Tag`·`buildCleanHtmlDocumentString`), 실패하면 내장 태그·임시저장·파일 **아무것도 안 쓰고** `reportSaveBlocked` 토스트(같은 문구 5초에 1회).
      - **손상된 내장 DB**(디코딩 실패 또는 `cases` 배열 없음) → `app.readOnly = true`: 빈 목록 + 빨간 `#dbErrorBanner`, 저장 전부 거부, 임시 백업이 있으면(“저장됨” 표시여도) 복구 배너. 이때 "현재 파일 유지"를 눌러도 백업 표시는 지우지 않음. 백업 복구 시 정규화 후 읽기 전용 해제·저장 재개.
      - 샘플 데이터는 내장 DB 가 **비어 있을 때만**. 백업 복구 시 D-day 도 복원(전에는 누락).
    - [x] 3-2 공유 JSON (2026-11-24): `exportPureJson` → `DBCore.toShareJson(app.currentDB(), …)`, `importPureJson` → `DBCore.applyShareJson`. 덮어쓰기는 파일에 있는 섹션만 교체(상태 설정·예문·관계인 필드·D-day 유지 — **유실 버그 해결**), 병합은 추가만. 덮어쓰기 확인창에 "(파일에 없는 설정은 유지)" 문구. 읽기 전용(손상 DB) 상태에서 가져오기에 성공하면 = 복원으로 보고 읽기 전용 해제.
    - [x] 3-3 새 사건 (2026-11-24): `createNewCase` → `DBCore.makeCase(template)`, `importExternalCases` → 매핑 값을 `fields` 로 모아 `makeCase(template, {fields})`(제목 빈칸·서식 없음은 기존대로). 외부 값의 구버전 상태 이름(송치 등)은 `makeCase` 가 공유 JSON 과 같은 별칭 규칙으로 처리. 외부 목록 사건의 기본 상태는 고정 '수사중' → **상태 설정의 첫 번째 상태**(기본 설정이면 같음).
  - [x] 4단계: 남은 보정 삭제 (2026-11-24) — `ensureTemplateStatusOptions`, `ensureTemplatePersonRoleFields`, `ensureCasePeople`, `migrateCaseFlatVariables`, `ensureGlobalForms`, `ensureChargeFactExamples`, `normalizeImportedStatus/Template/Case` 삭제, 화면 코드의 지연 보정(`if (!Array.isArray(current.schedules)) …`, `if (!current.forms) …` 등 13곳) 삭제, `getStatusOptions` 의 빈 목록 대체 삭제. **화면 코드는 이제 데이터가 정식 모양이라고 가정**한다 → 새로 데이터를 만들거나 통째로 바꾸는 코드는 반드시 `DBCore.*` 를 거칠 것.
    - 함께 고친 버그: **"기본 템플릿 복원"이 범죄사실 예문을 지우던 문제** — 이제 공통 서식 보관함과 같이 예문도 유지, 결과는 `DBCore.normalizeTemplate` 경유.
- **앱 연결 테스트**: `PLAYWRIGHT_DIR=~/.cache/toi-test LANG=C.UTF-8 node tests/case-note/entry-points.test.js` — 내장 DB 를 바꾼 사본을 임시 폴더에 만들어 엶(L1 구버전 DB, L2 손상 DB·백업 복구, L3 빈 DB→샘플, S1 저장 검증 실패, J1~J4 실제 파일 입력·다운로드로 JSON 덮어쓰기/병합/왕복/읽기 전용 복원, N1·N2 새 사건·외부 목록 사건 모양, R1 기본 템플릿 복원·보정 함수 없이 화면 열기).

## 6. 수정 시 체크리스트
1. 새 동적 컨테이너 → `dynamicContainerIds`.
2. 데이터 변경 끝에 `onStateChanged()`; 목록 갱신이 필요하면 `renderCaseList()`, 상세면 `renderCaseDetail()`/`renderDetailChecklist()`.
3. 스키마 추가 → **`db-core`(14절)의 `normalizeTemplate`/`normalizeCase` 한 곳** + `tests/case-note/db-core.test.js` + `docs`·이 문서 갱신. (진입점은 전부 db-core 경유. 화면 코드에 `if (!x) x = []` 식 보정을 다시 넣지 말 것 — 빠진 기본값은 db-core 에서 채움)
4. 테스트: 저장소에 있는 것은 `tests/case-note/*.test.js`(실행법은 각 파일 상단; Playwright 위치는 `PLAYWRIGHT_DIR` 로 지정 가능). 그 외는 Playwright(headless Chromium)로 `file:///.../case-note.html` 열어 `app.*` 직접 호출. 저장본 생성은 `app.buildCleanHtmlDocumentString()`.
5. 검증 시 기억: 샘플 데이터는 첫 로드 때 `getInitialSampleCases()` 로 생성. 저장소의 `case-note.html` 은 `#embedded-db-b64` 가 비어 있음(사용자가 쓰던 저장본은 데이터가 들어 있음).

## 7. 이력(요약)
- (2026-11-26) 외부 목록: 중첩 JSON 재귀 펼침, 사람 목록 → 사건관계인(구분값 대응표 저장), 같은 사건번호는 빈 칸만 채우는 병합(8절 6).
- (2026-11-26) 외부 목록 사건번호 10자리→`YYYY-NNNNN` 자동 변환(8절 5). 좌측 할 일 패널 목록이 길면 잘려서 아래가 안 보이던 문제 수정 — `#todoPanelTabBody` 가 패널 높이를 채우지 않아(flex 미지정) `.todo-scroll` 이 스크롤되지 않았음 → `flex:1; min-height:0; display:flex` 추가.
JSON v1 공유·병합 가져오기 → 죄명/범죄사실 + 좌측 할 일 패널 + 파스텔 UI → ☆ 오늘 할 일 지정 + 📚 공통서식보관함 이식.
(사용자가 제공한 원본은 `/root/.claude/uploads/...` 에 있었고 현재는 저장소의 `case-note.html` 이 최신 기준.)
