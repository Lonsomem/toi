# toi — 저장소 안내 (Claude 가 코드를 읽거나 수정하기 전에 먼저 읽을 것)

사용자: 경찰 수사관. **내부망(오프라인)** 에서 쓰는 도구들. 외부 CDN/웹폰트/외부 JS·CSS·이미지 **절대 금지**.
사용자 선호: **설명은 간단하고 명료하게**, 한국어. PR 은 사용자가 요청할 때만. 개발 브랜치: `ccr-4ca3e7c9-6uwh9u`.

## 구성
| 파일 | 설명 | 상세 문서 |
|---|---|---|
| `case-note.html` | 사건 관리 노트 (단일 HTML, 자기 자신을 덮어쓰는 Quine 구조). **📥 외부 사건목록 가져오기** 모달 내장. (2026-11-19) 사건 상태(수사중/영장신청/…)를 템플릿 설정에서 자유롭게 추가·이름변경·삭제 가능. (2026-11-24) **깃허브 스타일 대시보드 전면 개편은 롤백**하고 원래 디자인(겨울 시즌 리디자인)으로 복귀 — 상태 설정 기능만 이식. 사건개요/비고 입력칸을 **사건별 캘린더**로 교체, 메인 화면 좌측 패널에 **할 일/캘린더 탭**(전체 사건 일정 통합 + D-day 카운터) 추가, 기본 정렬은 사건번호순 | `docs/case-note.md` |
| `qr-receiver.html` | QR 수신기(폰/웹캠 PC). **빌드 산출물**. (송신은 별도 파일 없이 `pdf-manual-search.html` 의 [📡 QR로 전송] 에 내장 — `qr-sender.html` 은 제거됨) | `docs/qr-transfer.md` |
| `qr-tools/src/*` | 수신기 소스 + **공유 코어**(`core.js` QX, `qr-encoder.js`: 검색기 빌드도 사용). 수정 후 `python3 qr-tools/build.py` | 〃 |
| `pdf-manual-search.html` | 다중 PDF 매뉴얼 검색기(PDF.js 내장, 표 인식). **빌드 산출물** | `docs/pdf-search.md` |
| `pdf-tools/src/*`, `pdf-tools/vendor/*` | 위 파일의 소스·내장 PDF.js (수정 후 `python3 pdf-tools/build.py`) | 〃 |
| `qr-tools/tests/*` | 수동 실행 테스트 스크립트 | `qr-tools/tests/README.md` |
| `case-import.html` | (보류) 사건목록 가져오기 범용 버전 — URL fetch/클립보드 자동 붙여넣기/사건별 상세조회/정규식 값 변환까지 갖춘 독립 도구였으나, 사용자가 "다 집어치우고 단순하게"라고 요청(2026-11-19)해 **`case-note.html`에 내장된 단순 버전으로 대체**. 파일은 남겨뒀지만 현재 권장 경로 아님 | `docs/case-import.md` |
| `json-viewer.html` | 범용 JSON 트리 뷰어(붙여넣기/파일/URL). 특정 기능에 종속되지 않는 독립 도구 — 트리로 펼쳐보기·검색·경로/값 복사 | `docs/json-viewer.md` |
| (미구현) 내부망 로컬 LLM | QR 전송 대신 내부망 PC에 경량 LLM(Qwen) + RAG 로 매뉴얼 질의. 모델 선택·반입 절차만 검토됨, 코드 없음 | `docs/local-llm.md` |

## 절대 규칙
1. **`qr-receiver.html`/`pdf-manual-search.html` 을 직접 수정하지 말 것.** `qr-tools/src`(→ `python3 qr-tools/build.py`) 또는 `pdf-tools/src`(→ `python3 pdf-tools/build.py`) 수정. `pdf-tools/build.py` 는 `qr-tools/src/core.js`(QX)와 `qr-encoder.js` 를 가져다 쓰므로 이 둘을 바꾸면 **두 빌드를 모두 재실행**.
2. `case-note.html` 은 단일 파일. 새 동적 영역(innerHTML 로 그리는 컨테이너·카운터 span)을 추가하면 `buildCleanHtmlDocumentString()` 의 `dynamicContainerIds` 에 id 추가.
3. 데이터 변경 후에는 반드시 `this.onStateChanged()`. 스키마 속성 추가 시 `loadDatabase()` 에 기본값 방어 코드.
4. 공유 JSON(version 1) 형식은 깨지 않는다 (기존 환경 호환). 새 속성은 선택(optional)으로.
5. 한글 데이터 무결성이 최우선: 파일 내용은 바이트로만 다루고, 텍스트는 항상 UTF-8.
6. QR 도구·PDF 검색기 UI 코드는 **구형 Chrome/Edge 호환 문법만** (`?.`, `??`, `catch {}` 등 금지 — 점검: `grep -nE '\?\.|\?\?|catch \{' qr-tools/src/*.js pdf-tools/src/*.js`). PDF.js 는 legacy 빌드.
7. 테스트는 사용자 PC/폰이 아니라 이 컨테이너(headless Chromium)에서만 가능. **실제 폰 카메라 동작, 사용자의 실제 PDF(HWP 변환본 등)에서의 추출 품질은 검증된 적 없음** — 단정적으로 말하지 말 것. (PDF 검색기는 합성 PDF 로만 검증)
8. PDF.js(Apache-2.0)는 `pdf-tools/vendor` 에 원문 그대로 두고 LICENSE 유지. 외부 요청 0건을 유지(`e2e.test.js` 가 검사).

