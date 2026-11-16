/* ===================== 송신기 UI (구형 Chrome/Edge 호환 문법만 사용) ===================== */
(function () {
    var $ = function (id) { return document.getElementById(id); };
    var S = {
        files: [], entries: null, archive: null, sha: null, sid: 0,
        src: null, playing: false, paused: false, sentFrames: 0, lastRender: null,
        preparing: false, cfg: null, mode: 'send', calib: null,
        hz: 60, tc: 0, curTicks: 6, maskCache: {}, thumbs: {}
    };

    /* ---------- 유틸 ---------- */
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
    function isImage(f) {
        return /^image\/(jpeg|png|webp|bmp|gif)$/i.test(f.type || '') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name);
    }

    /* ---------- 주사율 측정 → 프레임 타이밍을 모니터 갱신 주기의 정수배로 맞춤 ---------- */
    function measureHz() {
        var ts = [];
        function step(t) {
            ts.push(t);
            if (ts.length < 45) { requestAnimationFrame(step); return; }
            var d = [];
            for (var i = 6; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
            d.sort(function (a, b) { return a - b; });
            var med = d[Math.floor(d.length / 2)];
            var hz = Math.round(1000 / med);
            if (hz >= 30 && hz <= 360) S.hz = hz;
            $('hzInfo').textContent = '(모니터 ' + S.hz + 'Hz 감지 — 프레임 간격을 갱신 주기의 정수배로 맞춥니다)';
            updateEstimate();
        }
        requestAnimationFrame(step);
    }
    function ticksFor(fps) { return Math.max(1, Math.round(S.hz / fps)); }
    function effFps(fps) { return S.hz / ticksFor(fps); }

    /* ---------- 파일 목록 ---------- */
    function addFiles(list) {
        for (var i = 0; i < list.length; i++) S.files.push({ file: list[i], state: '', reduce: false, thumb: '' });
        invalidate();
        renderFiles();
    }
    function renderFiles() {
        var ul = $('fileList');
        ul.innerHTML = '';
        var total = 0, imgCount = 0;
        S.files.forEach(function (f, i) {
            total += f.file.size;
            var li = document.createElement('li');
            var img = isImage(f.file);
            if (img) imgCount++;
            li.innerHTML = (f.thumb ? '<img class="th" src="' + f.thumb + '">' : '') +
                '<span class="nm" title="' + esc(f.file.name) + '">' + esc(f.file.name) + '</span>' +
                (img ? '<label class="rd" title="전송용으로 축소(원본 아님)"><input type="checkbox"' + (f.reduce ? ' checked' : '') + '> 축소</label>' : '') +
                '<span class="sz">' + fmtSize(f.file.size) + '</span><span class="st">' + esc(f.state) + '</span><button title="제거">✕</button>';
            li.querySelector('button').onclick = function () { if (S.preparing) return; S.files.splice(i, 1); invalidate(); renderFiles(); };
            var cb = li.querySelector('input[type=checkbox]');
            if (cb) cb.onchange = function () { f.reduce = cb.checked; invalidate(); };
            ul.appendChild(li);
        });
        $('fileSum').textContent = S.files.length ? ('파일 ' + S.files.length + '개 · 원본 합계 ' + fmtSize(total)) : '선택된 파일 없음';
        $('btnPrepare').disabled = !S.files.length || S.preparing;
        $('btnClear').disabled = !S.files.length || S.preparing;
        if (imgCount && !$('imgOpt').open && !S.optHinted) { $('imgOpt').open = true; S.optHinted = true; }
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

    /* ---------- 사진 전송용 축소 ---------- */
    function loadBitmap(file) {
        function viaImg() {
            return new Promise(function (res, rej) {
                var url = URL.createObjectURL(file), img = new Image();
                img.onload = function () { res(img); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); };
                img.onerror = function () { rej(new Error('이미지를 열 수 없습니다(HEIC 등 미지원 형식)')); };
                img.src = url;
            });
        }
        if (window.createImageBitmap) {
            return createImageBitmap(file, { imageOrientation: 'from-image' })
                .catch(function () { return createImageBitmap(file); })
                .catch(viaImg);
        }
        return viaImg();
    }
    function canvasToU8(canvas, type, q) {
        return new Promise(function (resolve, reject) {
            function fromBlob(blob) {
                var fr = new FileReader();
                fr.onload = function () { resolve({ u8: new Uint8Array(fr.result), type: blob.type }); };
                fr.onerror = reject;
                fr.readAsArrayBuffer(blob);
            }
            if (canvas.toBlob) canvas.toBlob(function (b) { if (b) fromBlob(b); else reject(new Error('인코딩 실패')); }, type, q);
            else {
                var d = canvas.toDataURL(type, q), bin = atob(d.split(',')[1]), u8 = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                resolve({ u8: u8, type: type });
            }
        });
    }
    function reduceImage(file) {
        var maxEdge = parseInt($('imgMax').value, 10), q = parseFloat($('imgQ').value), want = $('imgFmt').value;
        return loadBitmap(file).then(function (bmp) {
            var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
            var scale = Math.min(1, maxEdge / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(bmp, 0, 0, cw, ch);
            if (bmp.close) try { bmp.close(); } catch (e) { }
            var th = document.createElement('canvas'), tr = 34 / Math.max(cw, ch);
            th.width = Math.max(1, Math.round(cw * tr)); th.height = Math.max(1, Math.round(ch * tr));
            th.getContext('2d').drawImage(c, 0, 0, th.width, th.height);
            return canvasToU8(c, want, q).then(function (r) {
                var type = r.type === want ? want : 'image/jpeg';
                if (type !== r.type) return canvasToU8(c, 'image/jpeg', q).then(function (r2) { return { r: r2, type: 'image/jpeg', cw: cw, ch: ch, scale: scale, thumb: th.toDataURL('image/jpeg', 0.6) }; });
                return { r: r, type: type, cw: cw, ch: ch, scale: scale, thumb: th.toDataURL('image/jpeg', 0.6) };
            });
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
                f.state = '읽는 중'; f.thumb = ''; f.note = ''; renderFiles();
                if (f.reduce && isImage(f.file)) {
                    f.state = '사진 축소 중';
                    renderFiles();
                    return reduceImage(f.file).then(function (res) {
                        var ext = res.type === 'image/webp' ? '.webp' : '.jpg';
                        var base = f.file.name.replace(/\.[^.\/\\]+$/, '');
                        if (res.r.u8.length >= f.file.size * 0.9 && res.scale >= 1) {
                            f.note = '축소 효과 없음 → 원본 유지';
                            return readFile(f.file).then(function (u8) { return { u8: u8, name: f.file.name, reduced: false }; });
                        }
                        f.thumb = res.thumb;
                        f.note = '축소 ' + fmtSize(f.file.size) + '→' + fmtSize(res.r.u8.length) + ' (' + res.cw + '×' + res.ch + ')';
                        return { u8: res.r.u8, name: base + '(축소)' + ext, reduced: true };
                    }).catch(function (e) {
                        f.note = '축소 실패 → 원본 사용 (' + (e && e.message ? e.message : e) + ')';
                        return readFile(f.file).then(function (u8) { return { u8: u8, name: f.file.name, reduced: false }; });
                    });
                }
                return readFile(f.file).then(function (u8) { return { u8: u8, name: f.file.name, reduced: false }; });
            }).then(function (item) {
                f.state = f.note || '압축 판단 중';
                renderFiles();
                return QX.packFile(item.name, item.u8, f.file.lastModified || 0, function (p) {
                    $('prepBar').style.width = ((i + p) / n * 100).toFixed(1) + '%';
                    $('prepMsg').textContent = '[' + (i + 1) + '/' + n + '] ' + item.name + ' 압축 ' + Math.round(p * 100) + '%';
                });
            }).then(function (ent) {
                entries.push(ent);
                f.state = f.note || (ent.method ? ('압축 ' + fmtSize(ent.data.length)) : '원본 그대로');
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
            ver: ver, ecl: ecl, B: B, frameBytes: frameBytes, fps: fps, eff: effFps(fps),
            segSize: parseInt($('segSize').value, 10), loss: parseFloat($('loss').value),
            manual: $('advance').value === 'manual', loopAll: $('loopAll').checked,
            rgb: $('rgb').checked, layers: $('rgb').checked ? 3 : 1
        };
    }
    function makeSource(cfg) {
        var src = new QX.FrameSource(S.archive, {
            sid: S.sid, sha: S.sha, B: cfg.B, segSize: cfg.segSize, loss: cfg.loss,
            manual: cfg.manual, loopAll: cfg.loopAll, metaEvery: 40, layered: cfg.rgb
        });
        var pl = QX.parseSegList($('playlist').value, src.segCount);
        if (pl.length) src.setPlaylist(pl);
        return src;
    }
    function updateEstimate() {
        var cfg = getCfg();
        $('verInput').disabled = $('preset').value !== 'custom';
        var perSec = cfg.B * cfg.layers * cfg.eff * (1 - cfg.loss) / 1024;
        var base = 'QR 버전 <b>V' + cfg.ver + '</b> · 프레임당 <b>' + cfg.B + ' B</b>' + (cfg.rgb ? ' × 3층' : '') +
            ' · 실제 <b>' + cfg.eff.toFixed(1) + ' fps</b> · 유효 속도 약 <b>' + perSec.toFixed(1) + ' KB/s</b>';
        var w = [];
        if (!S.archive) {
            $('est').innerHTML = base;
        } else {
            var src = makeSource(cfg);
            var frames = src.estimateFrames();
            var sec = frames / (cfg.layers * cfg.eff);
            $('est').innerHTML = base + '<br>전송 데이터 <b>' + fmtSize(S.archive.length) + '</b> · 구간 <b>' + src.segCount + '</b>개 · 총 프레임 약 <b>' + frames.toLocaleString() + '</b>개<br>예상 소요 시간(1회차): <b>' + fmtTime(sec) + '</b>';
            if (S.archive.length > 10 * 1048576) w.push('전송 데이터가 10MB를 넘습니다(예상 ' + fmtTime(sec) + '). 중간에 끊겨도 완료된 구간은 폰에 저장되고 같은 파일을 다시 보내면 이어받습니다.');
            if (S.archive.length > 34000 * 1024) w.push('34,000KB(약 33MB)를 넘는 데이터입니다. 파일을 나눠 보내는 것을 권장합니다.');
        }
        if (cfg.ver >= 24) w.push('V' + cfg.ver + ' 이상은 QR이 매우 촘촘합니다. [📶 속도 보정 테스트]로 폰에서 실제로 읽히는 최적 설정을 먼저 확인하세요.');
        if (cfg.rgb) w.push('RGB 3층은 실험 기능입니다. 폰 수신기의 색상 모드는 [자동] 또는 [RGB]로 두세요. 인식이 불안하면 끄세요.');
        if (cfg.fps > 15) w.push('초당 ' + cfg.fps + '프레임은 폰 카메라가 놓칠 수 있습니다. 보정 테스트로 확인하세요.');
        var wb = $('warn');
        wb.innerHTML = w.map(esc).join('<br>');
        wb.className = 'warn' + (w.length ? ' on' : '');
    }

    /* ---------- QR 렌더링 ---------- */
    function stageBox() {
        var st = $('stage');
        var dpr = window.devicePixelRatio || 1;
        return Math.max(200, Math.floor(Math.min(st.clientWidth, st.clientHeight - 24) * dpr));
    }
    function encodeQR(bytes, ver, ecl) {
        var key = ver + ecl;
        var mc = S.maskCache[key] || (S.maskCache[key] = { mask: undefined, n: 0 });
        var opts = { mode: 'alnum', ver: ver, ecl: ecl };
        // 마스크 평가(8회 패널티 계산)는 비싸므로 20프레임마다 한 번만 하고 나머지는 재사용
        if (mc.mask !== undefined && mc.n % 20 !== 0) opts.mask = mc.mask;
        var qr = QX.QR.encode(QX.frameToText(bytes), opts);
        mc.mask = qr.mask; mc.n++;
        return qr;
    }
    function drawFrames(frames, ver, ecl) {
        var qrs = frames.map(function (b) { return encodeQR(b, ver, ecl); });
        if (qrs.length === 3) QX.drawQR3($('qr'), qrs, stageBox());
        else QX.drawQR($('qr'), qrs[0], stageBox());
    }

    /* ---------- 일반 전송 ---------- */
    function updateStatus(fr) {
        var src = S.src;
        if (!src) return;
        var target = src.visitTarget(src.cur);
        var tStr = isFinite(target) ? target : '∞';
        var kind = fr && fr.kind === 'meta' ? '(헤더)' : '';
        var overall = (src.oi + Math.min(1, isFinite(target) ? src.visitSent / target : 0)) / src.list().length;
        $('playBar').style.width = (Math.min(1, overall) * 100).toFixed(1) + '%';
        var txt = '세션 ' + S.sid.toString(16).toUpperCase() + ' · 구간 ' + (src.cur + 1) + '/' + src.segCount +
            ' · 프레임 ' + src.visitSent + '/' + tStr + ' ' + kind + ' · ' + (src.pass + 1) + '회차' + (src.order ? ' (지정 구간만)' : '') + ' · 누적 ' + S.sentFrames.toLocaleString();
        $('status').textContent = (S.paused ? '⏸ 일시정지 · ' : '▶ ') + txt;
        $('stageInfo').textContent = txt;
        $('jumpSeg').max = src.segCount;
    }
    function sendStep() {
        var layers = S.cfg.layers, frames = [], last = null;
        for (var i = 0; i < layers; i++) {
            var fr = S.src.next();
            if (!fr) {
                if (i === 0) {
                    S.playing = false;
                    $('status').textContent = '✅ 전송 완료 (모든 구간 1회 통과). 수신기에서 미완료 구간이 있으면 [재전송할 구간]에 입력하세요.';
                    $('btnPause').disabled = true;
                    return;
                }
                frames.push(S.src.meta());
                continue;
            }
            frames.push(fr.bytes); last = fr; S.sentFrames++;
        }
        drawFrames(frames, S.cfg.ver, S.cfg.ecl);
        S.lastRender = { frames: frames, ver: S.cfg.ver, ecl: S.cfg.ecl };
        updateStatus(last);
    }

    /* ---------- 속도 보정 테스트 ---------- */
    var CAL_LEVELS = [
        { m: 0, v: 12, f: 10, e: 'L' }, { m: 0, v: 18, f: 10, e: 'L' }, { m: 0, v: 18, f: 15, e: 'L' },
        { m: 0, v: 24, f: 10, e: 'L' }, { m: 0, v: 24, f: 15, e: 'L' }, { m: 0, v: 30, f: 10, e: 'L' },
        { m: 0, v: 30, f: 15, e: 'L' }, { m: 0, v: 24, f: 10, e: 'M' },
        { m: 1, v: 18, f: 10, e: 'L' }, { m: 1, v: 24, f: 10, e: 'L' }, { m: 1, v: 24, f: 15, e: 'L' }
    ];
    var CAL_SECONDS = 7;
    function startCalib() {
        stopPlay(false);
        S.mode = 'calib';
        S.calib = { idx: 0, tickInLevel: 0, seq: 0, ticksPerLevel: 0 };
        enterLevel(0);
        S.paused = false; S.playing = true; S.tc = 1e9;
        $('stage').className = 'stage live';
        ['btnPause', 'btnFull'].forEach(function (id) { $(id).disabled = false; });
        ['btnPrev', 'btnNext', 'btnJump', 'btnFocus'].forEach(function (id) { $(id).disabled = true; });
        $('btnPause').textContent = '⏸ 일시정지';
        requestAnimationFrame(tick);
    }
    function enterLevel(i) {
        var L = CAL_LEVELS[i], c = S.calib;
        c.idx = i; c.seq = 0; c.tickInLevel = 0;
        c.F = QX.QR.maxFrameBytes(L.v, L.e, false);
        c.ticks = ticksFor(L.f);
        c.eff = S.hz / c.ticks;
        c.shows = Math.max(8, Math.round(CAL_SECONDS * c.eff));
        S.curTicks = c.ticks;
    }
    function calibStep() {
        var c = S.calib, L = CAL_LEVELS[c.idx];
        if (c.tickInLevel >= c.shows) {
            if (c.idx + 1 >= CAL_LEVELS.length) {
                S.playing = false;
                $('status').textContent = '✅ 보정 테스트 완료. 폰 수신기의 [속도 측정 결과]에서 추천 설정을 확인한 뒤, 이 화면에서 그 설정을 선택하세요.';
                $('playBar').style.width = '100%';
                return;
            }
            enterLevel(c.idx + 1); c = S.calib; L = CAL_LEVELS[c.idx];
        }
        var layers = L.m === 1 ? 3 : 1, frames = [];
        for (var i = 0; i < layers; i++) frames.push(QX.makeCalibFrame(c.F, L.v, Math.round(c.eff), L.e === 'M' ? 1 : 0, L.m, c.seq++ & 0xFFFF));
        drawFrames(frames, L.v, L.e);
        c.tickInLevel++;
        var done = c.idx * 1.0 + c.tickInLevel / c.shows;
        $('playBar').style.width = (done / CAL_LEVELS.length * 100).toFixed(1) + '%';
        var txt = '📶 보정 테스트 ' + (c.idx + 1) + '/' + CAL_LEVELS.length + ' · V' + L.v + ' · ' + c.eff.toFixed(1) + 'fps · ' + (L.m ? 'RGB 3층' : '흑백') + (L.e === 'M' ? ' · ECC M' : '');
        $('status').textContent = (S.paused ? '⏸ 일시정지 · ' : '▶ ') + txt + ' — 폰으로 이 화면을 비추세요';
        $('stageInfo').textContent = txt;
    }

    /* ---------- 재생 루프 (주사율 정수배 타이밍) ---------- */
    function tick() {
        if (!S.playing) return;
        requestAnimationFrame(tick);
        if (S.paused) return;
        S.tc++;
        if (S.tc < S.curTicks) return;
        S.tc = 0;
        if (S.mode === 'calib') calibStep(); else sendStep();
    }
    function play() {
        if (!S.archive) return;
        S.mode = 'send';
        S.cfg = getCfg();
        S.curTicks = ticksFor(S.cfg.fps);
        S.src = makeSource(S.cfg);
        S.sentFrames = 0; S.paused = false; S.playing = true; S.tc = 1e9;
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
        if (S.mode === 'calib') { S.paused = !S.paused; $('btnPause').textContent = S.paused ? '▶ 재개' : '⏸ 일시정지'; return; }
        if (!S.src) return;
        if (!S.playing) {
            S.src.finished = false; S.src.jump(S.src.list()[0]); S.playing = true; S.paused = false; S.tc = 1e9; requestAnimationFrame(tick);
            $('btnPause').disabled = false;
        } else S.paused = !S.paused;
        $('btnPause').textContent = S.paused ? '▶ 재개' : '⏸ 일시정지';
        updateStatus(null);
    }
    function segMove(d) {
        if (!S.src || S.mode === 'calib') return;
        var t = S.src.cur + d;
        if (t < 0) t = 0;
        if (t >= S.src.segCount) { if (S.src.loopAll) t = 0; else t = S.src.segCount - 1; }
        S.src.jump(t);
        if (!S.playing) { S.playing = true; S.tc = 1e9; requestAnimationFrame(tick); }
        updateStatus(null);
    }
    function focusTest() {
        if (!S.src) return;
        S.paused = true;
        $('btnPause').textContent = '▶ 재개';
        var layers = S.cfg.layers, fr = [];
        for (var i = 0; i < layers; i++) fr.push(S.src.meta());
        drawFrames(fr, S.cfg.ver, S.cfg.ecl);
        $('status').textContent = '🔍 초점 테스트: 헤더 프레임을 고정 표시 중입니다. 폰이 이 QR을 바로 읽는지 확인한 뒤 [재개]를 누르세요.';
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
    $('btnCalib').onclick = startCalib;
    $('btnPause').onclick = togglePause;
    $('btnPrev').onclick = function () { segMove(-1); };
    $('btnNext').onclick = function () { segMove(1); };
    $('btnJump').onclick = function () { if (S.src) { S.src.jump(parseInt($('jumpSeg').value, 10) - 1); if (!S.playing) { S.playing = true; S.tc = 1e9; requestAnimationFrame(tick); } updateStatus(null); } };
    $('btnFocus').onclick = focusTest;
    $('btnFull').onclick = fullscreen;
    $('btnImgAll').onclick = function () { S.files.forEach(function (f) { if (isImage(f.file)) f.reduce = true; }); invalidate(); renderFiles(); };
    $('btnImgNone').onclick = function () { S.files.forEach(function (f) { f.reduce = false; }); invalidate(); renderFiles(); };
    ['imgMax', 'imgQ', 'imgFmt'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.archive) invalidate(); }); });
    ['preset', 'verInput', 'ecl', 'fps', 'segSize', 'loss', 'advance', 'loopAll', 'rgb', 'playlist'].forEach(function (id) {
        $(id).addEventListener('change', function () {
            updateEstimate();
            if (S.src && S.playing && S.mode === 'send') {
                var c = getCfg();
                if (id === 'fps') { S.cfg.fps = c.fps; S.cfg.eff = c.eff; S.curTicks = ticksFor(c.fps); }
                if (id === 'loss') S.src.loss = c.loss;
                if (id === 'advance') S.src.manual = c.manual;
                if (id === 'loopAll') S.src.loopAll = c.loopAll;
                if (id === 'rgb') { S.cfg.rgb = c.rgb; S.cfg.layers = c.layers; S.src.layered = c.rgb; }
                if (id === 'playlist') { S.src.setPlaylist(QX.parseSegList($('playlist').value, S.src.segCount)); }
            }
        });
    });
    window.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key === 'ArrowRight') segMove(1);
        else if (e.key === 'ArrowLeft') segMove(-1);
        else if (e.key === 'f' || e.key === 'F') fullscreen();
    });

    updateEstimate();
    measureHz();
    window.__qrxSender = S; // 테스트 후크
})();
