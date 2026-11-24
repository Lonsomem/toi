# 오프라인 QR 파일 전송 개발 메모

> **2026-11-17 구조 변경**: 별도 송신기(`qr-sender.html`)는 **제거**했다. 송신은 `pdf-manual-search.html` 의 **[📡 QR로 전송]** 에 내장(`pdf-tools/src/qrsend.js`)되어 체크한 매뉴얼을 전송용 JSON 으로 만들어 압축·자동 재생한다. 수신기(`qr-receiver.html`)는 유지·단순화(카메라 시작 → 완료 시 파일 1개면 **자동 저장**).
> 아래 내용 중 "송신기 UI" 절은 이 내장 송신 모듈 기준으로 읽을 것. 프레임 포맷·오류 복구·스케줄·수신기는 그대로다.
> 임의 파일(사건노트 HTML 등)을 QR 로 보내는 기능은 현재 없다(필요하면 `qrsend.js` 의 파일 구성부(`app.buildTransferFiles`)만 교체하면 됨).

PC 화면에 연속 QR 을 재생(송신) → 폰 카메라로 받아(수신) 원본 파일로 복원. **사건 관리 노트와 코드 독립**. 임의 파일(한글 파일명·PDF 등) 여러 개 전송.
최대 규모 요구: ~34,000KB. PC 브라우저: **구형 Chrome/Edge**. 폰: 저장한 HTML 을 `file://` 로 열어 사용.

## 1. 파일/빌드
```
qr-tools/src/core.js               공통 코어 QX (CRC/SHA/Base45/DEFLATE/아카이브/프레임/오류복구/Assembler) — 검색기 빌드도 포함
qr-tools/src/qr-encoder.js         QR 인코더 + 캔버스 그리기(drawQR; RGB 용 drawQR3 는 UI 에서 더 이상 사용 안 함) — 검색기 빌드도 포함
qr-tools/src/receiver.template.html / receiver-ui.js   수신기 (→ 루트 qr-receiver.html)
qr-tools/vendor/jsQR.js            jsQR 1.4.0 (Apache-2.0), 수신기에만 인라인
qr-tools/build.py                  수신기만 빌드
pdf-tools/src/qrsend.js            송신 모듈 QRSEND (검색기에 내장)
qr-tools/tests/*                   단위 테스트(core/qr-encoder/rgb/fountain)
pdf-tools/tests/e2e-transfer*.test.js   송신(검색기)→수신기 종단 간 / 영상 폴백
```
- 수정: core.js·qr-encoder.js 변경 시 `python3 qr-tools/build.py` **와** `python3 pdf-tools/build.py` 둘 다.
- **UI 코드 문법 제약**: 구형 브라우저 호환(`?.`/`??` 금지). core.js 는 `const QX = {}` 전역.
- 테스트 후크: `QRSEND.state`(송신 상태), `window.__qrxRecv`(`{R, onFrame}`).

## 2. 전체 파이프라인
```
[송신] 파일들 → (선택) 사진 축소 → packFile(개별 압축 판단) → buildArchive → SHA-256
       → 구간(segment)으로 분할 → FrameSource 가 프레임(바이트) 생성 → 'QX'+Base45+'.' → QR(영숫자) → 캔버스 재생
[수신] 카메라/영상 프레임 → BarcodeDetector 또는 jsQR → decodeScanned → Assembler.ingest
       → 구간 복원(SegmentDecoder) → 전체 조립 → SHA-256 검증 → unpackArchive(해제+CRC32) → 다운로드/ZIP
```

