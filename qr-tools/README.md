# qr-tools

오프라인 QR 전송의 **수신기 소스와 공유 코어**.

- `qr-receiver.html` (루트): 폰/웹캠 PC 용 수신기. 소스: `src/receiver.template.html`, `src/receiver-ui.js` (+ `vendor/jsQR.js`)
- `src/core.js`, `src/qr-encoder.js`: 송신(검색기 `pdf-manual-search.html` 의 [📡 QR로 전송])과 수신이 함께 쓰는 코어. **수정하면 `python3 qr-tools/build.py` 와 `python3 pdf-tools/build.py` 를 모두 다시 실행.**
- 송신 모듈은 `pdf-tools/src/qrsend.js` (별도 송신기 파일은 없음).

자세한 내용: `docs/qr-transfer.md`
