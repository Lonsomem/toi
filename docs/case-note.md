# 사건 관리 노트 (`case-note.html`) 개발 메모

경찰 수사관용 사건 관리 단일 HTML. 서버 없이 **파일 자기 자신을 덮어써서** 데이터를 보관한다(Quine 구조).
코드 위치는 함수명으로 찾을 것(`grep -n "함수명(" case-note.html`). 줄 번호는 자주 바뀐다.

## 1. 아키텍처 (훼손 금지)
- 외부 의존 0: CSS/HTML/Vanilla JS/SVG 아이콘 전부 한 파일.
- **내장 DB**: 하단 `<script id="embedded-db-b64" type="text/plain">` 안에 `encodeDB({version:4, savedAt, template, cases})` 결과(UTF-8 안전 Base64: `btoa(unescape(encodeURIComponent(JSON)))`). `decodeDB` 는 역변환.
- **자기 덮어쓰기**: File System Access API. `connectSelfHtmlFile()` → 핸들 저장, `writeSelfHtmlToFileHandle()` 가 `buildCleanHtmlDocumentString()` 결과를 디스크에 기록. `onStateChanged()` 에서 0.5초 디바운스 + Ctrl+S(`saveOrConnectHtmlFile`).
- **buildCleanHtmlDocumentString()**: DOM 을 `cloneNode(true)` → `dynamicContainerIds` 컨테이너 innerHTML 비움 + 입력값 초기화 + `#priorityTodoList` 비움 → `#embedded-db-b64` 만 갱신. (동적으로 그리는 영역을 새로 만들면 id 를 이 배열에 꼭 추가 — 안 하면 렌더된 HTML 이 파일에 박혀 오염.)
  현재 목록: `case-list-body, paginationBar, detailChecklistContainer, boilerplateTabs, customFieldsTabBar, customFieldsContainer, heroPipelineStepper, tplCustomFieldsList, tplChecklistList, tplFormsList, toastContainer, globalFormsListContainer, priorityTodoCount, todoTabNextCount, todoTabTodayCount, todoPanelSub, todoTabAllCount`
- **브라우저 임시 백업**: `localStorage` 키 `CASE_NOTE_SINGLE_FILE_B64_V4`(데이터) / `CASE_NOTE_SINGLE_FILE_META_V4`(`{savedAt, unsaved}`). 파일 미연결 상태에서 변경 시 저장되고, 내장본보다 새로우면 `#recoveryBanner` 로 복구 제안(`applyRecoveredData`/`dismissRecoveryBanner`).
- **onStateChanged()** 가 한 번에: Base64 태그 갱신 + localStorage 백업 + 용량 표시 + 파일 자동 덮어쓰기 예약. 데이터를 바꾸면 항상 마지막에 호출.
- **loadDatabase()**: 내장 DB 디코딩 → 하위호환 방어 코드(없으면 기본값). 새 속성 추가 시 여기에 `if (!x) x = 기본값` 추가. 현재 보정 항목: `template.globalForms`, `case.charge`, `case.crimeFact`(문자열), `case.checklist[].id`(없으면 생성).
- 화면: `100vh`, `overflow:hidden`. 전체 페이지 스크롤 없음(목록은 내부 영역만 스크롤).