## 3. 한글/바이너리 무결성 (최우선 요구)
- 파일 내용은 `Uint8Array` 로만 취급, 문자열 변환 없음. 파일명·아카이브 헤더 JSON 은 `TextEncoder/TextDecoder`(UTF-8).
- 검증 3단: 프레임 CRC32 → 전체 SHA-256(`QX.sha256`: `crypto.subtle` 가능하면 사용, `file://` 등에서 불가하면 순수 JS `sha256js`) → 파일별 CRC32.
- 다운로드: `a.download = 원래 파일명`. ZIP(`buildZip`)은 무압축 + 파일명 UTF-8 플래그(0x0800).
- (참고) 헤드리스 Chromium 을 C 로케일로 돌리면 한글 파일명이 `download` 로 보인다 — 환경 문제. `LANG=C.UTF-8` 로 검증하면 정상.

## 4. 아카이브 포맷 (`buildArchive` / `parseArchiveHeader`)
`'QXA1'(4B) | headerLen(u32 BE) | header JSON(UTF-8) | 파일1 데이터 | 파일2 데이터 …`
header = `{v:1, files:[{n:이름, s:원본크기, c:저장크기, m:0저장|1deflate, crc:CRC32, t:mtime}]}`
- `packFile`: 앞 256KB 샘플을 압축해 비율 < 0.95 이면 전체 압축, 결과가 원본의 98% 미만일 때만 `m=1`. 아니면 원본 그대로(PDF·JPEG·ZIP·HWPX 등은 대부분 원본 그대로).
- 압축: 브라우저 `CompressionStream('deflate-raw')` 가능하면 사용, 아니면 자체 구현 `QX.deflate`(해시체인 LZ77 + 동적 허프만, 비동기로 UI 양보). 해제: `DecompressionStream` → 실패 시 자체 `QX.inflateRaw`.

## 5. 프레임 포맷 (모든 정수 BE)
- 공통 byte0: `(ver=1) | bit7 layered`(RGB 3층 전송 중이면 0x81). byte1: type.
- **데이터** (type 1, 총 B+16B): `[b0][1][sid u32][seg u16][sym u32][payload B][crc32 u32]`
- **메타** (type 0, 55B): `[b0][0][sid][total u32][segSize u32][B u16][segCount u16][flags u8][sha256 32B][crc32]` (flags bit0 = 암호화 예약, 미구현)
- **보정** (type 2, 가변): `[b0][2][ver][fps][ecl 0L/1M][mode 0흑백/1RGB][seq u16][패딩…][crc32]`
- `sid` = 전체 SHA-256 앞 4바이트 → 같은 파일 재전송 시 같은 세션(이어받기).
- 문자열화: `'QX' + Base45(frame) + '.'` (QR 영숫자 모드, 효율 ≈97%). 앞뒤 고정 문자는 끝 공백 트림 방지·타 QR 구분용. 바이트 모드(`'QB'`+원시)는 코드에 있으나 **UI 미노출**(이득 3%뿐, BarcodeDetector 는 바이너리 불가).
- 프레임 크기: `QX.QR.maxFrameBytes(ver, ecl, false)`; `B = frameBytes - 16`. V12→B338, V18→679, V24→1118, V30→1662 (ECC L).

## 6. 오류 복구 부호 (구간 단위, `core.js`)
- 구간(기본 512KB)을 B바이트 블록 K개로 분할. 마지막 블록은 0 패딩, `segLen` 으로 자름.
- 심볼 id < K : 원본 블록 그대로(시스테매틱). id ≥ K : 블록 전체의 **무작위 부분집합(각 1/2)의 XOR**(복구 조각). 부분집합은 `symbolIndices(K, seg, id)`(카운터 기반 해시 `fmix32`로 결정적 생성; 송·수신 동일해야 함 → **함수 변경 시 호환 깨짐**).
- 수신 `SegmentDecoder`: 시스테매틱은 즉시 반영, 복구 조각은 행으로 저장 → 행 수 ≥ (미지 블록 수 u)+3 이면 GF(2) 가우스-조던 소거(`gauss`). **가장 최근 `u+40` 행** 사용(과거 버그: 앞쪽 행만 쓰면 부분 해결 후 정체), 실패 시 `max(4, u/50)` 행 뒤 재시도. 수신 프레임 ≈ **K×1.00~1.02** 로 복원(손실률과 무관 — 손실은 시간만 늘림).
- 교훈: xorshift/mulberry 같은 순차 PRNG 로 부분집합을 만들면 GF(2) 선형성·상관으로 행렬 랭크가 부족해 복원 불가(실제로 겪음). 반드시 카운터 기반 해시.

