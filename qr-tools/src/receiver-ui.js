/* ===================== 수신기 UI (구형 문법 호환) ===================== */
(function () {
    var $ = function (id) { return document.getElementById(id); };
    var R = {
        asm: new QX.Assembler(), stream: null, running: false, busy: false, bd: null, missCount: 0,
        key: '', startedAt: 0, validSyms: 0, lastSec: 0, secCount: 0, fps: 0, torchOn: false,
        wake: null, finishing: false, files: null, videoMode: false, workCanvas: null, workCtx: null,
        calib: new QX.CalibStats(), detected: null, misses: 0, alt: 0, gray: null
    };

    function log(s) {
        var el = $('log');
        el.textContent = (new Date().toTimeString().slice(0, 8)) + ' ' + s + '\n' + el.textContent.slice(0, 3000);
    }
    function fmtSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
    }
    function fmtTime(sec) {
        sec = Math.round(sec);
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h > 0 ? (h + '시간 ' + m + '분') : (m > 0 ? (m + '분 ' + s + '초') : (s + '초'));
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function setMsg(id, text, cls) {
        var el = $(id);
        el.className = 'msg' + (cls ? ' ' + cls : '') + (text ? '' : ' hidden');
        el.textContent = text || '';
    }

    /* ---------- IndexedDB (이어받기) ---------- */
    var idbP = null;
    function idb() {
        if (idbP) return idbP;
        idbP = new Promise(function (resolve) {
            try {
                var rq = indexedDB.open('qrx-recv', 1);
                rq.onupgradeneeded = function () { rq.result.createObjectStore('segs'); };
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
        return idbP;
    }
    function idbPut(key, buf) {
        return idb().then(function (db) {
            if (!db) return;
            return new Promise(function (res) {
                try {
                    var tx = db.transaction('segs', 'readwrite');
                    tx.objectStore('segs').put(buf, key);
                    tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
                } catch (e) { res(); }
            });
        });
    }
    function idbGetAll(prefix) {
        return idb().then(function (db) {
            if (!db) return [];
            return new Promise(function (res) {
                var out = [];
                try {
                    var tx = db.transaction('segs', 'readonly');
                    var rq = tx.objectStore('segs').openCursor();
                    rq.onsuccess = function () {
                        var c = rq.result;
                        if (c) { if (String(c.key).indexOf(prefix) === 0) out.push({ key: c.key, val: c.value }); c.continue(); }
                        else res(out);
                    };
                    rq.onerror = function () { res(out); };
                } catch (e) { res(out); }
            });
        });
    }
    function idbDelPrefix(prefix) {
        return idbGetAll(prefix).then(function (items) {
            return idb().then(function (db) {
                if (!db || !items.length) return;
                return new Promise(function (res) {
                    try {
                        var tx = db.transaction('segs', 'readwrite'), st = tx.objectStore('segs');
                        items.forEach(function (it) { st.delete(it.key); });
                        tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
                    } catch (e) { res(); }
                });
            });
        });
    }
    function sessKey(m) { return m.sid.toString(16) + ':' + m.segSize + ':' + m.B + ':' + m.total + ':'; }

    /* ---------- 프레임 처리 ---------- */
    function onFrame(bytes) {
        var a = R.asm;
        var r = a.ingest(bytes);
        if (r.layered !== undefined && $('colorMode').value === 'auto') R.detected = r.layered ? 'rgb' : 'mono'; // 프레임 헤더 플래그로 확정
        if (r.kind === 'calib') { R.calib.add(r.calib); R.secCount++; return; }
        if (r.kind === 'meta' && r.first) {
            R.key = sessKey(a.meta);
            R.startedAt = Date.now(); R.validSyms = 0;
            log('세션 감지 ' + a.meta.sid.toString(16) + ' · ' + fmtSize(a.meta.total) + ' · 구간 ' + a.meta.segCount);
            buildGrid();
            idbGetAll(R.key).then(function (items) {
                var n = 0;
                items.forEach(function (it) {
                    var seg = parseInt(String(it.key).slice(R.key.length), 10);
                    var u8 = it.val instanceof Uint8Array ? it.val : new Uint8Array(it.val);
                    if (R.asm.restoreSegment(seg, u8)) n++;
                });
                if (n) { log('이전 수신분 ' + n + '개 구간 복원'); setMsg('stateMsg', '이전에 받은 ' + n + '개 구간을 이어받습니다.'); }
                renderPeek();
                refresh();
                if (R.asm.isComplete()) finish();
            });
        } else if (r.kind === 'segdone') {
            var seg = r.seg, data = a.segData[seg];
            idbPut(R.key + seg, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
            try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { }
            if (seg === 0) renderPeek();
            if (a.isComplete()) finish();
        } else if (r.kind === 'sym') {
            R.validSyms++;
        } else if (r.kind === 'other') {
            var o = $('otherMsg');
            o.className = 'msg warn';
            o.innerHTML = '다른 전송(세션 ' + a.otherSid.toString(16) + ')이 감지되었습니다. 현재 수신 중인 세션과 다릅니다. ' +
                '<br><button class="btn sec" id="btnSwitch" style="margin-top:.4rem">이 전송으로 전환</button>';
            $('btnSwitch').onclick = function () { resetAll(false); };
        }
        R.secCount++;
    }

    function buildGrid() {
        var g = $('segGrid');
        g.innerHTML = '';
        var n = R.asm.meta ? R.asm.meta.segCount : 0;
        g.className = n > 150 ? 'small' : '';
        for (var i = 0; i < n; i++) {
            var s = document.createElement('span');
            s.innerHTML = '<i style="height:0"></i>';
            g.appendChild(s);
        }
    }

    function renderCalib() {
        var rep = R.calib.report();
        if (!rep.rows.length) return;
        $('calibCard').className = 'card';
        var html = '<tr><th>모드</th><th>QR</th><th>ECC</th><th>fps</th><th>수신율</th><th>실효 KB/s</th></tr>';
        rep.rows.forEach(function (r) {
            html += '<tr' + (rep.best === r ? ' class="best"' : '') + '><td>' + (r.mode ? 'RGB' : '흑백') + '</td><td>V' + r.ver + '</td><td>' + (r.ecl ? 'M' : 'L') + '</td><td>' + r.fps + '</td><td>' +
                Math.round(r.ratio * 100) + '%</td><td>' + r.kbps.toFixed(1) + (rep.best === r ? ' ★' : '') + '</td></tr>';
        });
        $('calibTable').innerHTML = html;
        $('calibBest').textContent = rep.best
            ? ('추천: ' + (rep.best.mode ? 'RGB 3층 · ' : '흑백 · ') + 'V' + rep.best.ver + ' · ECC ' + (rep.best.ecl ? 'M' : 'L') + ' · ' + rep.best.fps + 'fps  (실효 약 ' + rep.best.kbps.toFixed(1) + ' KB/s) → 송신기에서 이 설정을 선택하세요.')
            : '아직 신뢰할 만한 측정값이 없습니다. 테스트가 끝날 때까지 계속 비추세요.';
    }

    function refresh() {
        renderCalib();
        var a = R.asm, m = a.meta;
        $('sFrames').textContent = a.frames;
        $('sBad').textContent = a.badFrames;
        if (!m) { return; }
        $('sSid').textContent = m.sid.toString(16).toUpperCase();
        $('sTotal').textContent = fmtSize(m.total);
        $('sSegs').textContent = a.completed + ' / ' + m.segCount;
        var g = $('segGrid').children, doneBytes = 0, partial = 0;
        for (var i = 0; i < m.segCount; i++) {
            var p = a.segProgress(i), cell = g[i];
            if (!cell) continue;
            if (a.done[i]) { cell.className = 'done'; doneBytes += a.segLen(i); }
            else { cell.className = ''; cell.firstChild.style.height = (p * 100).toFixed(0) + '%'; partial += p * a.segLen(i); }
        }
        var frac = (doneBytes + partial) / m.total;
        $('totalBar').style.width = (frac * 100).toFixed(1) + '%';
        var el = (Date.now() - R.startedAt) / 1000;
        if (R.startedAt && doneBytes > 0 && !a.isComplete()) {
            var rate = (doneBytes + partial) / Math.max(1, el);
            $('sEta').textContent = fmtTime((m.total - doneBytes - partial) / rate);
        } else $('sEta').textContent = a.isComplete() ? '완료' : '-';
        var miss = a.missingText();
        var mEl = $('missing');
        if (a.completed > 0 && !a.isComplete()) { mEl.className = 'msg'; mEl.textContent = '미완료 구간(송신기 [재전송할 구간]에 입력): ' + miss; }
        else mEl.className = 'msg hidden';
        if (!a.isComplete() && R.running) {
            setMsg('stateMsg', '수신 중… ' + (frac * 100).toFixed(1) + '% · ' + R.fps + '프레임/초 인식', '');
        }
    }

    function renderPeek() {
        var files = R.asm.peekFiles(), ul = $('peekList');
        ul.innerHTML = '';
        if (!files) return;
        files.forEach(function (f) {
            var li = document.createElement('li');
            li.innerHTML = '<span class="nm">' + esc(f.n) + '</span><span class="sz">' + fmtSize(f.s) + '</span>';
            ul.appendChild(li);
        });
    }

    /* ---------- 완료 처리 ---------- */
    function finish() {
        if (R.finishing) return;
        R.finishing = true;
        stopCamera(); stopVideo();
        setMsg('stateMsg', '모든 구간 수신 완료 — 검증·압축 해제 중…', '');
        R.asm.finalize().then(function (files) {
            R.files = files;
            showResults(files);
            setMsg('stateMsg', '수신·검증 완료!', 'ok');
            idbDelPrefix(R.key);
            refresh();
        }).catch(function (e) {
            console.error(e);
            setMsg('stateMsg', '검증 실패: ' + (e && e.message ? e.message : e) + ' — [수신 초기화] 후 다시 수신하세요.', 'bad');
            R.finishing = false;
        });
    }

    function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function describeFile(f) {
        // 전송용 JSON 이면 매뉴얼 수·쪽 수를 요약해 보여준다
        if (!/\.json$/i.test(f.name) || f.size > 80 * 1048576) return '';
        try {
            var o = JSON.parse(QX.utf8.dec(f.data));
            if (o && Array.isArray(o.docs)) {
                var pages = 0;
                o.docs.forEach(function (d) { pages += d.numPages || (d.pages ? d.pages.length : 0); });
                return ' (매뉴얼 ' + o.docs.length + '권 · ' + pages + '쪽)';
            }
        } catch (e) { }
        return '';
    }
    function showResults(files) {
        $('resultCard').className = 'card';
        var extra = files.length === 1 ? describeFile(files[0]) : '';
        $('verifyMsg').textContent = '✅ 수신·검증 완료 (SHA-256·CRC32 통과) · 파일 ' + files.length + '개' + extra + (files.length === 1 ? ' — 자동 저장됨(다운로드 폴더 확인)' : ' — 아래 [다운로드]로 받으세요');
        var ul = $('resultList');
        ul.innerHTML = '';
        files.forEach(function (f) {
            var li = document.createElement('li');
            li.innerHTML = '<span class="nm">' + esc(f.name) + '</span><span class="sz">' + fmtSize(f.size) + '</span>';
            var b = document.createElement('button');
            b.className = 'btn'; b.textContent = '⬇ 다운로드';
            b.onclick = function () { downloadBlob(new Blob([f.data], { type: 'application/octet-stream' }), f.name); };
            li.appendChild(b);
            if (/\.html?$/i.test(f.name)) {
                var j = document.createElement('button');
                j.className = 'btn sec'; j.textContent = '사건노트 JSON 추출';
                j.onclick = function () {
                    try {
                        var txt = QX.extractCaseNoteJson(f.data);
                        if (!txt) { alert('이 HTML에서 사건 관리 노트 내장 데이터를 찾지 못했습니다.'); return; }
                        var base = f.name.replace(/\.html?$/i, '');
                        downloadBlob(new Blob(['﻿' + txt], { type: 'application/json;charset=utf-8' }), base + '_데이터.json');
                    } catch (e) { alert('추출 실패: ' + e.message); }
                };
                li.appendChild(j);
            }
            ul.appendChild(li);
        });
        $('resultCard').scrollIntoView();
        if (files.length === 1) {   // 파일이 하나면 바로 저장 (절차 최소화)
            try { downloadBlob(new Blob([files[0].data], { type: 'application/octet-stream' }), files[0].name); } catch (e) { log('자동 저장 실패: ' + e); }
        }
    }

    /* ---------- 디코딩 ---------- */
    function ensureCanvas() {
        if (!R.workCanvas) { R.workCanvas = document.createElement('canvas'); R.workCtx = R.workCanvas.getContext('2d', { willReadFrequently: true }) || R.workCanvas.getContext('2d'); }
    }
    function grab(src, w, h, maxW) {
        ensureCanvas();
        var sc = w > maxW ? maxW / w : 1;
        var cw = Math.round(w * sc), ch = Math.round(h * sc);
        if (R.workCanvas.width !== cw) R.workCanvas.width = cw;
        if (R.workCanvas.height !== ch) R.workCanvas.height = ch;
        R.workCtx.drawImage(src, 0, 0, cw, ch);
        return R.workCtx.getImageData(0, 0, cw, ch);
    }
    function decodeMonoJs(img) {
        var r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (!r) return [];
        var fr = QX.decodeScanned(r.data, r.binaryData);
        return fr ? [fr] : [];
    }
    function decodeRgbJs(img) {
        var out = [];
        if (!R.gray || R.gray.length !== img.data.length) R.gray = new Uint8ClampedArray(img.data.length);
        for (var c = 0; c < 3; c++) {
            QX.channelToGray(img.data, R.gray, c);
            var r = jsQR(R.gray, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r) { var fr = QX.decodeScanned(r.data, r.binaryData); if (fr) out.push(fr); }
        }
        return out;
    }
    function monoPath(src, w, h, maxW) {
        var mode = $('engine').value;
        var useBd = (mode === 'bd' || mode === 'auto') && R.bd;
        var p = Promise.resolve([]);
        if (useBd) {
            p = R.bd.detect(src).then(function (res) {
                for (var i = 0; i < res.length; i++) {
                    var v = res[i].rawValue;
                    if (v && v.charCodeAt(0) === 0x51 && v.charCodeAt(1) === 0x58) { var fr = QX.decodeScanned(v, null); if (fr) return [fr]; }
                }
                return [];
            }).catch(function () { return []; });
        }
        return p.then(function (frs) {
            if (frs.length) { R.missCount = 0; return frs; }
            if (mode === 'bd') return [];
            R.missCount++;
            if (useBd && R.missCount % 3 !== 0) return []; // BD가 있으면 jsQR 은 3회에 1번만 보조
            try { return decodeMonoJs(grab(src, w, h, maxW)); } catch (e) { return []; }
        });
    }
    function rgbPath(src, w, h, maxW) {
        try { return Promise.resolve(decodeRgbJs(grab(src, w, h, maxW))); } catch (e) { return Promise.resolve([]); }
    }
    // 반환: 프레임 바이트 배열 (흑백 0~1개, RGB 0~3개)
    function scan(src, w, h) {
        var cm = $('colorMode').value;
        var maxW = (R.misses > 0 && R.misses % 5 === 4) ? 1920 : 1280; // 연속 실패 시 고해상도 재시도
        var order;
        if (cm === 'mono') order = ['mono'];
        else if (cm === 'rgb') order = ['rgb'];
        else {
            if (R.detected) order = [R.detected];
            else order = (R.alt++ % 2) ? ['rgb'] : ['mono'];
            if (R.misses >= 8) order = (R.alt++ % 2) ? ['rgb', 'mono'] : ['mono', 'rgb'];
        }
        var idx = 0;
        function tryNext() {
            if (idx >= order.length) {
                R.misses++;
                if (R.detected && R.misses > 30) R.detected = null;
                return Promise.resolve([]);
            }
            var which = order[idx++];
            return (which === 'rgb' ? rgbPath(src, w, h, maxW) : monoPath(src, w, h, maxW)).then(function (frs) {
                if (frs.length) {
                    R.misses = 0;
                    if (cm === 'auto') R.detected = which;
                    return frs;
                }
                return tryNext();
            });
        }
        return tryNext();
    }

    /* ---------- 카메라 ---------- */
    function startCamera() {
        if (R.running) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMsg('camMsg', '이 브라우저/열기 방식에서는 카메라를 쓸 수 없습니다. 아래 [영상 파일로 수신]을 사용하세요.', 'warn');
            return;
        }
        if (typeof BarcodeDetector !== 'undefined') {
            try { R.bd = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { R.bd = null; }
        }
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
        }).then(function (stream) {
            R.stream = stream;
            var v = $('video');
            v.srcObject = stream;
            return v.play();
        }).then(function () {
            R.running = true; R.finishing = false;
            $('cam').className = 'cam on';
            $('btnStart').disabled = true; $('btnStop').disabled = false;
            setMsg('camMsg', '', '');
            setMsg('stateMsg', '카메라 동작 중 — 송신 화면의 QR 전체가 보이게 맞추세요.', '');
            try {
                var track = R.stream.getVideoTracks()[0];
                var caps = track.getCapabilities ? track.getCapabilities() : {};
                $('btnTorch').disabled = !caps.torch;
                if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () { });
            } catch (e) { }
            try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { R.wake = w; }).catch(function () { }); } catch (e) { }
            log('카메라 시작 · 엔진: ' + (R.bd ? 'BarcodeDetector+jsQR' : 'jsQR'));
            loopCamera();
        }).catch(function (e) {
            setMsg('camMsg', '카메라를 시작하지 못했습니다: ' + (e && e.name ? e.name : e) + ' — 권한 허용 여부를 확인하거나, 아래 [영상 파일로 수신]을 사용하세요.', 'warn');
            log('카메라 오류 ' + (e && e.message ? e.message : e));
        });
    }
    function stopCamera() {
        R.running = false;
        if (R.stream) { R.stream.getTracks().forEach(function (t) { t.stop(); }); R.stream = null; }
        try { if (R.wake) { R.wake.release(); R.wake = null; } } catch (e) { }
        $('video').srcObject = null;
        $('cam').className = 'cam';
        $('btnStart').disabled = false; $('btnStop').disabled = true; $('btnTorch').disabled = true;
    }
    function nextTick(cb) {
        var v = $('video');
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(function () { cb(); });
        else requestAnimationFrame(cb);
    }
    function loopCamera() {
        if (!R.running) return;
        var v = $('video');
        if (R.busy || v.readyState < 2 || !v.videoWidth) { nextTick(loopCamera); return; }
        R.busy = true;
        scan(v, v.videoWidth, v.videoHeight).then(function (frs) {
            for (var i = 0; i < frs.length; i++) onFrame(frs[i]);
        }).catch(function (e) { log('스캔 오류 ' + e); }).then(function () {
            R.busy = false;
            nextTick(loopCamera);
        });
    }

    /* ---------- 영상 파일 수신 ---------- */
    var vurl = null;
    function startVideo(file) {
        stopVideo();
        var v = $('vplay');
        vurl = URL.createObjectURL(file);
        v.style.display = 'block';
        v.src = vurl;
        v.muted = true;
        v.playbackRate = parseFloat($('vrate').value);
        R.videoMode = true; R.finishing = false;
        if (typeof BarcodeDetector !== 'undefined') { try { R.bd = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { R.bd = null; } }
        $('btnVideoStop').disabled = false;
        setMsg('vMsg', '영상 분석 중…', '');
        v.onended = function () {
            if (!R.asm.isComplete()) setMsg('vMsg', '영상이 끝났지만 아직 모두 받지 못했습니다(' + R.asm.completed + '/' + (R.asm.meta ? R.asm.meta.segCount : '?') + '구간). 같은 영상을 다시 분석하거나(이어받기), 더 느린 속도를 선택해 보세요. 또는 송신 화면을 더 오래 촬영하세요.', 'warn');
            R.videoMode = false; $('btnVideoStop').disabled = true;
        };
        v.play().then(function () { loopVideo(); }).catch(function (e) { setMsg('vMsg', '영상을 재생할 수 없습니다(' + (e && e.name ? e.name : e) + '). 이 폰 브라우저가 해당 영상 코덱을 지원하지 않을 수 있습니다.', 'bad'); });
    }
    function stopVideo() {
        R.videoMode = false;
        var v = $('vplay');
        try { v.pause(); } catch (e) { }
        if (vurl) { URL.revokeObjectURL(vurl); vurl = null; }
        $('btnVideoStop').disabled = true;
    }
    function loopVideo() {
        if (!R.videoMode) return;
        var v = $('vplay');
        var again = function () {
            if (!R.videoMode) return;
            if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(function () { loopVideo(); });
            else requestAnimationFrame(loopVideo);
        };
        if (R.busy || v.readyState < 2 || !v.videoWidth) { again(); return; }
        R.busy = true;
        scan(v, v.videoWidth, v.videoHeight).then(function (frs) {
            for (var i = 0; i < frs.length; i++) onFrame(frs[i]);
            if (v.duration) setMsg('vMsg', '영상 분석 중… ' + Math.round(v.currentTime / v.duration * 100) + '%', '');
        }).catch(function () { }).then(function () { R.busy = false; again(); });
    }

    /* ---------- 초기화 ---------- */
    function resetAll(clearStore) {
        stopCamera(); stopVideo();
        var key = R.key;
        R.asm.reset();
        R.files = null; R.finishing = false; R.key = ''; R.startedAt = 0; R.calib = new QX.CalibStats(); R.detected = null; R.misses = 0;
        $('calibCard').className = 'card hidden';
        $('segGrid').innerHTML = ''; $('peekList').innerHTML = ''; $('resultList').innerHTML = '';
        $('resultCard').className = 'card hidden';
        $('totalBar').style.width = '0';
        ['sSid', 'sTotal', 'sSegs', 'sEta'].forEach(function (id) { $(id).textContent = '-'; });
        $('otherMsg').className = 'msg warn hidden';
        setMsg('stateMsg', '대기 중 — 송신기가 재생되는 화면을 비추세요.', '');
        if (clearStore !== false && key) idbDelPrefix(key);
        refresh();
    }

    /* ---------- 이벤트 ---------- */
    $('btnStart').onclick = startCamera;
    $('btnStop').onclick = stopCamera;
    $('btnTorch').onclick = function () {
        try {
            var track = R.stream.getVideoTracks()[0];
            R.torchOn = !R.torchOn;
            track.applyConstraints({ advanced: [{ torch: R.torchOn }] });
        } catch (e) { }
    };
    $('btnReset').onclick = function () { if (confirm('지금까지 받은 데이터(저장된 구간 포함)를 모두 지울까요?')) resetAll(true); };
    $('videoFile').onchange = function () { var f = this.files[0]; if (f) startVideo(f); this.value = ''; };
    $('btnVideoStop').onclick = function () { stopVideo(); setMsg('vMsg', '중지됨', ''); };
    $('vrate').onchange = function () { try { $('vplay').playbackRate = parseFloat(this.value); } catch (e) { } };
    $('btnZip').onclick = function () {
        if (!R.files) return;
        downloadBlob(new Blob(QX.buildZip(R.files), { type: 'application/zip' }), '수신파일.zip');
    };
    $('engine').onchange = function () { R.missCount = 0; };

    setInterval(function () {
        R.fps = R.secCount; R.secCount = 0;
        refresh();
    }, 1000);
    setInterval(function () { if (R.asm.meta) refresh(); }, 250);

    window.__qrxRecv = { R: R, onFrame: onFrame }; // 테스트 후크
    log('준비 완료. 보안 컨텍스트: ' + (window.isSecureContext ? '예' : '아니오') + ' · BarcodeDetector: ' + (typeof BarcodeDetector !== 'undefined' ? '지원' : '미지원'));
})();
