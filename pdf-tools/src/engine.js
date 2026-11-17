/* ==========================================================================
   PDFENGINE: HTML 안에 압축·Base64 로 내장된 PDF.js(legacy)·워커·한글 CMap 을 꺼내 쓰는 로더
   슬롯 형식: "<압축해제크기>:<Base64(raw deflate)>"   (빌드 시 python 이 생성)
   외부 통신 없음. 워커는 Blob URL 로 만들고, 실패하면 PDF.js 가 자동으로 메인 스레드(페이크 워커)로 대체.
   ========================================================================== */
var PDFENGINE = (function () {
    var state = { ready: false, error: null, version: '3.11.174', workerMode: '', viewerOnly: false };
    var cmaps = null, cmapCache = {};

    function b64ToU8(b64) {
        var bin = atob(b64.replace(/\s+/g, ''));
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }
    function readSlot(id) {
        var el = document.getElementById(id);
        var t = el ? el.textContent.trim() : '';
        if (!t) return Promise.reject(new Error('내장 슬롯이 비어 있습니다: ' + id));
        var i = t.indexOf(':');
        var size = parseInt(t.slice(0, i), 10);
        return QX.inflate(b64ToU8(t.slice(i + 1)), size);
    }

    // PDF.js 가 요구하는 CMap 공급자 (한글 폰트 매핑 테이블을 내장 데이터에서 반환)
    function EmbeddedCMapReaderFactory() { }
    EmbeddedCMapReaderFactory.prototype.fetch = function (params) {
        var name = params.name;
        if (!cmaps || !cmaps[name]) return Promise.reject(new Error('내장 CMap 없음: ' + name));
        if (!cmapCache[name]) cmapCache[name] = b64ToU8(cmaps[name]);
        return Promise.resolve({ cMapData: cmapCache[name], compressionType: 1 });
    };

    function load() {
        if (state.ready) return Promise.resolve(state);
        var mainSlot = document.getElementById('pdfjs-main-z');
        if (!mainSlot || !mainSlot.textContent.trim()) { // 전송용 '검색 전용' HTML: 엔진을 뺀 파일
            state.viewerOnly = true;
            return Promise.resolve(state);
        }
        return readSlot('pdfjs-main-z').then(function (mainU8) {
            var s = document.createElement('script');
            s.id = 'pdfjs-injected';
            s.text = new TextDecoder('utf-8').decode(mainU8);
            document.head.appendChild(s);
            if (!window.pdfjsLib) throw new Error('pdfjsLib 초기화 실패');
            return readSlot('pdfjs-worker-z');
        }).then(function (workerU8) {
            var blob = new Blob([workerU8], { type: 'application/javascript' });
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
            return readSlot('pdfjs-cmaps-z');
        }).then(function (cmU8) {
            cmaps = JSON.parse(new TextDecoder('utf-8').decode(cmU8));
            state.ready = true;
            return state;
        }).catch(function (e) {
            state.error = (e && e.message) ? e.message : String(e);
            console.error('PDF 엔진 로드 실패', e);
            return state;
        });
    }

    // 문서 열기: 암호 PDF 는 onPassword 콜백으로 입력받음
    function open(buf, onPassword) {
        var task = window.pdfjsLib.getDocument({
            data: buf,
            CMapReaderFactory: EmbeddedCMapReaderFactory,
            cMapPacked: true,
            verbosity: 0,
            isEvalSupported: false,
            useSystemFonts: false,
            disableFontFace: true
        });
        if (onPassword) task.onPassword = onPassword;
        return task.promise;
    }

    return { state: state, load: load, open: open, cmapFactory: function () { return EmbeddedCMapReaderFactory; } };
})();
