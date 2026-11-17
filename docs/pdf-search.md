# 다중 PDF 매뉴얼 통합 검색기 (`pdf-manual-search.html`) 개발 메모

원본(사용자 제공 `PDF.js 연동` 단일 HTML)의 기능을 그대로 두고, **표가 깨지는 문제 / 긴 PDF 가 중간에서 끊기는 문제**를 보완한 오프라인 단일 HTML.
**빌드 산출물**이다 → 수정은 `pdf-tools/src` 에서 하고 `python3 pdf-tools/build.py`.

## 1. 파일
```
pdf-tools/src/template.html   HTML/CSS (원본 UI 유지 + 보고서/진행 모달, 옵션 행, 쪽 이동)
pdf-tools/src/layout.js       PL: 좌표 기반 줄 재구성 · 선 표 격자/병합 셀 · 선 없는 표 추정 · PDF.js 입력 변환
pdf-tools/src/engine.js       PDFENGINE: 내장 PDF.js/워커/CMap 로드 (압축 슬롯 해제, 외부 통신 없음)
pdf-tools/src/app.js          app: 저장(IndexedDB)·추출 파이프라인·검색·리더·보고서·내보내기
pdf-tools/src/samples.js      원본의 샘플 문서 2권
pdf-tools/vendor/pdfjs-3.11.174/  pdf.min.js + pdf.worker.min.js (legacy 빌드, Apache-2.0, LICENSE 포함) + 한글 CMap 24개
pdf-tools/build.py            조립: PDF.js 등을 raw deflate+Base64 로 슬롯에 삽입, qr-tools/src/core.js(QX: inflate/deflate) 포함
pdf-tools/tests/              gen_pdfs.py(합성 PDF) · extract.test.js(Node) · e2e.test.js · e2e-extra.test.js(Playwright)
```
- 외부 스크립트/CDN/Base64 붙여넣기 단계 **없음**. PDF.js·워커·CMap 은 HTML 안에 압축 내장(`<script type="text/plain" id="pdfjs-main-z|pdfjs-worker-z|pdfjs-cmaps-z">`, 형식 `"<원본크기>:<Base64(raw deflate)>"`). 부팅 시 `QX.inflate` 로 풀어 `<script id="pdfjs-injected">` 주입, 워커는 Blob URL.
- 파일 크기 ≈ 0.9MB (+ 저장 시 색인).
- 구형 브라우저용: UI 코드는 `?.`/`??` 금지, PDF.js 는 **legacy** 빌드.

## 2. 원본에서 확인한 문제와 원인 → 조치
| 증상 | 원인(원본 코드) | 조치 |
|---|---|---|
| 표에서 글이 섞임/잘림 | 글자 조각을 PDF 기록 순서로 이어 붙임, 줄 구분 y 6pt 고정, 같은 줄은 공백 1개 → 열 경계 소멸, 여러 줄 셀이 옆 칸과 섞임 | `layout.js` 좌표 기반 재구성(아래 3절) |
| **긴 PDF 가 ~800쪽까지만** (유력) | 텍스트 없는 쪽(빈 쪽/그림 쪽)을 `pages` 에서 **제외** → 목록이 줄어듦. `movePage` 가 `쪽번호 ≤ pages.length` 로 제한 → 800개 남으면 801쪽 이후 ◀▶ 불가, 지표도 `n/800쪽` | 모든 쪽 유지(`st`: ok/blank/img/fail), `movePage` 는 목록 index 기준, `n/실제쪽수` 표시, 쪽 번호 직접 이동 입력 |
| 한 쪽 오류로 문서 전체 포기 | 파싱 전체가 하나의 try/catch → 실패 시 원본 뷰어(복붙)로 전환 | 쪽 단위 격리(`extractOnePage`, 쪽별 타임아웃 30~60초), 실패 쪽 기록 후 계속 |
| 저장 실패를 모름 | `localStorage`(≈5MB) `catch {}` 무시 | IndexedDB 문서별 저장 + 실패 시 경고/헤더 표시 |
| 복붙 경로에서 1200자마다 임의 분할 | `chunkText` | 문단 경계에서만 분할(≈2800자), `\f` 있으면 쪽 구분 사용 |
| 검색 미리보기가 표 구조 소멸 | `\s+` → 공백 | 줄 유지, 표는 ` | ` |
| 줄바꿈 낀 문장 검색 실패 | 단순 `indexOf` | 글자 사이 `[\s표식]*` 허용 정규식 + 공백제거 사전필터 |
| 내부망 불가 | CMap/엔진을 cdnjs 에서 받음 | 전부 내장 |

