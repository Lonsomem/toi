// 영상 파일 폴백: 검색기 QR 전송 화면을 MediaRecorder 로 녹화 → 수신기에 영상 파일로 입력 → JSON 자동 복원
// 사용: LANG=C.UTF-8 node e2e-transfer-video.test.js
const { chromium } = require('playwright');
const crypto = require('crypto');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 850 }, acceptDownloads: true });
  const A = await ctx.newPage(); const errs = []; A.on('pageerror', e => errs.push(e.message));
  await A.goto('file:///home/user/toi/pdf-manual-search.html');
  await A.waitForFunction(() => app.docs.length >= 2, null, { timeout: 30000 });   // 샘플 문서 2권 사용
  await A.evaluate(() => { document.getElementById('qrFps').value = '10'; document.getElementById('qrPreset').value = '12'; });
  await A.evaluate(() => QRSEND.open());
  await A.waitForFunction(() => QRSEND.state.playing, null, { timeout: 60000 });
  await A.evaluate(() => { const c = document.getElementById('qrCanvas'); window.__chunks = []; const mr = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 }); mr.ondataavailable = e => window.__chunks.push(e.data); mr.start(200); window.__mr = mr; });
  await A.waitForTimeout(14000);
  const b64 = await A.evaluate(async () => { window.__mr.stop(); await new Promise(r => setTimeout(r, 500)); const buf = await new Blob(window.__chunks, { type: 'video/webm' }).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); });
  const vid = Buffer.from(b64, 'base64'); console.log('녹화 영상', (vid.length / 1048576).toFixed(1), 'MB');
  const B = await ctx.newPage(); B.on('pageerror', e => errs.push('recv ' + e.message));
  await B.goto('file:///home/user/toi/qr-receiver.html');
  const dlP = B.waitForEvent('download', { timeout: 150000 }).catch(() => null);
  await B.evaluate(() => { document.querySelector('details.card').open = true; });
  await B.selectOption('#vrate', '0.5');
  await B.setInputFiles('#videoFile', { name: '촬영.webm', mimeType: 'video/webm', buffer: vid });
  const dl = await dlP;
  ok(!!dl, '영상 입력만으로 복원·자동 저장');
  if (dl) { const fs = require('fs'); await dl.saveAs('/tmp/pdf_video.json'); const j = JSON.parse(fs.readFileSync('/tmp/pdf_video.json', 'utf8')); ok(j.kind === 'pdf-manual-index' && j.docs.length >= 2, '영상으로 받은 JSON: 매뉴얼 ' + j.docs.length + '권'); }
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  console.log('fails', fails); await b.close(); process.exit(fails ? 1 : 0);
})();