## 2. 데이터 스키마
```
template = {
  checklist: [string],                       // 신규 사건 기본 체크리스트
  forms: [{id,title,content}],               // 신규 사건 기본 개별 서식
  customFields: [{id,label,placeholder}],    // 모든 사건 공통 입력 항목
  globalForms: [{id,category,title,content}] // 📚 공통 서식 보관함(사건 무관)
}
case = {
  id, caseNumber, status, title,
  charge, crimeFact,                         // 죄명 / 범죄사실
  overview, reference, remarks,              // 사건개요·피해현황 / 참고사항 / 비고
  createdAt, updatedAt,                      // 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm'
  checklist: [{id,text,done,date,            // date='MM/DD' 완료일 자동 기록
               todayDate,todayOrder}],       // 오늘 할 일 지정(선택): 'YYYY-MM-DD', 정렬순서
  forms: [{id,title,content}],               // 사건별 서식 (템플릿에서 복제)
  customValues: { [customField.id]: string },
  priorityOrder?: number                     // 전광판(다음 할 일) 드래그 순서
}
```
- status 값: `수사중`, `영장신청`, `송치완료`, `타관이송`, `중지/각하`. `송치완료`/`타관이송`은 "종결"로 취급(할 일 패널·통계에서 제외).
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
- 검증: Playwright로 중첩 경로 자동탐지·수동 지정, 필드 매핑, 상태 정규화, 중복 사건번호 스킵, 템플릿 체크리스트·사건공통 관계인 자동 적용, quine 저장 함수 정상 동작, **null뿐인 키 숨김/모두 보기 토글, 다중 값 샘플 표시, 여러 키의 참고사항 합산(덮어쓰지 않음), 접수일자→createdAt 매핑**까지 확인(22건). **검증 안 됨**: 사용자의 실제 내부 시스템 JSON 스키마.
- 참고: 동일한 URL-fetch/CORS 우회/키 선별/콘솔 스크립트 개념은 독립 파일 `case-import.html`(및 `json-viewer.html`)에도 있음 — 그쪽은 이 모달과 무관하게 더 많은 옵션(URL 직접 fetch, 클립보드 자동 붙여넣기, 사건별 상세조회, 정규식 값 변환)을 가진 범용 도구로 유지됨. 지금 사용자가 원한 건 사건 관리 노트에 바로 통합된 가장 단순한 버전.

## 5. 스타일 메모
- 원래 어두운 남색 → 파스텔 그라데이션(보라→하늘→민트) 톤으로 개편(1차, "UI 개편" 블록) → **(2026-11-19) 겨울 시즌 리디자인**(2차, "겨울 시즌 리디자인" 블록, `<style>` 맨 끝)으로 한 번 더 톤 교체. 둘 다 원본 규칙을 CSS 캐스케이드 순서로 덮어쓰는 방식(선택자 재선언, 일부는 `!important`) — 레이아웃 치수(패딩·폰트크기·그리드)는 건드리지 않고 **색상·그라데이션·그림자·장식만** 교체해 기존에 맞춰둔 "한 화면에 꽉 차는" 핏을 보존함.
- 겨울 테마: 안개 낀 아이스블루~크림 배경 그라데이션, 황혼 느낌 헤더(남색→더스티블루 그라데이션 + 서리 입자 패턴 `::before`), 버튼은 그라데이션 채움 + 호버 시 살짝 떠오르는 효과, 기존 인디고(`#4f46e5` 등) 계열 포인트 색을 더스티블루/플럼 톤으로 교체. `body` 바로 아래 `.winter-snowfall`(`position:fixed; z-index:-1`)에 눈송이 10개를 CSS `@keyframes`로 천천히 흘려보냄 — 클릭 불가(`pointer-events:none`)·레이아웃 비관여, 카드 사이 여백에서만 은은하게 비침.
- `.todo-panel`(350px), `.case-cards-grid`(auto-fill minmax 255px), `.star-btn`, `.today-badge`, `.overdue-box` 등.
- 검증: Playwright로 JS 오류 없음, 기존 원페이지 핏 테스트(700~900px 높이, 태블릿 해상도 3종) 전부 재확인 — 회귀 없음.

## 6. 수정 시 체크리스트
1. 새 동적 컨테이너 → `dynamicContainerIds`.
2. 데이터 변경 끝에 `onStateChanged()`; 목록 갱신이 필요하면 `renderCaseList()`, 상세면 `renderCaseDetail()`/`renderDetailChecklist()`.
3. 스키마 추가 → `loadDatabase()` 방어 + (공유 대상이면) `normalizeImportedCase/Template` + `docs`·이 문서 갱신.
4. 테스트: Playwright(headless Chromium)로 `file:///.../case-note.html` 열어 `app.*` 직접 호출. 저장본 생성은 `app.buildCleanHtmlDocumentString()`.
5. 검증 시 기억: 샘플 데이터는 첫 로드 때 `getInitialSampleCases()` 로 생성. 저장소의 `case-note.html` 은 `#embedded-db-b64` 가 비어 있음(사용자가 쓰던 저장본은 데이터가 들어 있음).

## 7. 이력(요약)
JSON v1 공유·병합 가져오기 → 죄명/범죄사실 + 좌측 할 일 패널 + 파스텔 UI → ☆ 오늘 할 일 지정 + 📚 공통서식보관함 이식.
(사용자가 제공한 원본은 `/root/.claude/uploads/...` 에 있었고 현재는 저장소의 `case-note.html` 이 최신 기준.)
