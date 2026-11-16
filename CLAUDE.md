# toi — 저장소 안내 (Claude 가 코드를 읽거나 수정하기 전에 먼저 읽을 것)

사용자: 경찰 수사관. **내부망(오프라인)** 에서 쓰는 도구들. 외부 CDN/웹폰트/외부 JS·CSS·이미지 **절대 금지**.
사용자 선호: **설명은 간단하고 명료하게**, 한국어. PR 은 사용자가 요청할 때만. 개발 브랜치: `ccr-4ca3e7c9-6uwh9u`.

## 구성
| 파일 | 설명 | 상세 문서 |
|---|---|---|
| `case-note.html` | 사건 관리 노트 (단일 HTML, 자기 자신을 덮어쓰는 Quine 구조) | `docs/case-note.md` |
| `qr-sender.html` / `qr-receiver.html` | 오프라인 QR 파일 전송기(PC→폰). **빌드 산출물** | `docs/qr-transfer.md` |
| `qr-tools/src/*` | QR 도구 소스 (여기를 수정하고 `python3 qr-tools/build.py`) | 〃 |
| `qr-tools/tests/*` | 수동 실행 테스트 스크립트 | `qr-tools/tests/README.md` |

## 절대 규칙
1. **`qr-sender.html`/`qr-receiver.html` 을 직접 수정하지 말 것.** `qr-tools/src` 수정 → `python3 qr-tools/build.py`.
2. `case-note.html` 은 단일 파일. 새 동적 영역(innerHTML 로 그리는 컨테이너·카운터 span)을 추가하면 `buildCleanHtmlDocumentString()` 의 `dynamicContainerIds` 에 id 추가.
3. 데이터 변경 후에는 반드시 `this.onStateChanged()`. 스키마 속성 추가 시 `loadDatabase()` 에 기본값 방어 코드.
4. 공유 JSON(version 1) 형식은 깨지 않는다 (기존 환경 호환). 새 속성은 선택(optional)으로.
5. 한글 데이터 무결성이 최우선: 파일 내용은 바이트로만 다루고, 텍스트는 항상 UTF-8.
6. QR 도구 UI 코드는 **구형 Chrome/Edge 호환 문법만** (`?.`, `??`, `catch {}` 등 금지 — 점검: `grep -nE '\?\.|\?\?|catch \{' qr-tools/src/*.js`).
7. 테스트는 사용자 PC/폰이 아니라 이 컨테이너(headless Chromium)에서만 가능. **실제 폰 카메라 동작은 검증된 적 없음** — 단정적으로 말하지 말 것.

## 작업 흐름
- 수정 → (QR 도구면 build) → 해당 테스트 실행 → `git add`/commit → `git push -u origin ccr-4ca3e7c9-6uwh9u`.
- 커밋 메시지는 한국어, 끝에 시스템이 지정한 Co-Authored-By / Claude-Session 줄.
- 사용자는 "코드 작성 전에 먼저 이야기하자"를 자주 요청함 → 그 경우 설계·질문만 하고 코드는 쓰지 않는다.

## 미구현/논의만 된 항목 (필요 시 사용자와 재논의)
- 죄명 입력 시 저장된 범죄사실 문안 자동 현출 + 슬롯({{피해자}}, {{일시}}, {{피해금액}}) 기반 초안 생성 (설계만 논의, 미구현). 정규식으로 사건개요에서 날짜/금액/계좌 프리필 + 미입력은 OO 강조, 항상 "초안", 기존 범죄사실이 있으면 덮어쓰지 않고 선택.
- PDF(스캔본) 내부 이미지 재압축 (미구현).
- QR 양방향 피드백(웹캠으로 수신 완료 확인) 미구현. 전송 암호화는 헤더 플래그 자리만 예약(`flags` bit0).
