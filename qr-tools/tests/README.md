# qr-tools 테스트 (수동 실행용 스크립트)

> 송신기 제거(2026-11-17)로 송신기 UI 기반 e2e 테스트는 삭제했다. 송신→수신 종단 간 테스트는 `pdf-tools/tests/e2e-transfer*.test.js` 를 사용.

준비: `cd qr-tools/tests && npm init -y && npm i jsqr` (Playwright 는 환경에 설치돼 있음)
한글 파일명/다운로드 이름 검증은 **UTF-8 로케일 필수**: `LANG=C.UTF-8 LC_ALL=C.UTF-8 node ...`
(C 로케일에서는 Playwright 가 한글 경로/다운로드명을 못 다뤄 `download` 로 보이는 것이 정상 — 앱 버그 아님)

| 파일 | 내용 |
|---|---|
| `core.test.js` | CRC/SHA/Base45/DEFLATE(zlib 교차검증)/아카이브/프레임·스케줄/CalibStats |
| `qr-encoder.test.js` | QR 인코더를 jsQR 로 전 버전·ECC·모드 디코딩 (V23-L 2건 실패는 jsQR 한계, OpenCV 로는 정상) |
| `rgb.test.js` | RGB 3층 합성 → 색 번짐/노이즈/블러 → 채널별 디코딩 |
| `fountain.test.js` | 손실률별 구간 복원 효율 (수신 프레임/K ≈ 1.00~1.02 가 정상) |
| `make-saved-note.js` | case-note.html 저장본을 `/tmp/qrt_files/saved_note.html` 로 생성(과거 e2e 용; 현재 사용처 없음) |

테스트 파일 상단의 절대경로(`/home/user/toi/...`)는 환경에 맞게 조정.
