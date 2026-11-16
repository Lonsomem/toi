# qr-tools

오프라인 QR 파일 전송 도구의 소스. 결과물은 저장소 루트의 단일 HTML 두 개입니다.

- `qr-sender.html`  : PC용 송신기 (파일 → 압축 → 연속 QR 재생)
- `qr-receiver.html`: 폰용 수신기 (카메라/영상 → 복원 → 다운로드)

수정은 `qr-tools/src/` 에서 하고 `python3 qr-tools/build.py` 로 다시 빌드합니다.
`vendor/jsQR.js` 는 jsQR(Apache-2.0) 원문이며 수신기에만 포함됩니다.
