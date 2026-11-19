/* ==========================================================================
   다중 PDF 매뉴얼 통합 검색기 — 앱 본체 (PDF.js 내장 · 표 인식 · 긴 문서 안정 추출)
   - 저장: IndexedDB(문서별) + 단일 HTML 내장 색인('Z1:' 압축) + JSON 백업
   - 쪽 번호는 PDF 의 실제 쪽 번호 그대로 유지(빈 쪽·이미지 쪽도 목록에 남김)
   ========================================================================== */
var IDB_NAME = 'pdf-manual-search-v7';
var STORAGE_KEY_LEGACY = 'PDF_MANUAL_SEARCH_INDEX_V6';

/*@@SAMPLES@@*/

function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error(label + ' 시간 초과(' + Math.round(ms / 1000) + '초)')); }, ms);
        promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function readText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsText(file, 'utf-8');
    });
}
function sleep0() { return new Promise(function (r) { setTimeout(r, 0); }); }
function readAsArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsArrayBuffer(file);
    });
}
function u8ToB64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
}
function b64ToU8(b64) {
    var bin = atob(b64.replace(/[^A-Za-z0-9+\/=]/g, ''));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}
function escRe(c) { return c.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

var app = {
    docs: [],
    results: [],
    activeDocId: null,
    activePageNum: 1,
    currentNativePdfBlobUrl: null,
    currentNativePdfFileName: '',
    pendingDeleteAction: null,
    cancelFlag: false,
    storageState: 'idb',          // 'idb' | 'memory' | 'error'
    deletedIds: [],
    _flat: null,
    _searchTimer: null,
    _persistTimer: null,

    /* ======================================================================
       0. 부팅
       ====================================================================== */
    init: function () {
        var self = this;
        this._flat = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
        PDFENGINE.load().then(function (st) {
            self.refreshEngineBadge();
            return self.loadDB();
        }).then(function () {
            self.updateSummary();
            self.search();
        });
    },

    refreshEngineBadge: function () {
        var b = document.getElementById('engineBadge');
        var st = PDFENGINE.state;
        if (st.viewerOnly) {
            b.className = 'engine-pill';
            b.textContent = '🔎 검색 전용 모드 (PDF 파싱 엔진 미포함) · 클릭: 보고서';
        } else if (st.ready) {
            b.className = 'engine-pill ready';
            b.textContent = '🛠️ PDF 엔진 내장 (오프라인) · 클릭: 추출 보고서';
        } else {
            b.className = 'engine-pill';
            b.textContent = '⚠️ PDF 엔진 로드 실패 (' + (st.error || '?') + ') · 복붙파싱만 가능';
        }
    },

    /* ======================================================================
       1. 저장소 (IndexedDB) / 내장 색인 / JSON
       ====================================================================== */
    idbOpen: function () {
        if (this._idbP) return this._idbP;
        this._idbP = new Promise(function (resolve) {
            try {
                var rq = indexedDB.open(IDB_NAME, 1);
                rq.onupgradeneeded = function () {
                    var db = rq.result;
                    db.createObjectStore('docs', { keyPath: 'id' });
                    db.createObjectStore('meta');
                };
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror = function () { resolve(null); };
                rq.onblocked = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
        return this._idbP;
    },
    idbRun: function (store, mode, fn) {
        return this.idbOpen().then(function (db) {
            if (!db) return Promise.reject(new Error('IndexedDB 사용 불가'));
            return new Promise(function (resolve, reject) {
                var tx, result;
                try {
                    tx = db.transaction(store, mode);
                    result = fn(tx.objectStore(store));
                } catch (e) { reject(e); return; }
                tx.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : undefined); };
                tx.onerror = function () { reject(tx.error || new Error('저장 오류')); };
                tx.onabort = function () { reject(tx.error || new Error('저장 중단(용량 초과 가능)')); };
            });
        });
    },
    storageFail: function (e) {
        this.storageState = 'error';
        this.updateSummary();
        this.showToast('⚠️ 브라우저 저장 실패: ' + (e && e.message ? e.message : e) + ' — [💾 단일 HTML 저장] 또는 [📦 JSON 백업]으로 보관하세요.');
    },
    persistDoc: function (doc) {
        var self = this;
        doc.savedAt = Date.now();
        var i = this.deletedIds.indexOf(doc.id);
        if (i >= 0) this.deletedIds.splice(i, 1);
        return this.idbRun('docs', 'readwrite', function (st) { return st.put(doc); }).then(function () {
            self.storageState = 'idb';
            return self.idbRun('meta', 'readwrite', function (st) { return st.put(self.deletedIds, 'deleted'); });
        }).catch(function (e) { self.storageFail(e); });
    },
    persistDelete: function (ids) {
        var self = this;
        ids.forEach(function (id) { if (self.deletedIds.indexOf(id) < 0) self.deletedIds.push(id); });
        return this.idbRun('docs', 'readwrite', function (st) { ids.forEach(function (id) { st.delete(id); }); }).then(function () {
            return self.idbRun('meta', 'readwrite', function (st) { return st.put(self.deletedIds, 'deleted'); });
        }).catch(function (e) { self.storageFail(e); });
    },
    persistChecks: function () {
        var self = this;
        clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(function () {
            var map = {};
            self.docs.forEach(function (d) { map[d.id] = d.checked !== false; });
            self.idbRun('meta', 'readwrite', function (st) { return st.put(map, 'checks'); }).catch(function () { });
        }, 300);
    },
    persistAll: function () {
        var self = this;
        var chain = Promise.resolve();
        this.docs.forEach(function (d) { chain = chain.then(function () { return self.persistDoc(d); }); });
        return chain;
    },

    encodeIndex: function (docs) {
        var json = JSON.stringify({ v: 2, docs: docs });
        var u8 = new TextEncoder().encode(json);
        return QX.compress(u8).then(function (z) {
            return 'Z1:' + u8.length + ':' + u8ToB64(z);
        });
    },
    decodeIndex: function (raw) {
        raw = String(raw || '').trim();
        if (raw.indexOf('Z1:') === 0) {
            var p1 = raw.indexOf(':', 3);
            var size = parseInt(raw.slice(3, p1), 10);
            return QX.inflate(b64ToU8(raw.slice(p1 + 1)), size).then(function (u8) {
                return (JSON.parse(new TextDecoder('utf-8').decode(u8)).docs) || [];
            });
        }
        // 구형: Base64(UTF-8 JSON)
        try { return Promise.resolve(JSON.parse(decodeURIComponent(escape(atob(raw.replace(/[^A-Za-z0-9+\/=]/g, ''))))).docs || []); }
        catch (e) { return Promise.reject(e); }
    },

    loadDB: function () {
        var self = this;
        var el = document.getElementById('embedded-pdf-index-b64');
        var raw = el ? el.textContent.trim() : '';
        var embedded = Promise.resolve([]);
        if (raw) embedded = this.decodeIndex(raw).catch(function (e) { console.error(e); self.showToast('내장 색인을 읽지 못했습니다: ' + e.message); return []; });
        var docs = [], idbDocs = [], deleted = [], checks = null;
        return embedded.then(function (d) {
            docs = d;
            return self.idbOpen();
        }).then(function (db) {
            if (!db) { self.storageState = 'memory'; return; }
            return self.idbRun('docs', 'readonly', function (st) { return st.getAll(); }).then(function (all) {
                idbDocs = all || [];
                return self.idbRun('meta', 'readonly', function (st) { return st.get('deleted'); });
            }).then(function (del) {
                deleted = del || [];
                return self.idbRun('meta', 'readonly', function (st) { return st.get('checks'); });
            }).then(function (ck) { checks = ck || null; });
        }).catch(function () { self.storageState = 'memory'; }).then(function () {
            self.deletedIds = deleted.slice();
            var byId = {};
            docs.forEach(function (d) { byId[d.id] = d; });
            idbDocs.forEach(function (d) {
                var e = byId[d.id];
                if (!e || (d.savedAt || 0) >= (e.savedAt || 0)) byId[d.id] = d;
            });
            var merged = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (d) { return deleted.indexOf(d.id) < 0; });
            merged.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
            if (!merged.length) {
                try {
                    var local = localStorage.getItem(STORAGE_KEY_LEGACY);
                    if (local) merged = JSON.parse(decodeURIComponent(escape(atob(local.replace(/[^A-Za-z0-9+\/=]/g, ''))))).docs || [];
                } catch (e) { }
            }
            if (!merged.length) merged = getSampleDocs();
            self.docs = merged;
            self.docs.forEach(function (d) { self.normalizeDoc(d); if (checks && checks[d.id] !== undefined) d.checked = !!checks[d.id]; });
            try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
        });
    },

    normalizeDoc: function (d) {
        if (typeof d.checked !== 'boolean') d.checked = true;
        if (!Array.isArray(d.pages)) d.pages = [];
        // 전송용 슬림 JSON: 빈 쪽(bl)·이미지 쪽(im)은 쪽 번호 목록으로만 실려 오므로 목록에 되살린다(쪽 번호 유지)
        if (Array.isArray(d.bl) || Array.isArray(d.im)) {
            var have = {};
            d.pages.forEach(function (p) { have[p.pageNum] = true; });
            (d.bl || []).forEach(function (n) { if (!have[n]) { d.pages.push({ pageNum: n, text: '', st: 'blank' }); have[n] = true; } });
            (d.im || []).forEach(function (n) { if (!have[n]) { d.pages.push({ pageNum: n, text: '', st: 'img' }); have[n] = true; } });
            d.pages.sort(function (x, y) { return x.pageNum - y.pageNum; });
            delete d.bl; delete d.im;
        }
        if (!d.numPages) {
            var mx = 0;
            d.pages.forEach(function (p) { if (p.pageNum > mx) mx = p.pageNum; });
            d.numPages = Math.max(mx, d.pages.length);
        }
        if (!Array.isArray(d.toc)) d.toc = this.extractTocFromPages(d.pages);
        if (!d.addedAt) d.addedAt = Date.now();
    },

    saveDB: function () { this.updateSummary(); },   // (구버전 호환) 실제 저장은 persist* 가 담당

    updateSummary: function () {
        var totalPages = 0, chars = 0;
        this.docs.forEach(function (d) {
            totalPages += d.numPages || d.pages.length;
            d.pages.forEach(function (p) { chars += (p.text || '').length; });
        });
        var checkedCount = this.docs.filter(function (d) { return d.checked !== false; }).length;
        var mb = (chars * 1.5 / 1048576);
        var stTxt = this.storageState === 'idb' ? '브라우저 저장됨' : (this.storageState === 'memory' ? '⚠ 저장 불가(메모리)' : '⚠ 저장 실패');
        document.getElementById('headerSummary').textContent =
            '등록된 매뉴얼 ' + this.docs.length + '권 (총 ' + totalPages + '쪽) | 텍스트 약 ' + mb.toFixed(1) + ' MB | ' + stTxt;
        document.getElementById('checkedCountText').textContent = checkedCount + '/' + this.docs.length + '권 선택됨';
        document.getElementById('selectedScopeBadge').textContent = '☑️ 선택된 ' + checkedCount + '/' + this.docs.length + '권 내 검색 중';
    },

    /* ======================================================================
       2. 파일 처리 / PDF 추출
       ====================================================================== */
    getOpts: function () {
        return {
            ruled: document.getElementById('optRuled').checked,
            borderless: document.getElementById('optBorderless').checked
        };
    },

    handleFiles: function (fileList) {
        var self = this;
        if (!fileList || !fileList.length) return Promise.resolve();
        var files = [];
        for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);
        var chain = Promise.resolve();
        files.forEach(function (file) { chain = chain.then(function () { return self.handleOneFile(file); }); });
        return chain.then(function () { self.updateSummary(); self.search(); });
    },

    handleOneFile: function (file) {
        var self = this;
        var name = file.name;
        if (/\.json$/i.test(name)) {
            return readText(file).then(function (txt) {
                var parsed = JSON.parse(txt);
                if (!Array.isArray(parsed.docs)) throw new Error('docs 배열이 없습니다');
                var n = 0;
                parsed.docs.forEach(function (d) {
                    self.normalizeDoc(d);
                    var idx = self.docs.findIndex(function (x) { return x.id === d.id || x.fileName === d.fileName; });
                    if (idx >= 0) { d.id = self.docs[idx].id; self.docs[idx] = d; } else self.docs.push(d);
                    n++;
                });
                return self.persistAll().then(function () { self.showToast('JSON 색인 ' + n + '권을 불러왔습니다(같은 이름은 교체, 나머지는 유지).'); });
            }).catch(function (e) { self.showToast('JSON 파일 형식이 올바르지 않습니다: ' + e.message); });
        }
        if (/\.txt$/i.test(name)) {
            return readText(file).then(function (txt) {
                var doc = self.upsertDoc(name, self.chunkText(txt), { numPages: 0 });
                return self.persistDoc(doc).then(function () { self.showToast('\'' + name + '\' 텍스트 등록 및 목차 추출 완료!'); });
            });
        }
        // PDF
        self.prepareNativePdfViewerFile(file);
        if (!PDFENGINE.state.ready) {
            if (PDFENGINE.state.viewerOnly) self.showToast('검색 전용 HTML 에는 PDF 파싱 엔진이 없습니다. 원본 뷰어 복붙 파싱만 가능합니다(전체 검색기에서 PDF 를 파싱하세요).');
            self.openPdfInNativeBrowserViewer(file);
            return Promise.resolve();
        }
        return self.parsePdfFile(file).then(function (res) {
            if (!res) return;
            var doc = self.upsertDoc(name, res.pages, { numPages: res.report.numPages, report: res.report });
            return self.persistDoc(doc).then(function () {
                var r = res.report;
                var msg = '✅ \'' + name + '\' PDF ' + r.numPages + '쪽 → 글 ' + r.ok + '쪽 · 빈 쪽 ' + r.blank + ' · 이미지 ' + r.img + (r.fail ? ' · ⚠실패 ' + r.fail : '') + (r.tables ? ' · 표 ' + r.tables + '개' : '');
                self.showToast(msg);
                if (r.fail || r.cancelled || r.pua > 0) setTimeout(function () { self.openReportModal(); }, 600);
            });
        }).catch(function (err) {
            console.error(err);
            self.hideParse();
            self.showToast('PDF 자동 추출 실패(' + (err && err.message ? err.message : err) + ') — 원본 뷰어에서 복붙 파싱을 이용하세요.');
            self.openPdfInNativeBrowserViewer(file);
        });
    },

    askPassword: function (task) {
        return function (update, reason) {
            var pw = window.prompt(reason === 2 ? '비밀번호가 틀렸습니다. 다시 입력하세요 (취소=건너뜀)' : '암호가 걸린 PDF 입니다. 열기 비밀번호를 입력하세요 (취소=건너뜀)');
            if (pw === null || pw === '') { try { task.destroy(); } catch (e) { } return; }
            update(pw);
        };
    },

    parsePdfFile: function (file) {
        var self = this;
        var opts = this.getOpts();
        var t0 = Date.now();
        this.cancelFlag = false;
        this.showParse(file.name);
        return readAsArrayBuffer(file).then(function (buf) {
            var task = null;
            var promiseOpen = new Promise(function (resolve, reject) {
                task = window.pdfjsLib.getDocument({
                    data: buf, CMapReaderFactory: PDFENGINE.cmapFactory(), cMapPacked: true,
                    verbosity: 0, isEvalSupported: false, useSystemFonts: false, disableFontFace: true
                });
                task.onPassword = self.askPassword(task);
                task.promise.then(resolve, reject);
            });
            return promiseOpen;
        }).then(function (pdf) {
            var N = pdf.numPages;
            var pages = [];
            var rep = { fileName: file.name, numPages: N, ok: 0, blank: 0, img: 0, fail: 0, failPages: [], tables: 0, borderless: 0, chars: 0, pua: 0, puaPages: [], cancelled: false, sec: 0, opts: opts, engine: 'PDF.js ' + PDFENGINE.state.version + ' (내장)' };
            var p = 1;
            function step() {
                if (p > N || self.cancelFlag) return Promise.resolve();
                var pn = p++;
                return self.extractOnePage(pdf, pn, opts).then(function (r) {
                    pages.push(r.page);
                    if (r.page.st === 'fail') { rep.fail++; if (rep.failPages.length < 60) rep.failPages.push(pn); }
                    else if (r.page.st === 'blank') rep.blank++;
                    else if (r.page.st === 'img') rep.img++;
                    else rep.ok++;
                    rep.tables += r.tables; rep.borderless += r.borderless; rep.chars += (r.page.text || '').length;
                    if (r.pua > 0) { rep.pua += r.pua; if (rep.puaPages.length < 40) rep.puaPages.push(pn); }
                    if (pn % 4 === 0 || pn === N) {
                        self.updateParse(pn, N, rep, t0);
                        return sleep0().then(step);
                    }
                    return step();
                });
            }
            return step().then(function () {
                rep.cancelled = self.cancelFlag && (pages.length < N);
                rep.sec = Math.round((Date.now() - t0) / 100) / 10;
                try { pdf.cleanup(); pdf.destroy(); } catch (e) { }
                self.hideParse();
                if (!pages.length) return null;
                return { pages: pages, report: rep };
            });
        });
    },

    // 쪽 하나 추출 (실패해도 예외를 던지지 않고 fail 쪽으로 기록 → 다음 쪽 계속)
    extractOnePage: function (pdf, pn, opts) {
        var OPS = window.pdfjsLib.OPS;
        var pageObj = null;
        return withTimeout(pdf.getPage(pn), 30000, pn + '쪽 열기').then(function (page) {
            pageObj = page;
            var vp = page.getViewport({ scale: 1 });
            return withTimeout(page.getTextContent({ disableCombineTextItems: true }), 60000, pn + '쪽 텍스트').then(function (tc) {
                return withTimeout(page.getOperatorList(), 60000, pn + '쪽 도형').catch(function () { return null; }).then(function (ol) {
                    var pd = PL.fromPdfJs(tc, ol, OPS, vp.transform, vp.width, vp.height);
                    var comp = PL.composePage(pd, opts);
                    var text = comp.text.replace(/[ \t]+$/gm, '').trim();
                    var st = text ? 'ok' : (pd.hasImage ? 'img' : 'blank');
                    var puaRatio = text.length ? pd.pua / text.length : 0;
                    var rec = { pageNum: pn, text: text };
                    if (st !== 'ok') rec.st = st;
                    return { page: rec, tables: comp.stats.tables, borderless: comp.stats.borderlessTables, pua: (puaRatio > 0.03 || pd.pua > 8) ? pd.pua : 0 };
                });
            });
        }).catch(function (err) {
            return { page: { pageNum: pn, text: '', st: 'fail', err: String(err && err.message ? err.message : err).slice(0, 120) }, tables: 0, borderless: 0, pua: 0 };
        }).then(function (r) {
            try { if (pageObj) pageObj.cleanup(); } catch (e) { }
            return r;
        });
    },

    showParse: function (fileName) {
        document.getElementById('parseFile').textContent = fileName;
        document.getElementById('parseBar').style.width = '0';
        document.getElementById('parseStat').textContent = '엔진 준비 중…';
        document.getElementById('parseModal').classList.add('open');
    },
    updateParse: function (pn, N, rep, t0) {
        var el = (Date.now() - t0) / 1000;
        var rate = pn / Math.max(el, 0.1);
        var eta = (N - pn) / Math.max(rate, 0.01);
        document.getElementById('parseBar').style.width = (pn / N * 100).toFixed(1) + '%';
        document.getElementById('parseStat').innerHTML =
            pn + ' / ' + N + '쪽 처리 · 경과 ' + Math.round(el) + '초 · 남은 약 ' + Math.round(eta) + '초<br>' +
            '글 있는 쪽 ' + rep.ok + ' · 빈 쪽 ' + rep.blank + ' · 이미지 쪽 ' + rep.img + ' · 실패 ' + rep.fail + ' · 표 ' + (rep.tables + rep.borderless) + '개';
    },
    hideParse: function () { document.getElementById('parseModal').classList.remove('open'); },
    cancelParsing: function () { this.cancelFlag = true; },

    prepareNativePdfViewerFile: function (file) {
        if (this.currentNativePdfBlobUrl) URL.revokeObjectURL(this.currentNativePdfBlobUrl);
        this.currentNativePdfBlobUrl = URL.createObjectURL(file);
        this.currentNativePdfFileName = file.name;
        document.getElementById('nativePdfIframe').src = this.currentNativePdfBlobUrl;
        document.getElementById('togglePdfViewBtn').style.display = 'inline-flex';
        document.getElementById('togglePdfViewBtn').textContent = '📄 원본 PDF 뷰어 (복붙파싱)';
    },

    openPdfInNativeBrowserViewer: function (file) {
        this.prepareNativePdfViewerFile(file);
        document.getElementById('readerTitle').textContent = '📄 원본 PDF 열람: ' + file.name;
        document.getElementById('readerBox').style.display = 'none';
        document.getElementById('readerCurrentSectionBar').style.display = 'none';
        document.getElementById('tocDrawerBox').classList.remove('open');
        document.getElementById('nativePdfWrap').classList.add('active');
        document.getElementById('togglePdfViewBtn').textContent = '📖 원문 텍스트 뷰어로';
        this.showToast('\'' + file.name + '\' 열림! 우측 PDF 화면 클릭 후 Ctrl+A → Ctrl+C → [⚡ 클립보드 즉시 파싱]을 누르세요.');
    },

    toggleNativePdfViewer: function () {
        var wrap = document.getElementById('nativePdfWrap');
        var rBox = document.getElementById('readerBox');
        var btn = document.getElementById('togglePdfViewBtn');
        if (wrap.classList.contains('active')) {
            wrap.classList.remove('active');
            rBox.style.display = 'block';
            btn.textContent = '📄 원본 PDF 뷰어 (복붙파싱)';
        } else {
            wrap.classList.add('active');
            rBox.style.display = 'none';
            btn.textContent = '📖 원문 텍스트 뷰어로';
        }
    },

    captureClipboardToActivePdf: function () {
        var self = this;
        if (!navigator.clipboard || !navigator.clipboard.readText) { this.openPasteModalWithCurrentPdfName(); return Promise.resolve(); }
        return navigator.clipboard.readText().then(function (text) {
            if (!text || !text.trim()) { self.openPasteModalWithCurrentPdfName(); return; }
            var title = self.currentNativePdfFileName || ('매뉴얼_' + (self.docs.length + 1) + '.pdf');
            var pages = self.chunkText(text);
            var doc = self.upsertDoc(title, pages, { numPages: 0 });
            return self.persistDoc(doc).then(function () {
                self.updateSummary(); self.search(); self.toggleNativePdfViewer();
                self.showToast('🎉 \'' + title + '\' (' + pages.length + '구간) 복붙 파싱 및 목차 추출 완료!');
            });
        }).catch(function () { self.openPasteModalWithCurrentPdfName(); });
    },

    openPasteModalWithCurrentPdfName: function () {
        document.getElementById('pasteTitle').value = this.currentNativePdfFileName || ('매뉴얼_' + (this.docs.length + 1) + '.pdf');
        document.getElementById('pasteBody').value = '';
        this.openPasteModal();
        setTimeout(function () { document.getElementById('pasteBody').focus(); }, 60);
    },
    openPasteModal: function () { document.getElementById('pasteModal').classList.add('open'); },
    closePasteModal: function () { document.getElementById('pasteModal').classList.remove('open'); },

    savePasteDoc: function () {
        var self = this;
        var title = document.getElementById('pasteTitle').value.trim() || ('복붙매뉴얼_' + (this.docs.length + 1) + '.pdf');
        var body = document.getElementById('pasteBody').value.trim();
        if (!body) { this.showToast('본문 텍스트를 붙여넣어 주세요.'); return Promise.resolve(); }
        var pages = this.chunkText(body);
        var doc = this.upsertDoc(title, pages, { numPages: 0 });
        return this.persistDoc(doc).then(function () {
            self.updateSummary(); self.search(); self.closePasteModal();
            if (document.getElementById('nativePdfWrap').classList.contains('active')) self.toggleNativePdfViewer();
            self.showToast('✅ \'' + title + '\' (' + pages.length + '구간) 복붙 파싱 및 자동 목차 추출 완료!');
        });
    },

    // 붙여넣은 텍스트 → 구간. 쪽 구분(\f)이 있으면 그대로, 없으면 문단 경계에서만 나눔(문장·표가 중간에서 잘리지 않게)
    chunkText: function (rawText) {
        var normalized = (rawText || '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
        if (!normalized) return [];
        if (normalized.indexOf('\f') >= 0) {
            var parts = normalized.split('\f');
            var out = [];
            parts.forEach(function (s, idx) {
                var t = s.trim();
                var rec = { pageNum: idx + 1, text: t };
                if (!t) rec.st = 'blank';
                out.push(rec);
            });
            while (out.length && !out[out.length - 1].text) out.pop();
            return out;
        }
        var paras = normalized.split(/\n[ \t]*\n/);
        var pages = [], buf = [], len = 0, LIMIT = 2800;
        function flush() {
            if (buf.length) { pages.push({ pageNum: pages.length + 1, text: buf.join('\n\n') }); buf = []; len = 0; }
        }
        paras.forEach(function (para) {
            if (para.length > 6000) { // 너무 긴 문단은 줄 단위로만 분할
                flush();
                var lines = para.split('\n'), acc = [], l2 = 0;
                lines.forEach(function (ln) {
                    acc.push(ln); l2 += ln.length + 1;
                    if (l2 >= 3000) { pages.push({ pageNum: pages.length + 1, text: acc.join('\n') }); acc = []; l2 = 0; }
                });
                if (acc.length) pages.push({ pageNum: pages.length + 1, text: acc.join('\n') });
                return;
            }
            if (len + para.length > LIMIT && buf.length) flush();
            buf.push(para); len += para.length + 2;
        });
        flush();
        return pages;
    },

    upsertDoc: function (fileName, pages, extra) {
        extra = extra || {};
        var keepBoth = document.getElementById('optKeepBoth') && document.getElementById('optKeepBoth').checked;
        var name = fileName;
        if (keepBoth) {
            var n = 2;
            while (this.docs.some(function (d) { return d.fileName === name; })) {
                var dot = fileName.lastIndexOf('.');
                name = (dot > 0 ? fileName.slice(0, dot) : fileName) + ' (' + n++ + ')' + (dot > 0 ? fileName.slice(dot) : '');
            }
        }
        var idx = this.docs.findIndex(function (d) { return d.fileName === name; });
        var doc = {
            id: idx >= 0 ? this.docs[idx].id : 'doc_' + Date.now() + Math.random().toString(36).slice(2, 6),
            fileName: name,
            checked: idx >= 0 ? this.docs[idx].checked : true,
            pages: pages,
            numPages: extra.numPages || 0,
            report: extra.report || null,
            toc: this.extractTocFromPages(pages),
            addedAt: Date.now()
        };
        this.normalizeDoc(doc);
        if (idx >= 0) this.docs[idx] = doc; else this.docs.unshift(doc);
        return doc;
    },

    /* ======================================================================
       3. 체크박스 선택 / 삭제 확인
       ====================================================================== */
    toggleDocCheck: function (docId, isChecked) {
        var doc = this.docs.find(function (d) { return d.id === docId; });
        if (!doc) return;
        doc.checked = !!isChecked;
        this.persistChecks();
        this.updateSummary();
        this.search();
    },
    toggleAllDocsCheck: function (checkState) {
        this.docs.forEach(function (d) { d.checked = !!checkState; });
        this.persistChecks();
        this.updateSummary();
        this.search();
    },

    confirmDeleteSelectedDocs: function () {
        var self = this;
        var selected = this.docs.filter(function (d) { return d.checked !== false; });
        if (selected.length === 0) { this.showToast('⚠️ 삭제할 매뉴얼이 선택되어 있지 않습니다. 먼저 체크박스를 선택해 주세요.'); return; }
        document.getElementById('confirmDeleteTitle').textContent = '🗑️ 선택한 매뉴얼 삭제 확인 (' + selected.length + '권)';
        document.getElementById('confirmDeleteDesc').textContent = '체크박스로 선택된 아래 ' + selected.length + '권의 매뉴얼을 정말 삭제하시겠습니까? (선택 해제된 매뉴얼은 유지됩니다)';
        document.getElementById('confirmDeleteFileList').innerHTML = selected.map(function (d, idx) {
            return '<div>' + (idx + 1) + '. 📄 <strong>' + self.escapeHtml(d.fileName) + '</strong> (' + (d.numPages || d.pages.length) + '쪽)</div>';
        }).join('');
        this.pendingDeleteAction = function () {
            var ids = selected.map(function (d) { return d.id; });
            self.docs = self.docs.filter(function (d) { return d.checked === false; });
            self.persistDelete(ids);
            self.updateSummary(); self.search();
            self.showToast('🗑️ 선택한 매뉴얼 ' + ids.length + '권이 삭제되었습니다.');
        };
        document.getElementById('confirmDeleteExecuteBtn').onclick = function () {
            if (self.pendingDeleteAction) self.pendingDeleteAction();
            self.closeConfirmDeleteModal();
        };
        document.getElementById('confirmDeleteModal').classList.add('open');
    },

    removeDoc: function (id) {
        var self = this;
        var target = this.docs.find(function (d) { return d.id === id; });
        if (!target) return;
        document.getElementById('confirmDeleteTitle').textContent = '🗑️ 매뉴얼 개별 삭제 확인';
        document.getElementById('confirmDeleteDesc').textContent = '아래 매뉴얼을 목록에서 정말 삭제하시겠습니까?';
        document.getElementById('confirmDeleteFileList').innerHTML = '<div>📄 <strong>' + this.escapeHtml(target.fileName) + '</strong> (총 ' + (target.numPages || target.pages.length) + '쪽)</div>';
        this.pendingDeleteAction = function () {
            self.docs = self.docs.filter(function (d) { return d.id !== id; });
            self.persistDelete([id]);
            self.updateSummary(); self.search();
            self.showToast('🗑️ \'' + target.fileName + '\' 매뉴얼이 삭제되었습니다.');
        };
        document.getElementById('confirmDeleteExecuteBtn').onclick = function () {
            if (self.pendingDeleteAction) self.pendingDeleteAction();
            self.closeConfirmDeleteModal();
        };
        document.getElementById('confirmDeleteModal').classList.add('open');
    },

    closeConfirmDeleteModal: function () {
        document.getElementById('confirmDeleteModal').classList.remove('open');
        this.pendingDeleteAction = null;
    },

    escapeHtml: function (str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /* ======================================================================
       4. 자동 목차 (장·절·조·항·대제목)
       ====================================================================== */
    extractTocFromPages: function (pages) {
        var tocList = [];
        var headingPatterns = [
            { level: 1, rgx: /^(?:\[?\s*제\s*\d+\s*(?:편|장|절|관)\s*[^\n\]]*\]?)/ },
            { level: 2, rgx: /^(?:제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)\n]+\))?[^\n]*)/ },
            { level: 1, rgx: /^(?:[\[【■◆●]\s*[^\n\]】]{2,45}[\]】]?)/ },
            { level: 2, rgx: /^(?:(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d{1,2}|[가나다라마바사아자차카타파하])\.\s+[^\n]{2,40})$/ }
        ];
        (pages || []).forEach(function (pg) {
            var txt = pg.text || '';
            if (!txt) return;
            var lines = txt.split('\n');
            var charCursor = 0;
            for (var li = 0; li < lines.length; li++) {
                var rawLine = lines[li];
                var trimmed = rawLine.trim();
                if (trimmed.length >= 3 && trimmed.length <= 58) {
                    var isSentence = /(?:다|함|음|됨|임|한다|있다|없다|바란다)\.$/.test(trimmed);
                    if (!isSentence) {
                        for (var pi = 0; pi < headingPatterns.length; pi++) {
                            if (headingPatterns[pi].rgx.test(trimmed)) {
                                tocList.push({ pageNum: pg.pageNum, offset: charCursor, level: headingPatterns[pi].level, title: trimmed.replace(/\s+/g, ' ') });
                                break;
                            }
                        }
                    }
                }
                charCursor += rawLine.length + 1;
            }
        });
        return tocList;
    },

    resolveTocBreadcrumb: function (doc, pageNum, charOffset) {
        if (charOffset === undefined) charOffset = 999999;
        if (!doc) return '';
        if (!Array.isArray(doc.toc)) doc.toc = this.extractTocFromPages(doc.pages || []);
        var toc = doc.toc;
        if (!toc.length) return '일반 본문 (목차 없음)';
        var lastLevel1 = null, lastLevel2 = null;
        for (var i = 0; i < toc.length; i++) {
            var item = toc[i];
            if (item.pageNum < pageNum || (item.pageNum === pageNum && item.offset <= charOffset)) {
                if (item.level === 1) { lastLevel1 = item.title; lastLevel2 = null; } else lastLevel2 = item.title;
            } else break;
        }
        if (lastLevel1 && lastLevel2 && lastLevel1 !== lastLevel2) return lastLevel1 + ' ▸ ' + lastLevel2;
        return lastLevel1 || lastLevel2 || toc[0].title;
    },

    /* ======================================================================
       5. 다중·근접 검색 (공백/줄바꿈/표 칸 경계를 무시하고 일치)
       ====================================================================== */
    parseSearchQuery: function (rawQuery, defaultProxLimit) {
        var q = (rawQuery || '').normalize('NFC').trim();
        if (!q) return { mode: 'EMPTY', terms: [], proxLimit: defaultProxLimit };
        var explicitProxMatch = q.match(/^(.+?)\s*~(\d+)\s*(.+)$/);
        if (explicitProxMatch) {
            var customDist = parseInt(explicitProxMatch[2], 10);
            var rawRest = explicitProxMatch[1] + ' + ' + explicitProxMatch[3];
            var terms0 = rawRest.split(/\s*(?:\+|&|\s)\s*/).map(function (s) { return s.replace(/^["']|["']$/g, '').trim(); }).filter(Boolean);
            return { mode: 'AND', terms: terms0, proxLimit: customDist };
        }
        if (q.indexOf('|') >= 0) {
            var terms1 = q.split('|').map(function (s) { return s.replace(/^["']|["']$/g, '').trim(); }).filter(Boolean);
            return { mode: 'OR', terms: terms1, proxLimit: 0 };
        }
        var terms = [];
        var tokenRgx = /"([^"]+)"|'([^']+)'|([^\s+&]+)/g, m;
        while ((m = tokenRgx.exec(q)) !== null) {
            var word = (m[1] || m[2] || m[3] || '').trim();
            if (word && word !== '+' && word !== '&') terms.push(word);
        }
        return { mode: terms.length > 1 ? 'AND' : 'SINGLE', terms: terms, proxLimit: defaultProxLimit };
    },

    // 용어 → 글자 사이 공백/줄바꿈/표 경계를 허용하는 정규식
    termRegex: function (term, flags) {
        var parts = [];
        for (var i = 0; i < term.length; i++) {
            var c = term.charAt(i);
            if (/\s/.test(c)) continue;
            parts.push(escRe(c));
        }
        if (!parts.length) return null;
        return new RegExp(parts.join('[\\s\\u241E\\u241F]*'), flags || 'gi');
    },
    flatOf: function (pg) {
        var f = this._flat ? this._flat.get(pg) : null;
        if (f === undefined || f === null) {
            f = (pg.text || '').toLowerCase().replace(/[\s␞␟]+/g, '');
            if (this._flat) this._flat.set(pg, f);
        }
        return f;
    },
    snippetOf: function (txt, s, e) {
        var seg = PL.toPlain(txt.slice(s, e)).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
        return (s > 0 ? '… ' : '') + seg + (e < txt.length ? ' …' : '');
    },

    findProximityMatchesInPage: function (pg, parsedQuery, snippetRadius) {
        var mode = parsedQuery.mode, terms = parsedQuery.terms, proxLimit = parsedQuery.proxLimit;
        var txt = pg.text || '';
        var results = [], i, m;
        if (!txt) return results;
        var flat = this.flatOf(pg);
        var self = this;
        function flatTerm(t) { return t.toLowerCase().replace(/\s+/g, ''); }

        if (mode === 'SINGLE' || mode === 'OR') {
            terms.forEach(function (term) {
                var ft = flatTerm(term);
                if (!ft || flat.indexOf(ft) < 0) return;
                var rgx = self.termRegex(term);
                if (!rgx) return;
                while ((m = rgx.exec(txt)) !== null) {
                    if (m[0].length === 0) { rgx.lastIndex++; continue; }
                    var s = Math.max(0, m.index - snippetRadius);
                    var e = Math.min(txt.length, m.index + m[0].length + snippetRadius);
                    results.push({ matchOffset: m.index, spanDist: 0, snippet: self.snippetOf(txt, s, e) });
                }
            });
            return results.sort(function (a, b) { return a.matchOffset - b.matchOffset; });
        }

        var termPositions = [];
        for (i = 0; i < terms.length; i++) {
            var ft2 = flatTerm(terms[i]);
            if (!ft2 || flat.indexOf(ft2) < 0) return [];
            var rg = this.termRegex(terms[i]);
            if (!rg) return [];
            var positions = [];
            while ((m = rg.exec(txt)) !== null) {
                if (m[0].length === 0) { rg.lastIndex++; continue; }
                positions.push({ start: m.index, end: m.index + m[0].length, len: ft2.length });
                rg.lastIndex = m.index + 1;
            }
            if (!positions.length) return [];
            termPositions.push(positions);
        }
        var anchorList = termPositions[0];
        var used = [];
        var sumLen = 0;
        termPositions.forEach(function (tp) { sumLen += tp[0].len; });
        for (var a = 0; a < anchorList.length; a++) {
            var anchor = anchorList[a];
            var minStart = anchor.start, maxEnd = anchor.end, allFound = true;
            for (var k = 1; k < termPositions.length; k++) {
                var cands = termPositions[k], bestCand = null, bestDist = Infinity;
                for (var c = 0; c < cands.length; c++) {
                    var cand = cands[c];
                    var dist = cand.start >= anchor.end ? cand.start - anchor.end : (anchor.start >= cand.end ? anchor.start - cand.end : 0);
                    if (dist < bestDist) { bestDist = dist; bestCand = cand; }
                }
                if (!bestCand) { allFound = false; break; }
                minStart = Math.min(minStart, bestCand.start);
                maxEnd = Math.max(maxEnd, bestCand.end);
            }
            if (!allFound) continue;
            var totalSpan = maxEnd - minStart;
            var innerGap = Math.max(0, totalSpan - sumLen);
            if (proxLimit > 0 && innerGap > proxLimit) continue;
            var dup = used.some(function (r) { return Math.abs(r.minStart - minStart) < 25 && Math.abs(r.maxEnd - maxEnd) < 25; });
            if (dup) continue;
            used.push({ minStart: minStart, maxEnd: maxEnd });
            var s2 = Math.max(0, minStart - snippetRadius);
            var e2 = Math.min(txt.length, maxEnd + snippetRadius);
            results.push({ matchOffset: minStart, spanDist: innerGap, snippet: this.snippetOf(txt, s2, e2) });
        }
        return results;
    },

    quickSearch: function (kw) {
        document.getElementById('searchInput').value = kw;
        this.search();
    },

    searchDebounced: function () {
        var self = this;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(function () { self.search(); }, 220);
    },

    search: function () {
        var rawQ = document.getElementById('searchInput').value || '';
        var radius = parseInt(document.getElementById('radiusSelect').value || '110', 10);
        var defaultProx = parseInt(document.getElementById('proxLimitSelect').value || '120', 10);
        var parsedQuery = this.parseSearchQuery(rawQ, defaultProx);
        var mode = parsedQuery.mode, terms = parsedQuery.terms;
        var hits = [], docCounts = {}, self = this;
        this.docs.forEach(function (doc) {
            if (!Array.isArray(doc.toc)) doc.toc = self.extractTocFromPages(doc.pages || []);
            docCounts[doc.id] = 0;
        });
        if (terms.length > 0) {
            this.docs.forEach(function (doc) {
                if (doc.checked === false) return;
                (doc.pages || []).forEach(function (pg) {
                    var pageMatches = self.findProximityMatchesInPage(pg, parsedQuery, radius);
                    pageMatches.forEach(function (m) {
                        hits.push({
                            docId: doc.id, fileName: doc.fileName, pageNum: pg.pageNum, snippet: m.snippet,
                            tocPath: self.resolveTocBreadcrumb(doc, pg.pageNum, m.matchOffset),
                            spanDist: m.spanDist, isMultiAnd: mode === 'AND' && terms.length > 1, terms: terms
                        });
                        docCounts[doc.id]++;
                    });
                });
            });
        }
        this.results = hits;
        this.renderDocs(docCounts, terms.length > 0);
        this.renderResults(hits, terms, parsedQuery);
        if (hits.length > 0) this.openReader(hits[0].docId, hits[0].pageNum, terms, 0);
    },

    // 원문에서 용어 위치를 찾아 <mark> 처리 (공백 무시 일치, HTML 이스케이프 안전)
    highlight: function (text, terms) {
        text = String(text || '');
        var ranges = [], self = this;
        (terms || []).filter(Boolean).forEach(function (t) {
            var rg = self.termRegex(t);
            if (!rg) return;
            var m;
            while ((m = rg.exec(text)) !== null) {
                if (m[0].length === 0) { rg.lastIndex++; continue; }
                ranges.push([m.index, m.index + m[0].length]);
                rg.lastIndex = m.index + 1;
            }
        });
        if (!ranges.length) return this.escapeHtml(text);
        ranges.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
        var merged = [ranges[0].slice()];
        for (var i = 1; i < ranges.length; i++) {
            var last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) { if (ranges[i][1] > last[1]) last[1] = ranges[i][1]; }
            else merged.push(ranges[i].slice());
        }
        var out = '', pos = 0;
        merged.forEach(function (r) {
            out += self.escapeHtml(text.slice(pos, r[0])) + '<mark class="hit">' + self.escapeHtml(text.slice(r[0], r[1])) + '</mark>';
            pos = r[1];
        });
        return out + this.escapeHtml(text.slice(pos));
    },

    /* ======================================================================
       6. 목록 / 결과 / 리더
       ====================================================================== */
    renderDocs: function (counts, hasQuery) {
        counts = counts || {};
        var box = document.getElementById('docList');
        var self = this;
        if (!this.docs.length) {
            box.innerHTML = '<div style="padding:2rem 1rem; text-align:center; color:var(--text-muted); font-size:0.83rem;">등록된 매뉴얼이 없습니다.<br>PDF 를 위 영역에 끌어다 놓으세요.</div>';
            return;
        }
        box.innerHTML = this.docs.map(function (d) {
            var isChecked = d.checked !== false;
            var tocCount = Array.isArray(d.toc) ? d.toc.length : 0;
            var hitCnt = counts[d.id] || 0;
            var r = d.report;
            var pagesTxt = '총 ' + (d.numPages || d.pages.length) + '쪽';
            var extra = '';
            if (r) {
                extra = ' <span title="글 있는 쪽 / 빈 쪽 / 이미지 쪽" style="color:var(--text-muted);">(글 ' + r.ok + ' · 빈 ' + r.blank + ' · 그림 ' + r.img + ')</span>';
                if (r.fail) extra += ' <span class="rep-bad" onclick="event.stopPropagation(); app.openReportModal()" title="추출 실패 쪽 있음 — 클릭하여 보고서 보기">⚠실패 ' + r.fail + '</span>';
                else if (r.cancelled) extra += ' <span class="rep-warn" onclick="event.stopPropagation(); app.openReportModal()">⛔중단됨</span>';
            }
            return '<div class="doc-item ' + (isChecked ? 'checked-doc' : 'unchecked-doc') + '">' +
                '<input type="checkbox" class="doc-checkbox" ' + (isChecked ? 'checked' : '') + ' onchange="app.toggleDocCheck(\'' + d.id + '\', this.checked)" title="체크된 매뉴얼만 검색 및 선택삭제 대상에 포함됩니다">' +
                '<div class="doc-item-body" onclick="app.openReader(\'' + d.id + '\', ' + (d.pages[0] ? d.pages[0].pageNum : 1) + ')">' +
                '<div style="display:flex; justify-content:space-between; font-size:0.74rem; color:var(--text-secondary);">' +
                '<span>' + pagesTxt + ' · 📑목차 ' + tocCount + '개' + extra + '</span><div>' +
                (hasQuery && isChecked ? '<strong style="color:#b45309;">' + hitCnt + '건</strong>' : '') +
                (!isChecked ? '<span style="color:var(--text-muted);">[제외됨]</span>' : '') +
                '<span style="color:var(--danger); margin-left:6px; font-weight:900;" onclick="event.stopPropagation(); app.removeDoc(\'' + d.id + '\')" title="이 매뉴얼 삭제">✕</span></div></div>' +
                '<div style="font-weight:900; font-size:0.86rem; margin-top:2px; word-break:break-all;">📄 ' + self.escapeHtml(d.fileName) + '</div>' +
                '</div></div>';
        }).join('');
    },

    renderResults: function (hits, terms, parsedQuery) {
        var self = this;
        document.getElementById('hitCount').textContent = hits.length;
        var box = document.getElementById('resultList');
        var checkedDocsCount = this.docs.filter(function (d) { return d.checked !== false; }).length;
        if (checkedDocsCount === 0) {
            box.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--warning); font-weight:800;">⚠️ 좌측 목록에서 검색할 매뉴얼의 체크박스를 1권 이상 선택하세요.</div>';
            return;
        }
        if (!terms.length) {
            box.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted);">상단 검색창에 단어를 입력하세요.<br><small>예: <code>보완 + 기한</code>, <code>이송 | 반려</code>, <code>보완 ~40 연장</code> · 줄바꿈·표 칸 경계가 있어도 찾습니다</small></div>';
            return;
        }
        if (!hits.length) {
            var hint = parsedQuery && parsedQuery.mode === 'AND' && parsedQuery.proxLimit > 0
                ? '<br><small style="color:var(--primary);">💡 다중단어 간격(' + parsedQuery.proxLimit + '자)을 넓히거나 \'간격 무제한\'으로 변경해 보세요.</small>' : '';
            box.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted);">선택된 ' + checkedDocsCount + '권의 매뉴얼 내에서 일치하는 결과가 없습니다.' + hint + '</div>';
            return;
        }
        var SHOW = 400;  // 결과 카드가 너무 많으면 화면이 느려지므로 상위 400건만 표시
        var shown = hits.slice(0, SHOW);
        box.innerHTML = shown.map(function (h, i) {
            return '<div class="snippet-card" id="res_' + i + '" onclick="app.openReader(\'' + h.docId + '\', ' + h.pageNum + ', null, ' + i + ')">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:900; flex-wrap:wrap;">' +
                '<span style="color:var(--primary);">📄 ' + self.escapeHtml(h.fileName) + '</span>' +
                '<div style="display:flex; align-items:center; gap:0.35rem;">' +
                (h.isMultiAnd ? '<span class="prox-dist-badge" title="다중 검색어들 사이의 글자 간격">↔ 간격 ' + h.spanDist + '자</span>' : '') +
                '<span style="color:var(--accent);">p.' + h.pageNum + '쪽</span></div></div>' +
                '<div class="toc-breadcrumb" title="자동 추출된 소속 목차">📑 ' + self.highlight(h.tocPath || '일반 본문', terms) + '</div>' +
                '<div class="snippet-body">' + self.highlight(h.snippet, terms) + '</div></div>';
        }).join('') + (hits.length > SHOW ? '<div style="padding:0.8rem; text-align:center; color:var(--text-muted); font-size:0.8rem;">… 외 ' + (hits.length - SHOW) + '건 (검색어를 더 구체적으로 입력하세요)</div>' : '');
    },

    // 쪽 텍스트 → 리더 HTML (표 행은 실제 표로, 나머지는 줄 단위)
    renderPageHtml: function (pg, terms) {
        var self = this;
        if (pg.st === 'blank') return '<div class="pg-note">(이 쪽은 PDF 에 내용이 없는 빈 쪽입니다)</div>';
        if (pg.st === 'img' && !pg.text) return '<div class="pg-note">(글자 없이 이미지·그림만 있는 쪽입니다 — 스캔본이면 원본 PDF 뷰어로 확인하세요)</div>';
        if (pg.st === 'fail') return '<div class="pg-note" style="color:#b91c1c;">(이 쪽은 자동 추출에 실패했습니다' + (pg.err ? ': ' + this.escapeHtml(pg.err) : '') + ' — 원본 PDF 뷰어로 확인하세요)</div>';
        var lines = String(pg.text || '').split('\n');
        var html = '', i = 0;
        while (i < lines.length) {
            if (lines[i].charAt(0) === PL.ROW) {
                var rows = [];
                while (i < lines.length && lines[i].charAt(0) === PL.ROW) { rows.push(lines[i].slice(1).split(PL.CELL)); i++; }
                html += '<table class="rtbl">' + rows.map(function (cells) {
                    return '<tr>' + cells.map(function (c) { return '<td>' + self.highlight(c, terms) + '</td>'; }).join('') + '</tr>';
                }).join('') + '</table>';
            } else {
                html += '<div class="rline">' + (lines[i] ? this.highlight(lines[i], terms) : '&nbsp;') + '</div>';
                i++;
            }
        }
        return html;
    },

    openReader: function (docId, pageNum, terms, resIdx) {
        var doc = this.docs.find(function (d) { return d.id === docId; });
        if (!doc) return;
        var pg = doc.pages.find(function (p) { return p.pageNum === pageNum; }) || doc.pages[0];
        if (!pg) return;
        this.activeDocId = doc.id;
        this.activePageNum = pg.pageNum;
        document.getElementById('nativePdfWrap').classList.remove('active');
        var rBox = document.getElementById('readerBox');
        rBox.style.display = 'block';
        var cards = document.querySelectorAll('.snippet-card');
        for (var ci = 0; ci < cards.length; ci++) cards[ci].classList.toggle('active', ci === resIdx);
        document.getElementById('readerTitle').textContent = '📖 ' + doc.fileName;
        document.getElementById('pageIndicator').textContent = pg.pageNum + '/' + (doc.numPages || doc.pages.length) + '쪽';
        var sectionBar = document.getElementById('readerCurrentSectionBar');
        if (sectionBar) {
            sectionBar.style.display = 'inline-flex';
            sectionBar.textContent = '📑 현재 위치 목차: ' + this.resolveTocBreadcrumb(doc, pg.pageNum, 999999);
        }
        this.renderTocDrawer(doc);
        var rawQ = document.getElementById('searchInput').value || '';
        var qTerms = terms || this.parseSearchQuery(rawQ, 0).terms;
        rBox.innerHTML = this.renderPageHtml(pg, qTerms);
        rBox.scrollTop = 0;
        var firstHit = rBox.querySelector('mark.hit');
        if (firstHit) firstHit.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    renderTocDrawer: function (doc) {
        var countEl = document.getElementById('readerTocCount');
        var box = document.getElementById('tocDrawerBox');
        var self = this;
        if (!box || !doc) return;
        var toc = Array.isArray(doc.toc) ? doc.toc : [];
        if (countEl) countEl.textContent = toc.length;
        if (toc.length === 0) {
            box.innerHTML = '<div style="font-size:0.78rem; color:var(--text-muted);">감지된 목차 패턴(제N장/절/조, [제목], 1. 등)이 없습니다.</div>';
            return;
        }
        box.innerHTML = toc.map(function (item) {
            return '<div class="toc-jump-item" style="padding-left:' + (item.level > 1 ? '1.1rem' : '0.35rem') + ';" onclick="app.openReader(\'' + doc.id + '\', ' + item.pageNum + ')">' +
                '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (item.level === 1 ? '📗' : '▸') + ' ' + self.escapeHtml(item.title) + '</span>' +
                '<span style="color:var(--primary); flex-shrink:0;">p.' + item.pageNum + '</span></div>';
        }).join('');
    },

    toggleTocDrawer: function () {
        var box = document.getElementById('tocDrawerBox');
        if (box) box.classList.toggle('open');
    },

    // 이전/다음 쪽: 목록의 순서(index)로 이동 — 빈 쪽이 있어도 실제 PDF 쪽 번호 순서를 따른다
    movePage: function (delta) {
        var doc = this.docs.find(function (d) { return d.id === this.activeDocId; }, this);
        if (!doc) return;
        var cur = this;
        var idx = doc.pages.findIndex(function (p) { return p.pageNum === cur.activePageNum; });
        var ni = idx + delta;
        if (idx >= 0 && ni >= 0 && ni < doc.pages.length) this.openReader(doc.id, doc.pages[ni].pageNum);
    },

    jumpToPage: function (val) {
        var doc = this.docs.find(function (d) { return d.id === this.activeDocId; }, this);
        var n = parseInt(val, 10);
        if (!doc || !(n >= 1)) return;
        var pg = doc.pages.find(function (p) { return p.pageNum === n; });
        if (!pg) { this.showToast(n + '쪽이 없습니다 (이 문서: 1~' + (doc.numPages || doc.pages.length) + '쪽).'); return; }
        this.openReader(doc.id, n);
    },

    copyReaderPage: function () {
        var doc = this.docs.find(function (d) { return d.id === this.activeDocId; }, this);
        if (!doc) return;
        var cur = this;
        var pg = doc.pages.find(function (p) { return p.pageNum === cur.activePageNum; });
        if (!pg) return;
        var ta = document.createElement('textarea');
        ta.value = '[' + doc.fileName + ' - p.' + pg.pageNum + ']\n' + PL.toTsv(pg.text);   // 표는 탭 구분(엑셀·한글 표로 붙여넣기 가능)
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.showToast('현재 페이지 원문이 클립보드에 복사되었습니다 (표는 탭 구분).');
    },

    /* ======================================================================
       7. 추출 보고서
       ====================================================================== */
    openReportModal: function () {
        var self = this;
        var st = PDFENGINE.state;
        var h = '<div class="rep-doc"><strong>엔진</strong>: ' + (st.ready ? '<span class="rep-ok">PDF.js ' + st.version + ' 내장 · 외부 통신 없음</span>' : '<span class="rep-bad">로드 실패: ' + this.escapeHtml(st.error || '') + '</span>') + '</div>';
        var any = false;
        this.docs.forEach(function (d) {
            var r = d.report;
            if (!r) return;
            any = true;
            var okLine = (r.ok + r.blank + r.img + r.fail === r.numPages && !r.cancelled)
                ? '<span class="rep-ok">전체 ' + r.numPages + '쪽 모두 처리됨</span>'
                : '<span class="rep-bad">PDF ' + r.numPages + '쪽 중 ' + (r.ok + r.blank + r.img + r.fail) + '쪽만 처리됨' + (r.cancelled ? ' (사용자 중단)' : '') + '</span>';
            h += '<div class="rep-doc"><div style="font-weight:900; word-break:break-all;">📄 ' + self.escapeHtml(d.fileName) + '</div>' +
                '<div>' + okLine + ' · 소요 ' + r.sec + '초 · 글자 ' + r.chars.toLocaleString() + '자</div>' +
                '<div>글 있는 쪽 <b>' + r.ok + '</b> · 빈 쪽 <b>' + r.blank + '</b> · 이미지만 있는 쪽 <b>' + r.img + '</b> · 실패 <b class="' + (r.fail ? 'rep-bad' : '') + '">' + r.fail + '</b> · 표 ' + r.tables + '개(선) + ' + r.borderless + '개(추정)</div>';
            if (r.fail) h += '<div class="rep-bad">실패한 쪽: ' + r.failPages.join(', ') + (r.fail > r.failPages.length ? ' …' : '') + ' → 원본 PDF 뷰어에서 확인하세요.</div>';
            if (r.pua > 0) h += '<div class="rep-warn">⚠ 글자 매핑이 깨진 것으로 의심되는 문자 ' + r.pua + '자 (쪽: ' + r.puaPages.join(', ') + ') — 이 쪽은 원본 뷰어 복붙 파싱을 권장합니다.</div>';
            if (r.img > 0) h += '<div style="color:var(--text-secondary);">이미지만 있는 쪽은 스캔본일 수 있습니다(텍스트 없음 — OCR 미지원).</div>';
            h += '</div>';
        });
        if (!any) h += '<div class="rep-doc">PDF 자동 추출 보고서가 있는 매뉴얼이 없습니다 (복붙·텍스트 등록 문서는 보고서가 없습니다).</div>';
        document.getElementById('reportBody').innerHTML = h;
        document.getElementById('reportModal').classList.add('open');
    },
    closeReportModal: function () { document.getElementById('reportModal').classList.remove('open'); },

    /* ======================================================================
       8. 내보내기 (JSON / 단일 HTML)
       ====================================================================== */
    // 좌측 목록에서 체크된(선택된) 매뉴얼만 내보냄 — QR 전송 대상 선택과 동일한 체크박스 사용
    exportJsonIndex: function () {
        var docs = this.docs.filter(function (d) { return d.checked !== false; });
        if (!docs.length) { this.showToast('내보낼 매뉴얼을 좌측 목록에서 1권 이상 체크하세요.'); return; }
        var blob = new Blob([JSON.stringify({ v: 2, docs: docs })], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '매뉴얼색인백업_' + docs.length + '권.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    },

    // 단일 HTML 문자열 생성. opts.index=false → 색인 비움, opts.engine=false → PDF 엔진(약 0.9MB) 제외(검색 전용)
    buildHtmlString: function (opts) {
        opts = opts || {};
        var withIndex = opts.index !== false, withEngine = opts.engine !== false;
        var self = this;
        var idxP = withIndex ? this.encodeIndex(this.docs) : Promise.resolve('');
        return idxP.then(function (idx) {
            var clone = document.documentElement.cloneNode(true);
            var slot = clone.querySelector('#embedded-pdf-index-b64');
            if (slot) slot.textContent = idx;
            var injected = clone.querySelector('#pdfjs-injected');
            if (injected && injected.parentNode) injected.parentNode.removeChild(injected);
            if (!withEngine) {
                ['pdfjs-main-z', 'pdfjs-worker-z', 'pdfjs-cmaps-z'].forEach(function (id) {
                    var el = clone.querySelector('#' + id);
                    if (el) el.textContent = '';
                });
            }
            ['docList', 'resultList', 'toastContainer', 'tocDrawerBox', 'confirmDeleteFileList', 'reportBody', 'parseStat', 'parseFile', 'qrSummary', 'qrHint', 'qrEstimate', 'qrStatus', 'qrStageInfo'].forEach(function (id) {
                var el = clone.querySelector('#' + id);
                if (el) el.innerHTML = '';
            });
            var rb = clone.querySelector('#readerBox');
            if (rb) rb.innerHTML = '검색 결과 카드를 클릭하면 해당 페이지 전체 원문이 표시됩니다.';
            clone.querySelectorAll('.modal-backdrop.open').forEach(function (m) { m.classList.remove('open'); });
            var qs = clone.querySelector('#qrStage'); if (qs) qs.className = 'qr-stage';
            var wrap = clone.querySelector('#nativePdfWrap');
            if (wrap) wrap.classList.remove('active');
            var iframe = clone.querySelector('#nativePdfIframe');
            if (iframe) iframe.removeAttribute('src');
            clone.querySelectorAll('input[type="search"], input[type="number"], input[type="text"], textarea').forEach(function (el) { el.removeAttribute('value'); if (el.tagName === 'TEXTAREA') el.textContent = ''; });
            return '<!DOCTYPE html>\n' + clone.outerHTML;
        });
    },

    downloadEmbeddedHtml: function () {
        var self = this;
        this.showToast('저장 파일을 만드는 중입니다… (문서가 많으면 잠시 걸립니다)');
        return this.buildHtmlString({ index: true, engine: true }).then(function (html) {
            var blob = new Blob(['\uFEFF', html], { type: 'text/html;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'PDF매뉴얼통합검색기_' + self.docs.length + '권내장.html';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 120000);
            self.showToast('등록된 매뉴얼·목차·PDF 엔진이 모두 포함된 단일 HTML 파일이 저장되었습니다! (' + (blob.size / 1048576).toFixed(1) + ' MB)');
        });
    },

    // 전송용 슬림 문서: 목차·검색 캐시는 받는 쪽에서 다시 만들 수 있어 제외, 빈/이미지 쪽은 쪽 번호 목록(bl/im)으로만
    slimDoc: function (d) {
        var pages = [], bl = [], im = [];
        d.pages.forEach(function (p) {
            if (p.st === 'blank') bl.push(p.pageNum);
            else if (p.st === 'img' && !p.text) im.push(p.pageNum);
            else {
                var r = { pageNum: p.pageNum, text: p.text || '' };
                if (p.st) r.st = p.st;
                if (p.err) r.err = p.err;
                pages.push(r);
            }
        });
        var out = { id: d.id, fileName: d.fileName, numPages: d.numPages || d.pages.length, pages: pages };
        if (bl.length) out.bl = bl;
        if (im.length) out.im = im;
        if (d.report) out.report = d.report;
        return out;
    },

    // QR 전송 대상 파일 구성: 체크된 매뉴얼 → 전송용 JSON(+선택: 검색 전용 HTML). 없으면 null
    buildTransferFiles: function (opts) {
        opts = opts || {};
        var self = this;
        var docs = this.docs.filter(function (d) { return d.checked !== false; });
        if (!docs.length) return Promise.resolve(null);
        var d0 = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
        var stamp = d0.getFullYear() + pad(d0.getMonth() + 1) + pad(d0.getDate()) + '_' + pad(d0.getHours()) + pad(d0.getMinutes());
        var payload = {
            v: 2, kind: 'pdf-manual-index',
            exportedAt: d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate()) + ' ' + pad(d0.getHours()) + ':' + pad(d0.getMinutes()),
            docs: docs.map(function (d) { return self.slimDoc(d); })
        };
        var json = new TextEncoder().encode(JSON.stringify(payload));
        var pages = 0, chars = 0;
        docs.forEach(function (d) { pages += d.numPages || d.pages.length; d.pages.forEach(function (p) { chars += (p.text || '').length; }); });
        var files = [{ name: '매뉴얼색인_' + stamp + '_' + docs.length + '권.json', u8: json, mtime: d0.getTime() }];
        var summary = '전송 대상 <b>' + docs.length + '권</b> · ' + pages + '쪽 · 글자 ' + chars.toLocaleString() + '자<br>전송용 JSON ' + (json.length / 1048576).toFixed(2) + ' MB (압축 전)';
        if (!opts.viewer) return Promise.resolve({ files: files, summary: summary });
        return this.buildHtmlString({ index: false, engine: false }).then(function (html) {
            var u8 = new TextEncoder().encode(html);
            files.push({ name: 'PDF검색기_검색전용.html', u8: u8, mtime: d0.getTime() });
            return { files: files, summary: summary + '<br>+ 검색 전용 검색기 HTML ' + (u8.length / 1024).toFixed(0) + ' KB' };
        });
    },

    showToast: function (msg) {
        var box = document.getElementById('toastContainer');
        if (!box) return;
        var t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        box.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
    }
};

window.addEventListener('DOMContentLoaded', function () { app.init(); });
