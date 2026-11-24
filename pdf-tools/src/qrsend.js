/* ==========================================================================
   QRSEND: 검색기 안에 내장된 QR 전송 (별도 송신기 불필요)
   [📡 QR로 전송] → 전송용 JSON(+선택: 검색 전용 HTML) 생성·압축 → 자동으로 연속 QR 재생
   프레임 포맷·분수 코드·스케줄은 QX(core.js) 그대로 — 수신기(qr-receiver.html)와 호환
   ========================================================================== */
var QRSEND = (function () {
    var $ = function (id) { return document.getElementById(id); };
    var S = {
        token: 0, archive: null, sha: null, sid: 0, src: null, cfg: null,
        playing: false, paused: false, hz: 60, hzDone: false, tc: 0, curTicks: 6,
        mask: {}, sent: 0, mode: 'send', calib: null, lastFrames: null
    };

    function fmtSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
    }
    function fmtTime(sec) {
        sec = Math.round(sec);
        var m = Math.floor(sec / 60), s = sec % 60;
        if (m >= 60) return Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
        return m > 0 ? (m + '분 ' + s + '초') : (s + '초');
    }
    function save(key, val) { try { localStorage.setItem('PDFSEARCH_QR_' + key, String(val)); } catch (e) { } }
    function load(key, def) { try { var v = localStorage.getItem('PDFSEARCH_QR_' + key); return v === null ? def : v; } catch (e) { return def; } }

    /* ---------- 주사율 측정(프레임 간격을 갱신 주기의 정수배로) ---------- */
    function measureHz() {
        if (S.hzDone) return;
        S.hzDone = true;
        var ts = [];
        function step(t) {
            ts.push(t);
            if (ts.length < 45) { requestAnimationFrame(step); return; }
            var d = [];
            for (var i = 6; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
            d.sort(function (a, b) { return a - b; });
            var hz = Math.round(1000 / d[Math.floor(d.length / 2)]);
            if (hz >= 30 && hz <= 360) S.hz = hz;
            updateEstimate();
        }
        requestAnimationFrame(step);
    }
    function ticksFor(fps) { return Math.max(1, Math.round(S.hz / fps)); }
    function effFps(fps) { return S.hz / ticksFor(fps); }

    /* ---------- 설정 ---------- */
    function getCfg() {
        var ver = parseInt($('qrPreset').value, 10) || 18;
        if (ver === 23) ver = 24;
        var ecl = 'L';
        var fps = Math.max(1, Math.min(30, parseInt($('qrFps').value, 10) || 10));
        var frameBytes = QX.QR.maxFrameBytes(ver, ecl, false);
        return {
            ver: ver, ecl: ecl, fps: fps, eff: effFps(fps), B: frameBytes - QX.FRAME_OVERHEAD, frameBytes: frameBytes,
            segSize: 524288, loss: parseFloat($('qrLoss').value) || 0.1
        };
    }
    function makeSource(cfg) {
        var src = new QX.FrameSource(S.archive, { sid: S.sid, sha: S.sha, B: cfg.B, segSize: cfg.segSize, loss: cfg.loss, manual: false, loopAll: true, metaEvery: 40 });
        var pl = QX.parseSegList($('qrPlaylist').value, src.segCount);
        if (pl.length) src.setPlaylist(pl);
        return src;
    }
    function updateEstimate() {
        var cfg = getCfg();
        var box = $('qrEstimate');
        if (!box) return;
        var perSec = cfg.B * cfg.eff * (1 - cfg.loss) / 1024;
        var html = '프레임 <b>' + cfg.B + ' B</b> · 실제 <b>' + cfg.eff.toFixed(1) + ' fps</b> · 유효 약 <b>' + perSec.toFixed(1) + ' KB/s</b>';
        if (S.archive) {
            var src = makeSource(cfg);
            var frames = src.estimateFrames();
            html += '<br>전송 데이터 <b>' + fmtSize(S.archive.length) + '</b> · 예상 소요 <b>' + fmtTime(frames / cfg.eff) + '</b> (1회차)';
        }
        box.innerHTML = html;
        $('qrWarn').textContent = cfg.ver >= 24 ? 'V24 이상은 QR이 매우 촘촘합니다. 수신이 불안하면 [속도 보정 테스트]로 폰에서 읽히는 설정을 확인하세요.' : '';
    }

    /* ---------- QR 그리기 ---------- */
    function stageBox() {
        var st = $('qrStage');
        var dpr = window.devicePixelRatio || 1;
        return Math.max(200, Math.floor(Math.min(st.clientWidth, st.clientHeight - 30) * dpr));
    }
    function encodeQR(bytes, ver, ecl) {
        var key = ver + ecl;
        var mc = S.mask[key] || (S.mask[key] = { mask: undefined, n: 0 });
        var opts = { mode: 'alnum', ver: ver, ecl: ecl };
        if (mc.mask !== undefined && mc.n % 20 !== 0) opts.mask = mc.mask;   // 마스크 평가는 20프레임마다 1회
        var qr = QX.QR.encode(QX.frameToText(bytes), opts);
        mc.mask = qr.mask; mc.n++;
        return qr;
    }
    function draw(bytes, ver, ecl) { QX.drawQR($('qrCanvas'), encodeQR(bytes, ver, ecl), stageBox()); }

    /* ---------- 재생 루프 ---------- */
    function setStatus(txt, bar) {
        $('qrStatus').textContent = (S.paused ? '⏸ 일시정지 · ' : '') + txt;
        $('qrStageInfo').textContent = txt;
        if (bar !== undefined) $('qrBar').style.width = (Math.max(0, Math.min(1, bar)) * 100).toFixed(1) + '%';
    }
    function sendStep() {
        var fr = S.src.next();
        if (!fr) { S.playing = false; return; }
        S.sent++;
        draw(fr.bytes, S.cfg.ver, S.cfg.ecl);
        var src = S.src;
        var target = src.visitTarget(src.cur);
        var overall = (src.oi + Math.min(1, isFinite(target) ? src.visitSent / target : 0)) / src.list().length;
        var pass = src.pass + 1;
        var txt = '구간 ' + (src.cur + 1) + '/' + src.segCount + ' · ' + pass + '회차' + (src.order ? ' (지정 구간만)' : '') + ' · 누적 ' + S.sent.toLocaleString() + '프레임' +
            (pass > 1 ? ' — 수신기에서 "수신·검증 완료"가 뜨면 닫으세요' : '');
        setStatus(txt, overall);
    }
    var CAL = [
        { v: 12, f: 10 }, { v: 18, f: 10 }, { v: 18, f: 15 }, { v: 24, f: 10 }, { v: 24, f: 15 }, { v: 30, f: 10 }, { v: 30, f: 15 }
    ];
    var CAL_SEC = 7;
    function calibEnter(i) {
        var c = S.calib, L = CAL[i];
        c.idx = i; c.seq = 0; c.n = 0;
        c.F = QX.QR.maxFrameBytes(L.v, 'L', false);
        c.ticks = ticksFor(L.f); c.eff = S.hz / c.ticks;
        c.shows = Math.max(8, Math.round(CAL_SEC * c.eff));
        S.curTicks = c.ticks;
    }
    function calibStep() {
        var c = S.calib;
        if (c.n >= c.shows) {
            if (c.idx + 1 >= CAL.length) {
                S.playing = false;
                setStatus('✅ 보정 테스트 완료 — 폰 수신기의 [속도 측정 결과]에서 추천 설정을 확인하고 이 창의 고급 설정에 적용하세요', 1);
                return;
            }
            calibEnter(c.idx + 1); c = S.calib;
        }
        var L = CAL[c.idx];
        draw(QX.makeCalibFrame(c.F, L.v, Math.round(c.eff), 0, 0, c.seq++ & 0xFFFF), L.v, 'L');
        c.n++;
        setStatus('📶 보정 테스트 ' + (c.idx + 1) + '/' + CAL.length + ' · V' + L.v + ' · ' + c.eff.toFixed(1) + 'fps — 폰으로 비추세요', (c.idx + c.n / c.shows) / CAL.length);
    }
    function tick() {
        if (!S.playing) return;
        requestAnimationFrame(tick);
        if (S.paused) return;
        S.tc++;
        if (S.tc < S.curTicks) return;
        S.tc = 0;
        if (S.mode === 'calib') calibStep(); else sendStep();
    }
    function startPlay() {
        S.mode = 'send';
        S.cfg = getCfg();
        S.curTicks = ticksFor(S.cfg.fps);
        S.src = makeSource(S.cfg);
        S.sent = 0; S.paused = false; S.playing = true; S.tc = 1e9;
        $('qrStage').className = 'qr-stage live';
        $('qrPause').textContent = '⏸ 일시정지';
        $('qrPause').disabled = false;
        requestAnimationFrame(tick);
    }
    function stopPlay() { S.playing = false; }

    /* ---------- 전송 파일 준비(압축) ---------- */
    function prepare() {
        var my = ++S.token;
        stopPlay();
        $('qrStage').className = 'qr-stage';
        $('qrPause').disabled = true;
        $('qrHint').textContent = '전송 파일을 만드는 중…';
        $('qrBar').style.width = '0';
        S.archive = null;
        return app.buildTransferFiles({ viewer: $('qrViewer').checked }).then(function (pack) {
            if (my !== S.token) return;
            if (!pack) { $('qrHint').textContent = '체크된 매뉴얼이 없습니다. 좌측 목록에서 전송할 매뉴얼을 체크한 뒤 다시 여세요.'; return; }
            $('qrSummary').innerHTML = pack.summary;
            var entries = [], chain = Promise.resolve();
            pack.files.forEach(function (f, i) {
                chain = chain.then(function () {
                    return QX.packFile(f.name, f.u8, f.mtime, function (p) {
                        if (my === S.token) $('qrHint').textContent = '압축 중… ' + f.name + ' ' + Math.round(p * 100) + '%';
                    }).then(function (e) { entries.push(e); });
                });
            });
            return chain.then(function () {
                if (my !== S.token) return;
                S.archive = QX.buildArchive(entries);
                return QX.sha256(S.archive);
            }).then(function (sha) {
                if (my !== S.token || !sha) return;
                S.sha = sha;
                S.sid = new DataView(sha.buffer, sha.byteOffset, 4).getUint32(0, false);
                var raw = 0;
                pack.files.forEach(function (f) { raw += f.u8.length; });
                $('qrHint').textContent = '준비 완료: ' + fmtSize(raw) + ' → 전송 ' + fmtSize(S.archive.length) + ' (세션 ' + S.sid.toString(16).toUpperCase() + ')';
                updateEstimate();
                startPlay();
            });
        }).catch(function (e) {
            console.error(e);
            $('qrHint').textContent = '오류: ' + (e && e.message ? e.message : e);
        });
    }

    /* ---------- 공개 동작 ---------- */
    function open() {
        $('qrModal').classList.add('open');
        $('qrPreset').value = load('preset', '18');
        $('qrFps').value = load('fps', '10');
        $('qrLoss').value = load('loss', '0.1');
        measureHz();
        updateEstimate();
        prepare();
    }
    function close() {
        S.token++; stopPlay();
        $('qrModal').classList.remove('open');
        if (document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch (e) { } }
    }
    function togglePause() {
        if (!S.playing && S.src && S.mode === 'send') { // 종료된 경우 다시 시작
            S.src.finished = false; S.src.jump(S.src.list()[0]); S.playing = true; S.paused = false; S.tc = 1e9; requestAnimationFrame(tick);
            return;
        }
        S.paused = !S.paused;
        $('qrPause').textContent = S.paused ? '▶ 재개' : '⏸ 일시정지';
    }
    function fullscreen() {
        var st = $('qrStage');
        var f = st.requestFullscreen || st.webkitRequestFullscreen || st.msRequestFullscreen;
        if (f) f.call(st);
    }
    function restart() { prepare(); }
    function startCalib() {
        stopPlay();
        S.mode = 'calib';
        S.calib = { idx: 0, seq: 0, n: 0 };
        calibEnter(0);
        S.paused = false; S.playing = true; S.tc = 1e9;
        $('qrStage').className = 'qr-stage live';
        $('qrPause').disabled = false;
        requestAnimationFrame(tick);
    }
    function onOptionChange(id) {
        if (id === 'qrPreset') save('preset', $('qrPreset').value);
        if (id === 'qrFps') save('fps', $('qrFps').value);
        if (id === 'qrLoss') save('loss', $('qrLoss').value);
        updateEstimate();
        if (id === 'qrViewer') { prepare(); return; }
        if (S.src && S.playing && S.mode === 'send') {
            var c = getCfg();
            if (id === 'qrFps') { S.cfg.fps = c.fps; S.cfg.eff = c.eff; S.curTicks = ticksFor(c.fps); }
            if (id === 'qrLoss') S.src.loss = c.loss;
            if (id === 'qrPlaylist') S.src.setPlaylist(QX.parseSegList($('qrPlaylist').value, S.src.segCount));
            if (id === 'qrPreset') startPlay();   // 프레임 크기가 바뀌므로 처음부터 다시 (수신기는 새 세션으로 인식하지 않고 이어받음)
        }
    }

    return { open: open, close: close, togglePause: togglePause, fullscreen: fullscreen, restart: restart, startCalib: startCalib, onOptionChange: onOptionChange, state: S };
})();
