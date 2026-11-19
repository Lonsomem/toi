/* ==========================================================================
   QR 코드 인코더 (순수 JS, 영숫자 모드 + 바이트 모드, 오류정정 L/M, 버전 1~40)
   QX.QR.encode(input, {mode:'alnum'|'byte', ver, ecl:'L'|'M'}) -> {size, modules(Uint8Array), mask}
   ========================================================================== */
QX.QR = (function () {
    const ECC_CW = {
        L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
    };
    const ECC_BLOCKS = {
        L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
    };
    const FORMAT_BITS = { L: 1, M: 0 };

    function rawModules(ver) {
        let r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            const na = Math.floor(ver / 7) + 2;
            r -= (25 * na - 10) * na - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }
    function dataCodewords(ver, ecl) {
        return Math.floor(rawModules(ver) / 8) - ECC_CW[ecl][ver] * ECC_BLOCKS[ecl][ver];
    }
    function ccBits(mode, ver) {
        if (mode === 'alnum') return ver <= 9 ? 9 : (ver <= 26 ? 11 : 13);
        return ver <= 9 ? 8 : 16;
    }
    // 해당 버전에 실을 수 있는 최대 문자(영숫자) 수 / 바이트 수
    function capacity(ver, ecl, mode) {
        const avail = dataCodewords(ver, ecl) * 8 - 4 - ccBits(mode, ver);
        if (mode === 'alnum') return Math.floor(avail / 11) * 2 + (avail % 11 >= 6 ? 1 : 0);
        return Math.floor(avail / 8);
    }

    /* --- Reed-Solomon (GF 256, 0x11D) --- */
    function gfMul(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z;
    }
    const rsCache = {};
    function rsDivisor(deg) {
        if (rsCache[deg]) return rsCache[deg];
        const r = new Array(deg).fill(0);
        r[deg - 1] = 1;
        let root = 1;
        for (let i = 0; i < deg; i++) {
            for (let j = 0; j < deg; j++) {
                r[j] = gfMul(r[j], root);
                if (j + 1 < deg) r[j] ^= r[j + 1];
            }
            root = gfMul(root, 2);
        }
        return (rsCache[deg] = r);
    }
    function rsRemainder(data, div) {
        const res = new Array(div.length).fill(0);
        for (let k = 0; k < data.length; k++) {
            const factor = data[k] ^ res.shift();
            res.push(0);
            for (let i = 0; i < div.length; i++) res[i] ^= gfMul(div[i], factor);
        }
        return res;
    }

    function addEccAndInterleave(data, ver, ecl) {
        const nb = ECC_BLOCKS[ecl][ver], bel = ECC_CW[ecl][ver];
        const raw = Math.floor(rawModules(ver) / 8);
        const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
        const blocks = [], div = rsDivisor(bel);
        for (let i = 0, k = 0; i < nb; i++) {
            const dat = data.slice(k, k + shortLen - bel + (i < nShort ? 0 : 1));
            k += dat.length;
            const ecc = rsRemainder(dat, div);
            if (i < nShort) dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        const result = [];
        for (let i = 0; i < blocks[0].length; i++) {
            for (let j = 0; j < blocks.length; j++) {
                if (i !== shortLen - bel || j >= nShort) result.push(blocks[j][i]);
            }
        }
        return result;
    }

    function alignPositions(ver) {
        if (ver === 1) return [];
        const na = Math.floor(ver / 7) + 2;
        const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
        const res = [6];
        for (let pos = ver * 4 + 10; res.length < na; pos -= step) res.splice(1, 0, pos);
        return res;
    }

    /* --- 함수 패턴 템플릿 (버전/ECC 별 캐시) --- */
    const tplCache = {};
    function getTemplate(ver, ecl) {
        const key = ver + ecl;
        if (tplCache[key]) return tplCache[key];
        const size = ver * 4 + 17;
        const mod = new Uint8Array(size * size), fn = new Uint8Array(size * size);
        const setFn = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
        for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
        const finder = (cx, cy) => {
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
            }
        };
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        const ap = alignPositions(ver), na = ap.length;
        for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
        // 포맷 영역 예약(값은 이후 기록)
        drawFormat(mod, fn, size, ecl, 0);
        if (ver >= 7) {
            let rem = ver;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            const bits = ver << 12 | rem;
            for (let i = 0; i < 18; i++) {
                const c = ((bits >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
                setFn(a, b, c); setFn(b, a, c);
            }
        }
        return (tplCache[key] = { size, mod, fn });
    }

    function drawFormat(mod, fn, size, ecl, mask) {
        const setFn = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
        const data = FORMAT_BITS[ecl] << 3 | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = (data << 10 | rem) ^ 0x5412;
        const bit = i => ((bits >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
        setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
        for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
        setFn(8, size - 8, true);
    }

    function applyMask(mod, fn, size, mask) {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let inv;
            switch (mask) {
                case 0: inv = (x + y) % 2 === 0; break;
                case 1: inv = y % 2 === 0; break;
                case 2: inv = x % 3 === 0; break;
                case 3: inv = (x + y) % 3 === 0; break;
                case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                case 5: inv = x * y % 2 + x * y % 3 === 0; break;
                case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
                default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
            }
            const i = y * size + x;
            if (!fn[i] && inv) mod[i] ^= 1;
        }
    }

    function penalty(mod, size) {
        let result = 0;
        const get = (x, y) => mod[y * size + x];
        // 규칙 1 + 3 (행/열)
        const line = new Uint8Array(size);
        for (let dir = 0; dir < 2; dir++) {
            for (let a = 0; a < size; a++) {
                for (let b = 0; b < size; b++) line[b] = dir === 0 ? get(b, a) : get(a, b);
                let run = 1;
                for (let b = 1; b < size; b++) {
                    if (line[b] === line[b - 1]) { run++; if (run === 5) result += 3; else if (run > 5) result++; }
                    else run = 1;
                }
                for (let b = 0; b + 7 <= size; b++) {
                    if (line[b] && !line[b + 1] && line[b + 2] && line[b + 3] && line[b + 4] && !line[b + 5] && line[b + 6]) {
                        let before = true, after = true;
                        for (let k = 1; k <= 4; k++) {
                            if (b - k >= 0 && line[b - k]) before = false;
                            if (b + 6 + k < size && line[b + 6 + k]) after = false;
                        }
                        if (before) result += 40;
                        if (after) result += 40;
                    }
                }
            }
        }
        // 규칙 2
        for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
            const c = get(x, y);
            if (c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) result += 3;
        }
        // 규칙 4
        let dark = 0;
        for (let i = 0; i < mod.length; i++) dark += mod[i];
        const total = size * size;
        const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
        result += Math.max(0, k) * 10;
        return result;
    }

    function encode(input, opts) {
        opts = opts || {};
        const mode = opts.mode || 'alnum', ecl = opts.ecl || 'L';
        let ver = opts.ver;
        const len = input.length;
        if (!ver) {
            for (ver = 1; ver <= 40; ver++) if (capacity(ver, ecl, mode) >= len) break;
            if (ver > 40) throw new Error('QR 용량 초과');
        } else if (capacity(ver, ecl, mode) < len) {
            throw new Error('QR 버전 ' + ver + ' 용량 초과 (' + len + ' > ' + capacity(ver, ecl, mode) + ')');
        }
        // 비트 스트림
        const bits = [];
        const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
        if (mode === 'alnum') {
            push(0x2, 4); push(len, ccBits('alnum', ver));
            const map = QX.b45map;
            for (let i = 0; i < len; i += 2) {
                const a = map[input.charCodeAt(i)];
                if (i + 1 < len) push(a * 45 + map[input.charCodeAt(i + 1)], 11);
                else push(a, 6);
            }
        } else {
            push(0x4, 4); push(len, ccBits('byte', ver));
            for (let i = 0; i < len; i++) push(input[i], 8);
        }
        const capBits = dataCodewords(ver, ecl) * 8;
        push(0, Math.min(4, capBits - bits.length));
        push(0, (8 - bits.length % 8) % 8);
        for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) push(pad, 8);
        const data = new Array(bits.length / 8).fill(0);
        for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));
        const all = addEccAndInterleave(data, ver, ecl);

        const tpl = getTemplate(ver, ecl), size = tpl.size, fn = tpl.fn;
        const base = tpl.mod.slice();
        // 코드워드 배치
        let bi = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? size - 1 - vert : vert;
                    if (!fn[y * size + x] && bi < all.length * 8) {
                        base[y * size + x] = (all[bi >>> 3] >>> (7 - (bi & 7))) & 1;
                        bi++;
                    }
                }
            }
        }
        let bestMask = opts.mask, best = null;
        const tryMask = m => {
            const mod = base.slice();
            applyMask(mod, fn, size, m);
            drawFormat(mod, new Uint8Array(size * size), size, ecl, m);
            return mod;
        };
        if (bestMask === undefined) {
            let bestPen = Infinity;
            for (let m = 0; m < 8; m++) {
                const mod = tryMask(m), p = penalty(mod, size);
                if (p < bestPen) { bestPen = p; bestMask = m; best = mod; }
            }
        } else best = tryMask(bestMask);
        return { size, modules: best, mask: bestMask, ver };
    }

    /* 프레임 한 개(bytes)가 들어갈 수 있는 최대 크기(바이트) */
    function maxFrameBytes(ver, ecl, binary) {
        if (binary) return capacity(ver, ecl, 'byte') - 2;
        const cap = capacity(ver, ecl, 'alnum') - 3; // 'QX' + '.'
        let f = Math.floor(cap / 3) * 2;
        if (cap % 3 >= 2) f += 1;
        return f;
    }

    return { encode, capacity, maxFrameBytes, dataCodewords };
})();