## 작업 흐름
- 수정 → (QR 도구면 build) → 해당 테스트 실행 → `git add`/commit → `git push -u origin ccr-4ca3e7c9-6uwh9u`.
- 커밋 메시지는 한국어, 끝에 시스템이 지정한 Co-Authored-By / Claude-Session 줄.
- 사용자는 "코드 작성 전에 먼저 이야기하자"를 자주 요청함 → 그 경우 설계·질문만 하고 코드는 쓰지 않는다.

## 미구현/논의만 된 항목 (필요 시 사용자와 재논의)
- 죄명 입력 시 저장된 범죄사실 문안 자동 현출 + 슬롯({{피해자}}, {{일시}}, {{피해금액}}) 기반 초안 생성 (설계만 논의, 미구현). 정규식으로 사건개요에서 날짜/금액/계좌 프리필 + 미입력은 OO 강조, 항상 "초안", 기존 범죄사실이 있으면 덮어쓰지 않고 선택.
- PDF(스캔본) 내부 이미지 재압축 (미구현).
- QR 양방향 피드백(웹캠으로 수신 완료 확인) 미구현. 전송 암호화는 헤더 플래그 자리만 예약(`flags` bit0).
- **진행 계획(사용자와 합의)**: 1단계 = 검색기에서 QR 전송(완료, JSON 만 전송·검색기 포함은 선택) → 2단계 압축 강화(deflate → 글자 단위 문맥 모델 등) → 3단계 매뉴얼 **죄명별 지식 JSON**(구성요건·필수 확인 항목·수사 체크리스트·범죄사실 예문·수사결과보고서 구성; 검색기에 태깅 화면 + 자동 후보, 사람 확인 필수, 모든 항목에 출처 쪽) → 4단계 사건 관리 노트의 **질의 마법사**(죄명 후보 제시→필수 항목 점검·질문→수사 방향 체크리스트→초안; 입력 안 된 사실은 `OO`, 법적 판단 안 함, 체크리스트는 사건 할 일로 추가). 외부 LLM 용 프롬프트 묶음은 같은 지식 JSON 사용.
- 사용자 의도: 내부망에서 변환 완료 후 전송, 외부에서 자유 활용(파인튜닝·사실관계 비정형 추출). 학습용 쌍(입력-정답)은 매뉴얼만으로는 부족 → few-shot/RAG 먼저. 개인정보 마스킹은 선택 기능으로 논의만(이름·주소는 규칙으로 불완전).
- **방향 전환 검토 중(2026-11-17)**: QR 전송 대신 내부망 PC에 경량 LLM(Qwen2.5-7B-Instruct, RAM 16GB·VRAM 없음 가정) + RAG 직접 구축하는 안을 검토 중. 상세는 `docs/local-llm.md`. 아직 코드 없음, 실측 테스트 전.
- **(2026-11-19, 최종) 외부 사건목록 가져오기는 `case-note.html`에 통합 완료**: `#externalImportModal` (📥 외부 목록 가져오기 버튼). 콘솔 스크립트 복사(대상 페이지에서 직접 fetch+저장, CORS 없음) → `.json` 파일 불러오기(데이터 경로 지정 또는 재귀 자동탐지) → 키별로 사건번호/제목/죄명/상태/사건개요/참고사항/비고 중 매핑 선택 → 사건번호 중복 없는 것만 새 사건으로 추가. `case-import.html`에 있던 URL 직접 fetch·CORS 우회·사건별 상세조회·정규식 값 변환은 이 통합 버전엔 없음(사용자가 명시적으로 간소화를 요청). 사용자의 실제 내부 시스템 JSON 스키마로는 검증된 적 없음.