## 7. 송신 스케줄 (`FrameSource`)
- 옵션: `loss`(예상 손실률, 기본 0.10), `manual`(수동 구간 전환), `loopAll`, `metaEvery`(40), `layered`.
- 1회차(pass 0): 구간마다 `ceil(K/(1-loss)) + 3` 프레임. 2회차~: 구간마다 `ceil(0.15K)+4` 프레임의 **새 복구 조각만**(`segNext[seg]` 카운터가 계속 증가해 id 중복 없음).
- `setPlaylist([...])`: 특정 구간만 재전송(수신기 `미완료 구간` 표시 `Assembler.missingText()` → 송신기 입력 `parseSegList('3,5-7')`).
- 메타 프레임을 구간 시작 시 + `metaEvery` 프레임마다 삽입(수신기가 아무 때나 합류 가능).
- `estimateFrames()`: 1회차 총 프레임 추정(UI 예상 시간용).

## 8. 송신 모듈 (`pdf-tools/src/qrsend.js`, 검색기 내장)
- 흐름: `QRSEND.open()` → `app.buildTransferFiles({viewer})` → 각 파일 `QX.packFile`(JSON 은 deflate) → `QX.buildArchive` → SHA-256(세션 id = 앞 4바이트) → 자동 `startPlay()`. 닫기 전까지(수신 완료 때까지) 계속 재생(보충 조각).
- **전송 대상**: 좌측 목록에서 **체크된** 매뉴얼. 파일 1: `매뉴얼색인_YYYYMMDD_HHmm_N권.json`(슬림 JSON, 형식은 `docs/pdf-search.md` 9절). 옵션 `#qrViewer`: + `PDF검색기_검색전용.html`(엔진 제외, 색인 비움 ≈ 0.2MB).
- 고급(접힘): QR 크기 프리셋 V12/18/24/30(기본 V18), 초당 프레임(기본 10), 예상 손실률(기본 10%), **재전송 구간**(수신기 `미완료 구간` 입력), **📶 속도 보정 테스트**(V12~V30 × 10/15fps 7단계 각 7초; 수신기가 표로 추천). 설정은 localStorage `PDFSEARCH_QR_*` 에 기억. QR 크기를 바꾸면 수신기에서 `수신 초기화` 필요(B 가 달라짐).
- **타이밍**: `measureHz()`(rAF 45회 중앙값) → `ticks = round(Hz/fps)` 정수배로 프레임 교체. 마스크 평가는 20프레임마다 1회.
- 제거된 것: 임의 파일 선택/드롭, 사진 축소, RGB 3층 UI, 구간 전환 수동 모드, 구간 이동 버튼(필요 시 재전송 구간 입력으로 대체). 코어(`QX.FrameSource` 의 manual/layered, `drawQR3`)에는 남아 있음.

## 9. 수신기 UI (`receiver-ui.js`)
- 입력: ① 카메라(`getUserMedia`, 후면, 1080p 이상 요청, 손전등/WakeLock 가능 시) ② **영상 파일 폴백**(폰 카메라앱으로 송신 화면 촬영 → 파일 선택, 재생속도 0.25~1배, `requestVideoFrameCallback`).
- 디코딩 `scan()` → 프레임 바이트 **배열** 반환. 색상 모드 `colorMode`(자동/흑백/RGB), 엔진 `engine`(자동/jsQR/BarcodeDetector).
  - 흑백: BarcodeDetector 우선 + 3회에 1번 jsQR 보조(1280px, 연속 실패 4/5회마다 1920px).
  - RGB: jsQR 로 채널 R/G/B 를 회색조 RGBA 로 변환해 각각 디코딩.
  - 자동: 프레임 헤더 `layered` 플래그를 읽는 즉시 `R.detected` 확정(과거 버그: RGB 합성 이미지는 휘도상 G 층만 남아 흑백 경로가 1/3 만 읽고 "흑백"으로 오판).
