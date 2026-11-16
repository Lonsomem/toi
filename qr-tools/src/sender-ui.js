/* ===================== 송신기 UI (구형 Chrome/Edge 호환 문법만 사용) ===================== */
(function () {
    var $ = function (id) { return document.getElementById(id); };
    var S = {
        files: [], entries: null, archive: null, sha: null, sid: 0,
        src: null, playing: false, paused: false, lastTs: 0, sentFrames: 0, lastRender: null,
        preparing: false, cfg: null
    };

    function fmtSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
    }
    function fmtTime(sec) {
        sec = Math.round(sec);
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (h > 0) return h + '시간 ' + m + '분';
        if (m > 0) return m + '분 ' + s + '초';
        return s + '초';
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    /* ---------- 파일 목록 ---------- */
    function addFiles(list) {
        for (var i = 0; i < list.length; i++) S.files.push({ file: list[i], state: '' });
        invalidate();
        renderFiles();
    }
    function renderFiles() {
        var ul = $('fileList');
        ul.innerHTML = '';
        var total = 0;
        S.files.forEach(function (f, i) {
            total += f.file.size;
            var li = document.createElement('li');
            li.innerHTML = '<span class="nm" title="' + esc(f.file.name) + '">' + esc(f.file.name) + '</span><span class="sz">' + fmtSize(f.file.size) + '</span><span class="st">' + esc(f.state) + '</span><button title="제거">✕</button>';
            li.querySelector('button').onclick = function () { if (S.preparing) return; S.files.splice(i, 1); invalidate(); renderFiles(); };
            ul.appendChild(li);
        });
        $('fileSum').textContent = S.files.length ? ('파일 ' + S.files.length + '개 · 원본 합계 ' + fmtSize(total)) : '선택된 파일 없음';
        $('btnPrepare').disabled = !S.files.length || S.preparing;
        $('btnClear').disabled = !S.files.length || S.preparing;
    }
    function invalidate() {
        stopPlay(true);
        S.entries = null; S.archive = null; S.sha = null;
        $('btnPlay').disabled = true;
        $('prepBar').style.width = '0';
        $('prepMsg').textContent = '';
        $('est').textContent = '파일을 준비하면 예상 시간이 표시됩니다.';
        $('warn').className = 'warn';
    }
    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(new Uint8Array(fr.result)); };
            fr.onerror = function () { reject(fr.error || new Error('파일을 읽을 수 없습니다: ' + file.name)); };
            fr.readAsArrayBuffer(file);
        });
    }

    /* ---------- 압축·준비 ---------- */
    function prepare() {
        if (S.preparing || !S.files.length) return Promise.resolve();
        S.preparing = true;
        $('btnPrepare').disabled = true;
        var entries = [], n = S.files.length;
        var chain = Promise.resolve();
        S.files.forEach(function (f, i) {
            chain = chain.then(function () {
                f.state = '읽는 중'; renderFiles();
                return readFile(f.file);
            }).then(function (u8) {
                f.state = '압축 중';
                renderFiles();
                return QX.packFile(f.file.name, u8, f.file.lastModified || 0, function (p) {
                    $('prepBar').style.width = ((i + p) / n * 100).toFixed(1) + '%';
                    $('prepMsg').textContent = '[' + (i + 1) + '/' + n + '] ' + f.file.name + ' 압축 ' + Math.round(p * 100) + '%';
                });
            }).then(function (ent) {
                entries.push(ent);
                f.state = ent.method ? ('압축 ' + fmtSize(ent.data.length)) : '원본 그대로';
                $('prepBar').style.width = ((i + 1) / n * 100).toFixed(1) + '%';
                renderFiles();
            });
        });
        return chain.then(function () {
            $('prepMsg').textContent = '아카이브 생성·해시 계산 중…';
            S.entries = entries;
            S.archive = QX.buildArchive(entries);
            return QX.sha256(S.archive);
        }).then(function (sha) {
            S.sha = sha;
            S.sid = new DataView(sha.buffer, sha.byteOffset, 4).getUint32(0, false);
            var orig = 0;
            S.files.forEach(function (f) { orig += f.file.size; });
            $('prepMsg').textContent = '준비 완료: 원본 ' + fmtSize(orig) + ' → 전송 데이터 ' + fmtSize(S.archive.length) + ' · 세션 ' + S.sid.toString(16).toUpperCase();
            $('btnPlay').disabled = false;
            updateEstimate();
        }).catch(function (e) {
            console.error(e);
            $('prepMsg').textContent = '오류: ' + (e && e.message ? e.message : e);
        }).then(function () {
            S.preparing = false;
            renderFiles();
        });
    }

    /* ---------- 설정 / 예상 ---------- */
    function getCfg() {
        var preset = $('preset').value;
        var ver = preset === 'custom' ? parseInt($('verInput').value, 10) : parseInt(preset, 10);
        if (!(ver >= 5 && ver <= 40)) ver = 18;
        if (ver === 23) ver = 24; // 일부 판독기(jsQR)가 V23을 못 읽는 알려진 문제 회피
        var ecl = $('ecl').value;
        var frameBytes = QX.QR.maxFrameBytes(ver, ecl, false);
        var B = frameBytes - QX.FRAME_OVERHEAD;
        var fps = Math.max(1, Math.min(30, parseInt($('fps').value, 10) || 10));
        return {
            ver: ver, ecl: ecl, B: B, frameBytes: frameBytes, fps: fps,
            segSize: parseInt($('segSize').value, 10), mult: parseFloat($('mult').value),
            manual: $('advance').value === 'manual', loopAll: $('loopAll').checked
        };
    }
    function makeSource(cfg) {
        return new QX.FrameSource(S.archive, {
            sid: S.sid, sha: S.sha, B: cfg.B, segSize: cfg.segSize, mult: cfg.mult,
            manual: cfg.manual, loopAll: cfg.loopAll, metaEvery: 25
        });
    }
    function updateEstimate() {
        var cfg = getCfg();
        $('verInput').disabled = $('preset').value !== 'custom';
        if (!S.archive) {
            $('est').innerHTML = 'QR 버전 <b>V' + cfg.ver + '</b> · 프레임당 데이터 <b>' + cfg.B + ' B</b> · 이론 속도 <b>' + (cfg.B * cfg.fps / 1024).toFixed(1) + ' KB/s</b>';
            return;
        }
        var src = makeSource(cfg);
        var frames = src.estimateFrames();
        var sec = frames / cfg.fps;
        $('est').innerHTML =
            'QR 버전 <b>V' + cfg.ver + '</b> · 프레임당 데이터 <b>' + cfg.B + ' B</b> · 유효 속도 약 <b>' + (cfg.B * cfg.fps / 1024 / cfg.mult).toFixed(1) + ' KB/s</b><br>' +
            '전송 데이터 <b>' + fmtSize(S.archive.length) + '</b> · 구간 <b>' + src.segCount + '</b>개 · 총 프레임 약 <b>' + frames.toLocaleString() + '</b>개<br>' +
            '예상 소요 시간(1회 통과): <b>' + fmtTime(sec) + '</b>';
        var w = [];
        if (S.archive.length > 10 * 1048576) w.push('전송 데이터가 10MB를 넘습니다. 예상 시간이 길어(' + fmtTime(sec) + ') 중간에 끊겨도 완료된 구간은 폰에 저장되고, 같은 파일을 다시 보내면 이어받습니다.');
        if (S.archive.length > 34000 * 1024) w.push('34,000KB(약 33MB)를 넘는 데이터입니다. 파일을 나눠 보내는 것을 권장합니다.');
        if (cfg.ver >= 24) w.push('V' + cfg.ver + ' 이상은 QR이 매우 촘촘합니다. 수신 폰 카메라 해상도·거리에 따라 인식이 어려울 수 있습니다.');
        if (cfg.fps > 12) w.push('초당 ' + cfg.fps + '프레임은 폰 카메라가 놓칠 수 있습니다. 수신이 불안정하면 8~10으로 낮추세요.');
        var wb = $('warn');
        wb.innerHTML = w.map(esc).join('<br>');
        wb.className = 'warn' + (w.length ? ' on' : '');
    }

    /* ---------- 재생 ---------- */
    function stageBox() {
        var st = $('stage');
        var dpr = window.devicePixelRatio || 1;
        return Math.max(200, Math.floor(Math.min(st.clientWidth, st.clientHeight - 24) * dpr));
    }
    function renderFrame(fr) {
        var cfg = S.cfg;
        var text = QX.frameToText(fr.bytes);
        var qr = QX.QR.encode(text, { mode: 'alnum', ver: cfg.ver, ecl: cfg.ecl });
        QX.drawQR($('qr'), qr, stageBox());
        S.lastRender = fr;
    }
    function updateStatus(fr) {
        var src = S.src;
        if (!src) return;
        var target = src.visitTarget(src.cur);
        var tStr = isFinite(target) ? target : '∞';
        var kind = fr && fr.kind === 'meta' ? '(헤더)' : '';
        var overall = (src.cur + Math.min(1, isFinite(target) ? src.visitSent / target : 0)) / src.segCount;
        $('playBar').style.width = (overall * 100).toFixed(1) + '%';
        var txt = '세션 ' + S.sid.toString(16).toUpperCase() + ' · 구간 ' + (src.cur + 1) + '/' + src.segCount +
            ' · 프레임 ' + src.visitSent + '/' + tStr + ' ' + kind + ' · 반복 ' + (src.loops + 1) + '회차 · 누적 ' + S.sentFrames.toLocaleString() + '프레임';
        $('status').textContent = (S.paused ? '⏸ 일시정지 · ' : '▶ ') + txt;
        $('stageInfo').textContent = txt;
        $('jumpSeg').max = src.segCount;
    }
    function tick(ts) {
        if (!S.playing) return;
        requestAnimationFrame(tick);
        if (S.paused) { S.lastTs = ts; return; }
        var interval = 1000 / S.cfg.fps;
        if (ts - S.lastTs < interval - 2) return;
        S.lastTs = ts;
        var fr = S.src.next();
        if (!fr) {
            S.playing = false;
            $('status').textContent = '✅ 전송 완료 (모든 구간 1회 통과). 다시 보내려면 [재생 시작]을 누르세요.';
            $('btnPause').disabled = true;
            return;
        }
        S.sentFrames++;
        renderFrame(fr);
        updateStatus(fr);
    }
    function play() {
        if (!S.archive) return;
        S.cfg = getCfg();
        S.src = makeSource(S.cfg);
        S.sentFrames = 0; S.paused = false; S.playing = true; S.lastTs = 0;
        $('stage').className = 'stage live';
        ['btnPause', 'btnPrev', 'btnNext', 'btnJump', 'btnFocus', 'btnFull'].forEach(function (id) { $(id).disabled = false; });
        $('btnPause').textContent = '⏸ 일시정지';
        requestAnimationFrame(tick);
    }
    function stopPlay(silent) {
        S.playing = false;
        if (!silent) return;
        $('stage').className = 'stage';
        ['btnPause', 'btnPrev', 'btnNext', 'btnJump', 'btnFocus', 'btnFull'].forEach(function (id) { $(id).disabled = true; });
        $('status').textContent = '';
        $('playBar').style.width = '0';
    }
    function togglePause() {
        if (!S.src) return;
        if (!S.playing) { // 종료 후 재시작
            S.src.finished = false; S.src.jump(0); S.playing = true; S.paused = false; requestAnimationFrame(tick);
            $('btnPause').disabled = false;
        } else S.paused = !S.paused;
        $('btnPause').textContent = S.paused ? '▶ 재개' : '⏸ 일시정지';
        updateStatus(S.lastRender);
    }
    function segMove(d) {
        if (!S.src) return;
        var t = S.src.cur + d;
        if (t < 0) t = 0;
        if (t >= S.src.segCount) { if (S.src.loopAll) t = 0; else t = S.src.segCount - 1; }
        S.src.jump(t);
        if (!S.playing) { S.playing = true; requestAnimationFrame(tick); }
        updateStatus(S.lastRender);
    }
    function focusTest() {
        if (!S.src) return;
        S.paused = true;
        $('btnPause').textContent = '▶ 재개';
        renderFrame({ kind: 'meta', bytes: S.src.meta(), seg: S.src.cur });
        $('status').textContent = '🔍 초점 테스트: 헤더 프레임 한 장을 고정 표시 중입니다. 폰이 이 QR을 바로 읽는지 확인한 뒤 [재개]를 누르세요.';
    }
    function fullscreen() {
        var st = $('stage');
        var f = st.requestFullscreen || st.webkitRequestFullscreen || st.msRequestFullscreen;
        if (f) f.call(st);
    }

    /* ---------- 이벤트 ---------- */
    var drop = $('drop'), input = $('fileInput');
    drop.onclick = function () { input.click(); };
    input.onchange = function () { if (input.files.length) addFiles(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    $('btnPrepare').onclick = prepare;
    $('btnClear').onclick = function () { S.files = []; invalidate(); renderFiles(); };
    $('btnPlay').onclick = play;
    $('btnPause').onclick = togglePause;
    $('btnPrev').onclick = function () { segMove(-1); };
    $('btnNext').onclick = function () { segMove(1); };
    $('btnJump').onclick = function () { if (S.src) { S.src.jump(parseInt($('jumpSeg').value, 10) - 1); if (!S.playing) { S.playing = true; requestAnimationFrame(tick); } updateStatus(S.lastRender); } };
    $('btnFocus').onclick = focusTest;
    $('btnFull').onclick = fullscreen;
    ['preset', 'verInput', 'ecl', 'fps', 'segSize', 'mult', 'advance', 'loopAll'].forEach(function (id) {
        $(id).addEventListener('change', function () {
            updateEstimate();
            if (S.src && S.playing && id !== 'preset' && id !== 'verInput' && id !== 'ecl' && id !== 'segSize') {
                // 재생 중 즉시 반영 가능한 항목
                S.cfg.fps = getCfg().fps; S.src.mult = parseFloat($('mult').value);
                S.src.manual = $('advance').value === 'manual'; S.src.loopAll = $('loopAll').checked;
            }
        });
    });
    window.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT') return;
        if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key === 'ArrowRight') segMove(1);
        else if (e.key === 'ArrowLeft') segMove(-1);
        else if (e.key === 'f' || e.key === 'F') fullscreen();
    });
    window.addEventListener('resize', function () { if (S.lastRender && S.playing === false && S.cfg) renderFrame(S.lastRender); });

    updateEstimate();
    window.__qrxSender = S; // 테스트 후크
})();