## 3. 추출 알고리즘 (`layout.js`, 좌표계: 뷰포트 변환 후 y 아래로 증가)
1. `PL.fromPdfJs(textContent, opList, OPS, viewport.transform, w, h)`: 글자 조각 → `{str,x0,x1,y(기준선),size}`, 연산자 목록에서 선분 추출(CTM 추적, `constructPath`의 moveTo/lineTo/rectangle, 얇은 사각형=선, 클립 경로 제외, Form XObject 처리), 이미지 연산 유무(`hasImage`), 사설영역/대체문자 수(`pua`). 페이지 `/Rotate` 는 viewport 변환으로 반영.
   - `getTextContent({disableCombineTextItems:true})` 사용(그래도 PDF.js 가 일부 병합하므로 글자 단위로 다시 푼다).
2. `makeLines`: y 군집(허용오차=글자크기×0.45) → 글자 단위 박스로 풀어 정렬 → **이중 인쇄(가짜 굵게) 제거**(같은 글자가 min(0.3em, 0.45×글자폭) 안에 겹치면 하나만) → 간격 > 0.17em 이면 공백, > 1.5em(≥10pt)이면 **열 간격**(세그먼트 분리). 공백뿐인 조각은 버림(PDF.js 가 열 사이를 `' '` 조각으로 채워 열 경계를 가림).
3. `detectRuledTables`: 선분을 수평/수직으로 정규화·병합(1.6pt/2.5pt) → 교차 연결 요소 → 격자(x/y 군집 2pt) → 각 경계의 선 존재 검사(60% 이상 덮임) → 없는 경계는 union-find 로 **셀 병합(colspan/rowspan)**. 논리 셀 ≥2, 크기 하한. `assignToTables` 로 글자 조각 중심점으로 셀 배정. 셀 글은 줄들을 공백으로 이어 **한 칸 문장**으로.
   - 방어: 1열 표, 또는 셀 ≤4개인데 한 셀에 글 70%↑(총 40조각↑)이면 표가 아니라 일반 글로 되돌림(쪽 전체 테두리+머리말 선 오인 방지).
4. `detectBorderless`(선 없는 표 추정): 다열 줄(세그먼트≥2) 3줄 이상, 열 시작 위치(7pt 허용)가 반복, 70% 이상 줄이 2개 이상 열에 정렬 → 행 구성(열 하나만 있는 줄은 이전 행 셀의 줄바꿈 연속으로 병합). 보수적(오탐 시 UI 옵션으로 끔).
5. `composePage`: 표/추정표/일반 줄을 `top` 순으로 합침. **표 행 표현**: `␞` + 셀들을 `␟` 로 연결(저장 텍스트 그대로). `PL.toTsv`(복사용 탭), `PL.toPlain`(미리보기용 ` | `).
- 쪽 상태 `st`: `ok`(글 있음, 저장 시 생략) / `blank`(내용 없음) / `img`(글 없고 이미지 있음) / `fail`(+`err`).
- 보고서 `doc.report`: numPages, ok/blank/img/fail, failPages(≤60), tables(선)/borderless(추정), chars, pua/puaPages(글자 매핑 깨짐 의심), cancelled, sec, opts, engine.

## 4. 저장
- 문서별 IndexedDB `pdf-manual-search-v7`(store `docs` keyPath id, `meta`: `deleted`(삭제 id 목록), `checks`(체크 상태)). 실패 시 `storageState='error'` + 토스트/헤더 경고.
- 단일 HTML 저장(`downloadEmbeddedHtml`): 색인 = `Z1:<원본크기>:<Base64(raw deflate(JSON UTF-8))>` → `#embedded-pdf-index-b64`. **주입된 엔진 스크립트(`#pdfjs-injected`)는 복제본에서 제거**(중복 방지), 동적 컨테이너 비움.
- 로드 순서: 내장 색인 + IndexedDB 병합(같은 id 면 `savedAt` 큰 쪽) − `deleted`. 구형 Base64 JSON 색인·localStorage `PDF_MANUAL_SEARCH_INDEX_V6` 도 읽음. 비어 있으면 샘플 2권.
- JSON 백업/가져오기: `{v:2, docs:[...]}` (구형 `{docs}` 호환). **가져오기는 병합**(같은 id/이름은 교체, 나머지 유지 — 원본은 전체 교체였음).