/* 캔버스에 QR 그리기 (quiet zone 4모듈, 정수 배율) */
QX.drawQR = function (canvas, qr, boxPx) {
    const q = 4, n = qr.size + q * 2;
    const scale = Math.max(2, Math.floor(boxPx / n));
    const px = n * scale;
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(px, px), d = img.data;
    d.fill(255);
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (!qr.modules[y * qr.size + x]) continue;
            for (let yy = 0; yy < scale; yy++) {
                let o = (((y + q) * scale + yy) * px + (x + q) * scale) * 4;
                for (let xx = 0; xx < scale; xx++, o += 4) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; }
            }
        }
    }
    ctx.putImageData(img, 0, 0);
};

/* RGB 3층: 서로 다른 QR 3개를 R/G/B 채널에 각각 싣는다. (모듈이 어두우면 해당 채널=0, 밝으면 255)
   세 층의 파인더/타이밍 패턴 위치가 같아 검은색으로 겹쳐 보인다. */
QX.drawQR3 = function (canvas, qrs, boxPx) {
    const size = qrs[0].size, q = 4, n = size + q * 2;
    const scale = Math.max(2, Math.floor(boxPx / n));
    const px = n * scale;
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(px, px), d = img.data;
    d.fill(255);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const r = qrs[0].modules[i] ? 0 : 255, g = qrs[1].modules[i] ? 0 : 255, b = qrs[2].modules[i] ? 0 : 255;
            if (r === 255 && g === 255 && b === 255) continue;
            for (let yy = 0; yy < scale; yy++) {
                let o = (((y + q) * scale + yy) * px + (x + q) * scale) * 4;
                for (let xx = 0; xx < scale; xx++, o += 4) { d[o] = r; d[o + 1] = g; d[o + 2] = b; }
            }
        }
    }
    ctx.putImageData(img, 0, 0);
};

/* 수신 측: RGBA 이미지에서 채널 c(0/1/2)만 뽑아 jsQR 이 읽을 수 있는 회색조 RGBA 로 변환 */
QX.channelToGray = function (src, dst, c) {
    for (let i = 0, n = src.length; i < n; i += 4) {
        const v = src[i + c];
        dst[i] = v; dst[i + 1] = v; dst[i + 2] = v; dst[i + 3] = 255;
    }
    return dst;
};
