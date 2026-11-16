# qr-tools 테스트 (수동 실행용 스크립트)

준비: `cd qr-tools/tests && npm init -y && npm i jsqr` (Playwright 는 환경에 설치돼 있음)
한글 파일명/다운로드 이름 검증은 **UTF-8 로케일 필수**: `LANG=C.UTF-8 LC_ALL=C.UTF-8 node ...`
(C 로케일에서는 Playwright 가 한글 경로/다운로드명을 못 다뤄 `download` 로 보이는 것이 정상 — 앱 버그 아님)

| 파일 | 내용 |
|---|---|
| `core.test.js` | CRC/SHA/Base45/DEFLATE(zlib 교차검증)/아카이브/프레임·스케줄/CalibStats |
| `qr-encoder.test.js` | QR 인코더를 jsQR 로 전 버전·ECC·모드 디코딩 (V23-L 2건 실패는 jsQR 한계, OpenCV 로는 정상) |
| `rgb.test.js` | RGB 3층 합성 → 색 번짐/노이즈/블러 → 채널별 디코딩 |
| `fountain.test.js` | 손실률별 구간 복원 효율 (수신 프레임/K ≈ 1.00~1.02 가 정상) |
| `make-saved-note.js` | case-note.html 저장본을 `/tmp/qrt_files/saved_note.html` 로 생성 (e2e-mono 선행 필요) |
| `e2e-mono.js` | 송신기 UI → QR 렌더 → jsQR → 수신기(20% 손실) → 4개 파일·ZIP·JSON 추출 (사전에 `/tmp/qrt_files` 생성: make-saved-note.js 가 만들어 줌) |
| `e2e-modes.js <mono\|rgb\|photo\|calib>` | 모드별 종단 간 테스트 |
| `e2e-video.js [rgb]` | 송신 화면을 MediaRecorder 로 녹화 → 수신기 영상 폴백. (rgb 는 손실 압축 때문에 실패하는 것이 정상) |

테스트 파일 상단의 절대경로(`/home/user/toi/...`)는 환경에 맞게 조정.