- `QX.Assembler`: 첫 메타로 세션 확정, 다른 세션 프레임은 `other`(배너+전환 버튼). `ingest` 결과 kind: `meta|sym|segdone|dup|wait|other|bad|calib`.
- **이어받기**: IndexedDB `qrx-recv`/store `segs`, 키 `"{sid hex}:{segSize}:{B}:{total}:{seg}"`, 값 = 완료 구간 바이트. 완료 후 삭제.
- 완료 처리: `finalize()`(SHA-256 → `unpackArchive`) → 파일별 다운로드, 전체 ZIP, `.html` 파일에는 `사건노트 JSON 추출` 버튼(`QX.extractCaseNoteJson`: `#embedded-db-b64` 디코딩 → version 1 JSON).
- 구간 0 완료 시 `peekFiles()` 로 파일 목록 미리 표시. 구간 격자(`segGrid`), 예상 남은 시간, 미완료 구간 문자열.

## 10. 측정/검증된 사실 (이 컨테이너, headless Chromium)
- QR 인코더: jsQR 로 V1~40 × ECC L/M × 영숫자/바이트 160케이스 중 V23-L 2건 실패(jsQR 한계, OpenCV 정상).
- 단위: SHA-256·DEFLATE(zlib 양방향 교차)·Base45·아카이브·ZIP(파이썬 zipfile 확인) 통과. 34MB 무압축 판단 0.1s, 순수 JS SHA-256 34MB 0.2s.
- 종단 간(송신 UI→QR 렌더→jsQR→수신, 프레임 20% 임의 손실): 한글명 PDF류/텍스트/사건노트 HTML 바이트 동일, ZIP·JSON 추출 정상, 흑백·RGB(채널 디코딩) 모두 통과. 사진 4.4MB → 588KB(1600×1200).
- 영상 폴백(VP9 녹화): 흑백 복원 성공, **RGB 는 실패**(손실 압축이 색 해상도를 깎음). 실제 폰 카메라 라이브에서 RGB 가 되는지는 **미검증** → 보정 테스트 결과로 판단.
- 이론 유효 속도: `B × fps × 층수 × (1-loss)`. 기본(V18,10fps,10%) ≈ 6 KB/s → 3MB 무축소 ≈ 8분, 축소(~500KB) ≈ 1.5분. **실제 폰 카메라 수치는 사용자 측정 대기** (송신기 `📶 속도 보정 테스트`).

## 11. 용량 효과
전송 대상은 텍스트 JSON 이라 deflate 로 크게 줄어듦(실측: 1308쪽 합성 문서 JSON 222KB). 압축 강화(글자 단위 문맥 모델 등)는 2단계 계획. 사진 축소·PDF 재압축은 송신기 제거와 함께 삭제됨.

## 12. 알려진 이슈/주의
- 폰에서 `file://` 로 열면 브라우저/기기에 따라 `getUserMedia` 가 막힐 수 있음 → 영상 폴백 사용.
- 재생 중 탭 숨기면 rAF 정지로 전송 멈춤. 폰은 QR 전체가 화면에 들어오게.
- V24 이상·초당 15프레임 이상은 폰 카메라가 못 읽을 수 있음(보정 테스트로 확인).
- 수정 후 반드시: 빌드 → `qr-tools/tests` 중 core/qr-encoder/e2e 실행(README 참고).

## 13. 향후 후보
PDF 스캔본 재압축, 웹캠 기반 수신 완료 피드백(양방향), 전송 암호(헤더 flags 예약), 보정 결과를 송신기 설정에 자동 반영.