## 5. 검색
- 문법 원본 그대로: `a + b`/공백(AND, 근접 간격 `proxLimitSelect`), `a ~N b`(정확히 N자 이내), `a | b`(OR), 따옴표 구문.
- `termRegex`: 글자 사이 `[\s␞␟]*` 허용(줄바꿈·표 칸 경계 무시). 공백 제거 평문(`flatOf`, WeakMap 캐시)으로 사전 필터 → 1300쪽 다중 검색 ≈ 0.1초. 입력 220ms 디바운스. 결과 카드 400건 상한.
- 강조는 원문에서 범위를 구해 이스케이프(HTML 안전).

## 6. UI 요소(주요 id)
`pdfInput, optRuled, optBorderless, optKeepBoth, docList, resultList, readerBox, pageIndicator, pageJump, tocDrawerBox, engineBadge(클릭=추출 보고서), reportModal/reportBody, parseModal/parseBar/parseStat(진행·중단 `app.cancelParsing`), pasteModal`. 원본의 "엔진 설정(Base64 붙여넣기)" 모달은 내장 방식으로 대체되어 제거.
- 리더: 표는 실제 `<table class="rtbl">`, 복사 버튼은 탭 구분(엑셀/한글 표로 붙여넣기).
- 암호 PDF: `task.onPassword` → `window.prompt`(취소 시 문서 파기, 원본 뷰어 안내).

## 7. 테스트 방법 (이 컨테이너에서)
```
apt-get install -y fonts-nanum fonts-noto-cjk; pip install reportlab pypdf       # 합성 PDF 용
cd <작업폴더> && npm i pdfjs-dist@3.11.174                                       # Node 추출 테스트용
python3 pdf-tools/tests/gen_pdfs.py <PDF폴더>
NODE_PATH=$PWD/node_modules node pdf-tools/tests/extract.test.js <PDF폴더>       # 레이아웃(정답 대조, 1300쪽)
LANG=C.UTF-8 NODE_PATH=... node pdf-tools/tests/e2e.test.js <PDF폴더>            # 브라우저 종단 간
LANG=C.UTF-8 NODE_PATH=... node pdf-tools/tests/e2e-extra.test.js <PDF폴더>      # 무거운 표/암호/중단/쪽 실패
```
- 합성 PDF: 선 표(셀 내 줄바꿈), 선 없는 표, 병합 셀, 빈 쪽, 이미지 쪽, 회전(/Rotate 90) 쪽, HWP식 글자 단위 인쇄+이중 인쇄, 쪽 테두리+머리말 선, 1300쪽(빈 260/이미지 80/표 87), 300쪽×(45×6 격자), 암호 PDF.
- 결과(2026-11-17): 전부 통과. 1300쪽 추출 ≈ 2.3초(headless, 단순 쪽), 300쪽 무거운 표 ≈ 3.0초, 외부 네트워크 요청 0건, 저장본(깨끗한 브라우저)에서 1300쪽 복원·검색 정상.
- **함정**: reportlab `setPageRotation` 은 이후 쪽의 텍스트가 사라지는 문제 → pypdf 로 회전. 한글 파일명 업로드는 버퍼(`{name,buffer}`)로. C 로케일에서는 다운로드명이 `download` 로 보임(`LANG=C.UTF-8`).

## 8. 한계 / 미검증 / 향후
- **실제 사용자 PDF 는 한 번도 못 돌려봄**(합성 PDF 만 검증). 사용자가 설명한 증상(빈 쪽·HWP 서식 포함·1300쪽 중 ~800쪽)에 대한 원인은 코드 분석 기반 추정이며, 추출 보고서(쪽수·빈/이미지/실패·글자 깨짐 의심)로 현장에서 확인하도록 설계.
- 스캔본(이미지 쪽)은 텍스트 없음 — OCR 미지원(별도 모듈·한글 데이터 수십 MB 필요).
- 표 복원은 규칙 기반: 병합 셀/복잡한 레이아웃은 100% 아님. 병합된 셀은 첫 칸에만 글자(나머지 빈 칸). 선 없는 표 추정은 오탐 가능(옵션으로 끔).
- 글자 매핑이 깨진 PDF(ToUnicode 없는 폰트, 사설영역 글자)는 추출 불가 → 보고서 경고 → 원본 뷰어 복붙.
- 줄바꿈이 어절 중간인 PDF 는 셀/문단에서 공백이 들어갈 수 있으나 검색은 공백 무시라 영향 적음.
- 향후 후보: 머리글·바닥글(반복 줄) 제거, OCR, 쪽별 재추출 버튼, 추출 옵션 문서별 기억.
