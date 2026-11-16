/* ==========================================================================
   QRX core: CRC32 / SHA-256 / Base45 / DEFLATE(압축·해제) / 아카이브 / 분수코드(LT)
   - 외부 라이브러리 없음. 모든 데이터는 바이트(Uint8Array)로만 다루며
     텍스트(파일명·헤더)는 항상 UTF-8 로 인코딩/디코딩한다. (한글 안전)
   ========================================================================== */
const QX = {};

/* ---------------------------------------------------------------- CRC32 */
QX.crcTable = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

QX.crc32 = function (buf, start, end, prev) {
    start = start || 0;
    end = (end === undefined) ? buf.length : end;
    let c = ((prev || 0) ^ 0xFFFFFFFF) >>> 0;
    const t = QX.crcTable;
    for (let i = start; i < end; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
};

/* -------------------------------------------------------------- SHA-256 */
QX.sha256js = function (data) {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const n = data.length;
    const padLen = ((n + 9 + 63) >> 6) << 6;
    const tail = new Uint8Array(padLen - (n - (n % 64)));
    // tail = 마지막 불완전 블록 + 패딩
    const rem = n % 64;
    tail.set(data.subarray(n - rem, n), 0);
    tail[rem] = 0x80;
    const bitLenHi = Math.floor(n / 0x20000000), bitLenLo = (n << 3) >>> 0;
    const tl = tail.length;
    tail[tl - 8] = (bitLenHi >>> 24) & 255; tail[tl - 7] = (bitLenHi >>> 16) & 255;
    tail[tl - 6] = (bitLenHi >>> 8) & 255; tail[tl - 5] = bitLenHi & 255;
    tail[tl - 4] = (bitLenLo >>> 24) & 255; tail[tl - 3] = (bitLenLo >>> 16) & 255;
    tail[tl - 2] = (bitLenLo >>> 8) & 255; tail[tl - 1] = bitLenLo & 255;
    const W = new Uint32Array(64);
    function block(buf, off) {
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            W[i] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const a = W[i - 15], b = W[i - 2];
            const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
            const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const full = n - rem;
    for (let off = 0; off < full; off += 64) block(data, off);
    for (let off = 0; off < tl; off += 64) block(tail, off);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
        out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255;
        out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
    }
    return out;
};

QX.sha256 = async function (data) {
    try {
        if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
            return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        }
    } catch (e) { /* file:// 등 비보안 컨텍스트 → 순수 JS 사용 */ }
    return QX.sha256js(data);
};

QX.bytesEqual = function (a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};

QX.toHex = function (u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
};

/* --------------------------------------------------------------- Base45 */
QX.B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
QX.b45map = (function () {
    const m = new Int8Array(128).fill(-1);
    for (let i = 0; i < QX.B45.length; i++) m[QX.B45.charCodeAt(i)] = i;
    return m;
})();

QX.b45len = function (nBytes) {
    return Math.floor(nBytes / 2) * 3 + (nBytes % 2 ? 2 : 0);
};

QX.b45enc = function (bytes) {
    const A = QX.B45, n = bytes.length;
    const out = [];
    let i = 0;
    for (; i + 1 < n; i += 2) {
        let v = bytes[i] * 256 + bytes[i + 1];
        const c = v % 45; v = (v - c) / 45;
        const d = v % 45; const e = (v - d) / 45;
        out.push(A[c], A[d], A[e]);
    }
    if (i < n) {
        const v = bytes[i];
        const c = v % 45;
        out.push(A[c], A[(v - c) / 45]);
    }
    return out.join('');
};

QX.b45dec = function (str) {
    const m = QX.b45map, n = str.length;
    if (n % 3 === 1) return null;
    const out = new Uint8Array(Math.floor(n / 3) * 2 + (n % 3 ? 1 : 0));
    let o = 0, i = 0;
    for (; i + 2 < n; i += 3) {
        const c = m[str.charCodeAt(i)], d = m[str.charCodeAt(i + 1)], e = m[str.charCodeAt(i + 2)];
        if (c < 0 || d < 0 || e < 0 || str.charCodeAt(i) > 127 || str.charCodeAt(i + 1) > 127 || str.charCodeAt(i + 2) > 127) return null;
        const v = c + d * 45 + e * 2025;
        if (v > 65535) return null;
        out[o++] = v >> 8; out[o++] = v & 255;
    }
    if (i < n) {
        const c = m[str.charCodeAt(i)], d = m[str.charCodeAt(i + 1)];
        if (c < 0 || d < 0) return null;
        const v = c + d * 45;
        if (v > 255) return null;
        out[o++] = v;
    }
    return out;
};

/* ------------------------------------------------------ DEFLATE (해제) */
QX.inflateRaw = function (src, outSize) {
    const out = new Uint8Array(outSize);
    let op = 0, ip = 0, bitbuf = 0, bitcnt = 0;
    function bits(n) {
        while (bitcnt < n) {
            if (ip >= src.length) throw new Error('inflate: 입력 부족');
            bitbuf |= src[ip++] << bitcnt; bitcnt += 8;
        }
        const v = bitbuf & ((1 << n) - 1);
        bitbuf >>>= n; bitcnt -= n;
        return v;
    }
    function build(lengths, n) {
        const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
        for (let i = 0; i < n; i++) count[lengths[i]]++;
        count[0] = 0;
        for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
        for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
        return { count, symbol };
    }
    function decode(h) {
        let code = 0, first = 0, index = 0;
        for (let len = 1; len <= 15; len++) {
            code |= bits(1);
            const c = h.count[len];
            if (code - c < first) return h.symbol[index + (code - first)];
            index += c; first += c; first <<= 1; code <<= 1;
        }
        throw new Error('inflate: 잘못된 허프만 코드');
    }
    const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    let fixedL = null, fixedD = null;
    function codes(hl, hd) {
        for (;;) {
            const sym = decode(hl);
            if (sym < 256) {
                if (op >= outSize) throw new Error('inflate: 출력 초과');
                out[op++] = sym;
            } else if (sym === 256) {
                return;
            } else {
                const s = sym - 257;
                if (s >= 29) throw new Error('inflate: 잘못된 길이 코드');
                const len = LB[s] + bits(LE[s]);
                const ds = decode(hd);
                if (ds >= 30) throw new Error('inflate: 잘못된 거리 코드');
                const dist = DB[ds] + bits(DE[ds]);
                if (dist > op) throw new Error('inflate: 거리 오류');
                if (op + len > outSize) throw new Error('inflate: 출력 초과');
                for (let k = 0; k < len; k++) { out[op] = out[op - dist]; op++; }
            }
        }
    }
    let last;
    do {
        last = bits(1);
        const type = bits(2);
        if (type === 0) {
            bitbuf = 0; bitcnt = 0;
            if (ip + 4 > src.length) throw new Error('inflate: 입력 부족');
            const len = src[ip] | (src[ip + 1] << 8);
            const nlen = src[ip + 2] | (src[ip + 3] << 8);
            if ((len ^ 0xFFFF) !== nlen) throw new Error('inflate: stored 길이 오류');
            ip += 4;
            if (op + len > outSize || ip + len > src.length) throw new Error('inflate: stored 범위 오류');
            out.set(src.subarray(ip, ip + len), op);
            op += len; ip += len;
        } else if (type === 1) {
            if (!fixedL) {
                const l = new Uint8Array(288);
                for (let i = 0; i < 144; i++) l[i] = 8;
                for (let i = 144; i < 256; i++) l[i] = 9;
                for (let i = 256; i < 280; i++) l[i] = 7;
                for (let i = 280; i < 288; i++) l[i] = 8;
                fixedL = build(l, 288);
                fixedD = build(new Uint8Array(30).fill(5), 30);
            }
            codes(fixedL, fixedD);
        } else if (type === 2) {
            const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
            const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
            const lengths = new Uint8Array(320);
            for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = bits(3);
            const lencode = build(lengths, 19);
            let idx = 0;
            const lens = new Uint8Array(320);
            while (idx < nlen + ndist) {
                let sym = decode(lencode);
                if (sym < 16) {
                    lens[idx++] = sym;
                } else {
                    let prev = 0, rep;
                    if (sym === 16) {
                        if (idx === 0) throw new Error('inflate: 반복 오류');
                        prev = lens[idx - 1]; rep = 3 + bits(2);
                    } else if (sym === 17) rep = 3 + bits(3);
                    else rep = 11 + bits(7);
                    if (idx + rep > nlen + ndist) throw new Error('inflate: 길이 초과');
                    while (rep--) lens[idx++] = prev;
                }
            }
            codes(build(lens.subarray(0, nlen), nlen), build(lens.subarray(nlen, nlen + ndist), ndist));
        } else {
            throw new Error('inflate: 잘못된 블록 타입');
        }
    } while (!last);
    if (op !== outSize) throw new Error('inflate: 크기 불일치 (' + op + ' != ' + outSize + ')');
    return out;
};

/* 네이티브 해제 (가능하면) → 실패 시 순수 JS */
QX.inflate = async function (src, outSize, forceJs) {
    if (!forceJs && typeof DecompressionStream !== 'undefined') {
        try {
            const ds = new DecompressionStream('deflate-raw');
            const res = await new Response(new Blob([src]).stream().pipeThrough(ds)).arrayBuffer();
            if (res.byteLength === outSize) return new Uint8Array(res);
        } catch (e) { /* 폴백 */ }
    }
    return QX.inflateRaw(src, outSize);
};

/* ------------------------------------------------------ DEFLATE (압축) */
QX.deflate = (function () {
    const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    const lenCode = new Uint8Array(259);
    for (let c = 0; c < 29; c++) {
        const hi = (c === 28) ? 258 : LB[c] + (1 << LE[c]) - 1;
        for (let l = LB[c]; l <= hi && l <= 258; l++) lenCode[l] = c;
    }
    lenCode[258] = 28;
    const distCodeFor = function (d) {
        let c = 29;
        while (DB[c] > d) c--;
        return c;
    };
    const distTab = new Uint8Array(32769);
    for (let d = 1; d <= 32768; d++) distTab[d] = distCodeFor(d);

    function huffLengths(freqs, maxBits) {
        const n = freqs.length, lens = new Uint8Array(n);
        const syms = [];
        for (let i = 0; i < n; i++) if (freqs[i] > 0) syms.push(i);
        if (syms.length === 0) return lens;
        if (syms.length === 1) { lens[syms[0]] = 1; return lens; }
        syms.sort((a, b) => freqs[a] - freqs[b] || a - b);
        const m = syms.length, total = 2 * m - 1;
        const w = new Array(total), par = new Array(total);
        for (let k = 0; k < m; k++) w[k] = freqs[syms[k]];
        let li = 0, ii = m;
        for (let k = m; k < total; k++) {
            let a, b;
            if (li < m && (ii >= k || w[li] <= w[ii])) a = li++; else a = ii++;
            if (li < m && (ii >= k || w[li] <= w[ii])) b = li++; else b = ii++;
            w[k] = w[a] + w[b]; par[a] = k; par[b] = k;
        }
        const depth = new Array(total);
        depth[total - 1] = 0;
        for (let k = total - 2; k >= 0; k--) depth[k] = depth[par[k]] + 1;
        let maxLen = 0;
        for (let k = 0; k < m; k++) { lens[syms[k]] = depth[k]; if (depth[k] > maxLen) maxLen = depth[k]; }
        if (maxLen > maxBits) {
            const cnt = new Array(maxBits + 1).fill(0);
            for (let k = 0; k < m; k++) cnt[Math.min(depth[k], maxBits)]++;
            let tot = 0;
            for (let l = 1; l <= maxBits; l++) tot += cnt[l] << (maxBits - l);
            while (tot > (1 << maxBits)) {
                cnt[maxBits]--;
                for (let l = maxBits - 1; l >= 1; l--) {
                    if (cnt[l]) { cnt[l]--; cnt[l + 1] += 2; break; }
                }
                tot--;
            }
            const order = syms.slice().sort((a, b) => freqs[b] - freqs[a] || a - b);
            let p = 0;
            for (let l = 1; l <= maxBits; l++) for (let c = 0; c < cnt[l]; c++) lens[order[p++]] = l;
        }
        return lens;
    }

    function canonCodes(lens) {
        const n = lens.length, blCount = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(n);
        for (let i = 0; i < n; i++) blCount[lens[i]]++;
        blCount[0] = 0;
        let code = 0;
        for (let b = 1; b <= 15; b++) { code = (code + blCount[b - 1]) << 1; next[b] = code; }
        for (let i = 0; i < n; i++) {
            const l = lens[i];
            if (l) {
                let c = next[l]++, r = 0;
                for (let k = 0; k < l; k++) { r = (r << 1) | (c & 1); c >>= 1; }
                codes[i] = r; // 비트 반전(LSB 우선 기록용)
            }
        }
        return codes;
    }

    function Writer(cap) {
        this.buf = new Uint8Array(cap || 65536); this.pos = 0; this.acc = 0; this.n = 0;
    }
    Writer.prototype.ensure = function (extra) {
        if (this.pos + extra > this.buf.length) {
            const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra));
            nb.set(this.buf.subarray(0, this.pos));
            this.buf = nb;
        }
    };
    Writer.prototype.put = function (val, nbits) {
        this.acc |= val << this.n; this.n += nbits;
        while (this.n >= 8) {
            this.ensure(1);
            this.buf[this.pos++] = this.acc & 255;
            this.acc >>>= 8; this.n -= 8;
        }
    };
    Writer.prototype.finish = function () {
        if (this.n > 0) { this.ensure(1); this.buf[this.pos++] = this.acc & 255; this.acc = 0; this.n = 0; }
        return this.buf.subarray(0, this.pos);
    };

    function writeBlock(wr, toks, tn, final) {
        const lf = new Uint32Array(286), df = new Uint32Array(30);
        for (let i = 0; i < tn; i++) {
            const t = toks[i];
            if (t < 256) lf[t]++;
            else { lf[257 + lenCode[t >>> 16]]++; df[distTab[t & 0xFFFF]]++; }
        }
        lf[256] = 1;
        const ll = huffLengths(lf, 15);
        let dl = huffLengths(df, 15);
        let dAny = false;
        for (let i = 0; i < 30; i++) if (dl[i]) { dAny = true; break; }
        if (!dAny) dl[0] = 1;
        let hlit = 286; while (hlit > 257 && !ll[hlit - 1]) hlit--;
        let hdist = 30; while (hdist > 1 && !dl[hdist - 1]) hdist--;
        const all = new Uint8Array(hlit + hdist);
        all.set(ll.subarray(0, hlit), 0); all.set(dl.subarray(0, hdist), hlit);
        // 코드길이 RLE
        const rle = [], rleExtra = [];
        for (let i = 0; i < all.length;) {
            const v = all[i]; let run = 1;
            while (i + run < all.length && all[i + run] === v) run++;
            if (v === 0 && run >= 3) {
                let r = run;
                while (r >= 3) {
                    if (r >= 11) { const k = Math.min(r, 138); rle.push(18); rleExtra.push(k - 11); r -= k; }
                    else { const k = Math.min(r, 10); rle.push(17); rleExtra.push(k - 3); r -= k; }
                }
                while (r-- > 0) { rle.push(0); rleExtra.push(0); }
                i += run;
            } else if (v !== 0 && run >= 4) {
                rle.push(v); rleExtra.push(0);
                let r = run - 1;
                while (r >= 3) { const k = Math.min(r, 6); rle.push(16); rleExtra.push(k - 3); r -= k; }
                while (r-- > 0) { rle.push(v); rleExtra.push(0); }
                i += run;
            } else {
                for (let k = 0; k < run; k++) { rle.push(v); rleExtra.push(0); }
                i += run;
            }
        }
        const cf = new Uint32Array(19);
        for (let i = 0; i < rle.length; i++) cf[rle[i]]++;
        const cl = huffLengths(cf, 7);
        const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        let hclen = 19; while (hclen > 4 && !cl[ORDER[hclen - 1]]) hclen--;
        const cc = canonCodes(cl), lc = canonCodes(ll), dc = canonCodes(dl);
        wr.put(final ? 1 : 0, 1); wr.put(2, 2);
        wr.put(hlit - 257, 5); wr.put(hdist - 1, 5); wr.put(hclen - 4, 4);
        for (let i = 0; i < hclen; i++) wr.put(cl[ORDER[i]], 3);
        for (let i = 0; i < rle.length; i++) {
            const s = rle[i];
            wr.put(cc[s], cl[s]);
            if (s === 16) wr.put(rleExtra[i], 2);
            else if (s === 17) wr.put(rleExtra[i], 3);
            else if (s === 18) wr.put(rleExtra[i], 7);
        }
        for (let i = 0; i < tn; i++) {
            const t = toks[i];
            if (t < 256) wr.put(lc[t], ll[t]);
            else {
                const len = t >>> 16, dist = t & 0xFFFF;
                const c = lenCode[len];
                wr.put(lc[257 + c], ll[257 + c]);
                if (LE[c]) wr.put(len - LB[c], LE[c]);
                const dcod = distTab[dist];
                wr.put(dc[dcod], dl[dcod]);
                if (DE[dcod]) wr.put(dist - DB[dcod], DE[dcod]);
            }
        }
        wr.put(lc[256], ll[256]);
    }

    return async function deflate(input, onProgress) {
        const n = input.length;
        const wr = new Writer(Math.max(1024, n >> 1));
        const HBITS = 15, HSIZE = 1 << HBITS, WSIZE = 32768, MAXCHAIN = 48;
        const head = new Int32Array(HSIZE).fill(-1);
        const prev = new Int32Array(WSIZE);
        const TOKMAX = 32768;
        const toks = new Uint32Array(TOKMAX);
        let tn = 0;
        function hash3(p) {
            return Math.imul(input[p] | (input[p + 1] << 8) | (input[p + 2] << 16), 2654435761) >>> (32 - HBITS);
        }
        function insert(p) {
            if (p + 2 < n) {
                const h = hash3(p);
                prev[p & (WSIZE - 1)] = head[h];
                head[h] = p;
            }
        }
        let pos = 0, lastYield = 0;
        if (n === 0) {
            wr.put(1, 1); wr.put(1, 2); wr.put(0, 7); // 빈 고정 블록(EOB)
            return wr.finish().slice();
        }
        while (pos < n) {
            let bestLen = 0, bestDist = 0;
            if (pos + 2 < n) {
                const h = hash3(pos);
                let cand = head[h], chain = MAXCHAIN;
                const maxLen = Math.min(258, n - pos);
                while (cand >= 0 && chain-- > 0) {
                    const dist = pos - cand;
                    if (dist <= 0 || dist > WSIZE) break;
                    if (input[cand + bestLen] === input[pos + bestLen] || bestLen === 0) {
                        let l = 0;
                        while (l < maxLen && input[cand + l] === input[pos + l]) l++;
                        if (l > bestLen) {
                            bestLen = l; bestDist = dist;
                            if (l >= maxLen) break;
                        }
                    }
                    const nx = prev[cand & (WSIZE - 1)];
                    if (nx >= cand) break;
                    cand = nx;
                }
                prev[pos & (WSIZE - 1)] = head[h];
                head[h] = pos;
            }
            if (bestLen >= 3) {
                toks[tn++] = (bestLen << 16) | bestDist;
                for (let k = 1; k < bestLen; k++) insert(pos + k);
                pos += bestLen;
            } else {
                toks[tn++] = input[pos];
                pos++;
            }
            if (tn >= TOKMAX - 1 || pos >= n) {
                writeBlock(wr, toks, tn, pos >= n);
                tn = 0;
                if (onProgress && pos - lastYield > 262144) {
                    lastYield = pos;
                    onProgress(pos / n);
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }
        return wr.finish().slice();
    };
})();
/* 네이티브 압축 (가능하면) */
QX.nativeDeflate = async function (u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const cs = new CompressionStream('deflate-raw');
        const buf = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
        return new Uint8Array(buf);
    } catch (e) { return null; }
};

QX.compress = async function (u8, onProgress, forceJs) {
    if (!forceJs) {
        const nat = await QX.nativeDeflate(u8);
        if (nat) return nat;
    }
    return QX.deflate(u8, onProgress);
};

/* ----------------------------------------------------------- 아카이브 */
// 구조: 'QXA1' | headerLen(u32 BE) | header(JSON, UTF-8) | 파일1 데이터 | 파일2 데이터 ...
QX.utf8 = {
    enc: s => new TextEncoder().encode(s),
    dec: b => new TextDecoder('utf-8').decode(b)
};

QX.buildArchive = function (entries) {
    const hdr = {
        v: 1,
        files: entries.map(e => ({ n: e.name, s: e.size, c: e.data.length, m: e.method, crc: e.crc, t: e.mtime || 0 }))
    };
    const hb = QX.utf8.enc(JSON.stringify(hdr));
    let total = 8 + hb.length;
    entries.forEach(e => { total += e.data.length; });
    const out = new Uint8Array(total);
    out.set([0x51, 0x58, 0x41, 0x31], 0);
    new DataView(out.buffer).setUint32(4, hb.length, false);
    out.set(hb, 8);
    let off = 8 + hb.length;
    entries.forEach(e => { out.set(e.data, off); off += e.data.length; });
    return out;
};

QX.parseArchiveHeader = function (u8) {
    if (u8.length < 8) return null;
    if (u8[0] !== 0x51 || u8[1] !== 0x58 || u8[2] !== 0x41 || u8[3] !== 0x31) throw new Error('아카이브 형식이 아닙니다.');
    const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, false);
    if (u8.length < 8 + hl) return null;
    const hdr = JSON.parse(QX.utf8.dec(u8.subarray(8, 8 + hl)));
    return { files: hdr.files, dataOffset: 8 + hl };
};

/* 파일 하나를 아카이브 항목으로 (압축 여부 자동 판단) */
QX.packFile = async function (name, u8, mtime, onProgress, opts) {
    opts = opts || {};
    const size = u8.length;
    const crc = QX.crc32(u8);
    let method = 0, data = u8;
    if (size > 0) {
        const sample = u8.subarray(0, Math.min(size, 262144));
        const sc = await QX.compress(sample, null, opts.forceJs);
        const ratio = sc.length / sample.length;
        if (ratio < 0.95) {
            const full = (size === sample.length) ? sc : await QX.compress(u8, onProgress, opts.forceJs);
            if (full.length < size * 0.98) { method = 1; data = full; }
        }
    }
    return { name, size, crc, method, mtime: mtime || 0, data };
};

/* 수신 측: 아카이브 → 파일들 */
QX.unpackArchive = async function (arc, opts) {
    opts = opts || {};
    const h = QX.parseArchiveHeader(arc);
    if (!h) throw new Error('아카이브 헤더가 불완전합니다.');
    let off = h.dataOffset;
    const files = [];
    for (const f of h.files) {
        const chunk = arc.subarray(off, off + f.c);
        if (chunk.length !== f.c) throw new Error('아카이브가 잘렸습니다: ' + f.n);
        off += f.c;
        let data;
        if (f.m === 0) data = chunk.slice();
        else data = await QX.inflate(chunk, f.s, opts.forceJs);
        const crc = QX.crc32(data);
        if (data.length !== f.s || crc !== f.crc) throw new Error('파일 검증 실패(CRC): ' + f.n);
        files.push({ name: f.n, size: f.s, mtime: f.t || 0, data });
    }
    return files;
};

/* ------------------------------------------------------ ZIP (무압축) */
QX.buildZip = function (files) {
    const parts = [], central = [];
    let offset = 0;
    const te = s => QX.utf8.enc(s);
    const used = {};
    files.forEach(f => {
        let nm = f.name || 'file';
        if (used[nm]) {
            const dot = nm.lastIndexOf('.');
            const base = dot > 0 ? nm.slice(0, dot) : nm, ext = dot > 0 ? nm.slice(dot) : '';
            let k = used[nm]++;
            nm = base + ' (' + k + ')' + ext;
        } else used[nm] = 1;
        const name = te(nm);
        const d = new Date(f.mtime || Date.now());
        const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosD = (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        const crc = QX.crc32(f.data);
        const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
        v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
        v.setUint16(10, dosT, true); v.setUint16(12, dosD, true); v.setUint32(14, crc, true);
        v.setUint32(18, f.data.length, true); v.setUint32(22, f.data.length, true);
        v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
        lh.set(name, 30);
        parts.push(lh, f.data);
        const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true);
        c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
        ch.set(name, 46);
        central.push(ch);
        offset += lh.length + f.data.length;
    });
    let csize = 0;
    central.forEach(c => { csize += c.length; });
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return parts.concat(central, [end]);
};

/* ----------------------------------------------------------- 프레임 포맷 */
// 데이터: [ver=1][type=1][sid u32][seg u16][sym u32][payload B][crc32 u32]  (=B+16 바이트)
// 메타  : [ver=1][type=0][sid u32][total u32][segSize u32][B u16][segCount u16][flags u8][sha256 32][crc32 u32] (55바이트)
QX.FRAME_OVERHEAD = 16;

QX.makeDataFrame = function (sid, seg, sym, payload) {
    const B = payload.length, f = new Uint8Array(B + 16), v = new DataView(f.buffer);
    f[0] = 1; f[1] = 1; v.setUint32(2, sid, false); v.setUint16(6, seg, false); v.setUint32(8, sym, false);
    f.set(payload, 12);
    v.setUint32(12 + B, QX.crc32(f, 0, 12 + B), false);
    return f;
};

QX.makeMetaFrame = function (m) {
    const f = new Uint8Array(55), v = new DataView(f.buffer);
    f[0] = 1; f[1] = 0; v.setUint32(2, m.sid, false); v.setUint32(6, m.total, false); v.setUint32(10, m.segSize, false);
    v.setUint16(14, m.B, false); v.setUint16(16, m.segCount, false); f[18] = m.flags || 0;
    f.set(m.sha, 19);
    v.setUint32(51, QX.crc32(f, 0, 51), false);
    return f;
};

QX.parseFrame = function (f) {
    if (!f || f.length < 20 || f[0] !== 1) return null;
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    if (f[1] === 0) {
        if (f.length !== 55) return null;
        if (v.getUint32(51, false) !== QX.crc32(f, 0, 51)) return null;
        return {
            type: 'meta', sid: v.getUint32(2, false), total: v.getUint32(6, false), segSize: v.getUint32(10, false),
            B: v.getUint16(14, false), segCount: v.getUint16(16, false), flags: f[18], sha: f.slice(19, 51)
        };
    }
    if (f[1] === 1) {
        const B = f.length - 16;
        if (B < 1) return null;
        if (v.getUint32(12 + B, false) !== QX.crc32(f, 0, 12 + B)) return null;
        return { type: 'data', sid: v.getUint32(2, false), seg: v.getUint16(6, false), sym: v.getUint32(8, false), payload: f.subarray(12, 12 + B) };
    }
    return null;
};

/* QR 에 실을 문자열/바이트 변환 */
// 영숫자 모드: 'QX' + base45 + '.'     바이트(고속) 모드: 'QB' + 원시 바이트
QX.frameToText = function (f) { return 'QX' + QX.b45enc(f) + '.'; };
QX.frameToBinary = function (f) {
    const o = new Uint8Array(f.length + 2);
    o[0] = 0x51; o[1] = 0x42; o.set(f, 2);
    return o;
};
// 스캔 결과(문자열 또는 바이트) → 프레임 바이트 (실패 시 null)
QX.decodeScanned = function (text, bytes) {
    if (typeof text === 'string' && text.length > 3 && text.charCodeAt(0) === 0x51 && text.charCodeAt(1) === 0x58) {
        let body = text.slice(2);
        if (body.charAt(body.length - 1) === '.') body = body.slice(0, -1);
        return QX.b45dec(body);
    }
    if (bytes && bytes.length > 4 && bytes[0] === 0x51 && bytes[1] === 0x42) {
        return Uint8Array.from(bytes.slice ? bytes.slice(2) : Array.prototype.slice.call(bytes, 2));
    }
    return null;
};

/* ------------------------------------------ 분수 코드 (시스테매틱 + 랜덤 선형) */
// 구간 하나를 K개의 블록으로 나눈다.
//  - id < K        : 원본 블록 id 그대로 (시스테매틱)
//  - id >= K       : 블록 전체의 무작위 부분집합(각 1/2 확률)의 XOR  (복구 조각)
// 수신 측은 빠진 블록 수(u)보다 3~4개만 더 많은 복구 조각을 받으면 GF(2) 가우스 소거로 한 번에 복원한다.
// 카운터 기반 해시 난수(murmur3 fmix32 두 번). 순차 PRNG(xorshift/mulberry)는 선형 구조·상관 때문에
// 복구 조각 행렬이 랭크 부족이 되는 문제가 있어 사용하지 않는다.
QX.fmix32 = function (h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h >>> 0;
};

QX.symbolIndices = function (K, seg, id) {
    if (id < K) return [id];
    const base = QX.fmix32((Math.imul(id, 0x9E3779B1) ^ Math.imul(seg + 1, 0x85EBCA6B)) | 0) | 0;
    const out = [];
    let bits = 0;
    for (let i = 0; i < K; i++) {
        if ((i & 31) === 0) {
            bits = QX.fmix32(QX.fmix32((base + Math.imul((i >>> 5) + 1, 0x9E3779B9)) | 0) ^ Math.imul(id + 7, 0x27D4EB2F));
        }
        if (bits & 1) out.push(i);
        bits >>>= 1;
    }
    if (out.length === 0) out.push(id % K);
    return out;
};

QX.makeSymbol = function (segData, B, K, seg, id) {
    const out = new Uint8Array(B);
    const idx = QX.symbolIndices(K, seg, id);
    for (let a = 0; a < idx.length; a++) {
        const start = idx[a] * B;
        const end = Math.min(segData.length, start + B);
        for (let i = start, j = 0; i < end; i++, j++) out[j] ^= segData[i];
    }
    return out;
};

QX.SegmentDecoder = function (K, B, segLen, seg) {
    this.K = K; this.B = B; this.segLen = segLen; this.seg = seg;
    this.blocks = new Uint8Array(K * B);
    this.known = new Uint8Array(K);
    this.count = 0;
    this.rows = [];
    this.seen = new Set();
    this.nextTry = 0;
};
QX.SegmentDecoder.prototype.add = function (id, payload) {
    if (this.seen.has(id) || this.count === this.K) return false;
    this.seen.add(id);
    const B = this.B, K = this.K;
    if (id < K) {
        if (!this.known[id]) { this.blocks.set(payload.subarray(0, B), id * B); this.known[id] = 1; this.count++; }
        return true;
    }
    this.rows.push({ idx: QX.symbolIndices(K, this.seg, id), data: payload.slice(0, B) });
    const u = K - this.count;
    if (u > 0 && this.rows.length >= u + 3 && this.rows.length >= this.nextTry) {
        this.gauss();
        this.nextTry = this.rows.length + Math.max(4, Math.ceil(u / 50));
    }
    return true;
};
// GF(2) 가우스-조던 소거: 미지 블록(열) u개, 수집된 복구 조각(행) 사용
QX.SegmentDecoder.prototype.gauss = function () {
    const B = this.B, K = this.K;
    const U = [], colOf = new Int32Array(K).fill(-1);
    for (let i = 0; i < K; i++) if (!this.known[i]) { colOf[i] = U.length; U.push(i); }
    const u = U.length;
    if (u === 0) return true;
    const take = Math.min(this.rows.length, u + 40);
    const W = (u + 31) >>> 5;
    const rows = [];
    for (let r = this.rows.length - take; r < this.rows.length; r++) {  // 가장 최근 행 사용(새 정보 반영)
        const src = this.rows[r], bits = new Uint32Array(W), data = src.data.slice();
        for (let a = 0; a < src.idx.length; a++) {
            const bi = src.idx[a];
            if (this.known[bi]) {
                const off = bi * B;
                for (let k = 0; k < B; k++) data[k] ^= this.blocks[off + k];
            } else {
                const c = colOf[bi];
                bits[c >>> 5] |= (1 << (c & 31));
            }
        }
        rows.push({ bits: bits, data: data });
    }
    let rank = 0;
    const pivotRow = new Int32Array(u).fill(-1);
    for (let c = 0; c < u && rank < rows.length; c++) {
        const w = c >>> 5, m = 1 << (c & 31);
        let pr = -1;
        for (let r = rank; r < rows.length; r++) if (rows[r].bits[w] & m) { pr = r; break; }
        if (pr < 0) continue;
        const t = rows[pr]; rows[pr] = rows[rank]; rows[rank] = t;
        const P = rows[rank];
        for (let r = 0; r < rows.length; r++) {
            if (r === rank || !(rows[r].bits[w] & m)) continue;
            const R = rows[r];
            for (let k = 0; k < W; k++) R.bits[k] ^= P.bits[k];
            for (let k = 0; k < B; k++) R.data[k] ^= P.data[k];
        }
        pivotRow[c] = rank; rank++;
    }
    let solved = 0;
    for (let c = 0; c < u; c++) {
        if (pivotRow[c] < 0) continue;
        const R = rows[pivotRow[c]];
        let single = true;
        for (let k = 0; k < W; k++) {
            const expect = (k === (c >>> 5)) ? ((1 << (c & 31)) >>> 0) : 0;
            if (R.bits[k] !== expect) { single = false; break; }
        }
        if (single && !this.known[U[c]]) {
            this.blocks.set(R.data, U[c] * B); this.known[U[c]] = 1; this.count++; solved++;
        }
    }
    return solved > 0;
};
QX.SegmentDecoder.prototype.complete = function () { return this.count === this.K; };
QX.SegmentDecoder.prototype.getData = function () { return this.blocks.slice(0, this.segLen); };

/* ----------------------------------------------- 송신: 프레임 공급기 */
QX.FrameSource = function (archive, opts) {
    this.archive = archive;
    this.sid = opts.sid >>> 0;
    this.sha = opts.sha;
    this.B = opts.B;
    this.segSize = opts.segSize;
    this.mult = opts.mult || 1.6;
    this.manual = !!opts.manual;
    this.loopAll = opts.loopAll !== false;
    this.metaEvery = opts.metaEvery || 25;
    this.segCount = Math.max(1, Math.ceil(archive.length / this.segSize));
    this.segNext = new Array(this.segCount).fill(0);
    this.cur = 0; this.visitSent = 0; this.sinceMeta = 1e9; this.finished = false; this.loops = 0;
    this._segCache = null;
};
QX.FrameSource.prototype.segLen = function (s) {
    return Math.min(this.segSize, this.archive.length - s * this.segSize);
};
QX.FrameSource.prototype.K = function (s) { return Math.max(1, Math.ceil(this.segLen(s) / this.B)); };
QX.FrameSource.prototype.visitTarget = function (s) {
    return this.manual ? Infinity : Math.ceil(this.K(s) * this.mult);
};
QX.FrameSource.prototype.segData = function (s) {
    if (!this._segCache || this._segCache.s !== s) {
        const a = s * this.segSize;
        this._segCache = { s, d: this.archive.subarray(a, a + this.segLen(s)) };
    }
    return this._segCache.d;
};
QX.FrameSource.prototype.jump = function (s) {
    this.cur = Math.max(0, Math.min(this.segCount - 1, s));
    this.visitSent = 0; this.sinceMeta = 1e9; this.finished = false;
};
QX.FrameSource.prototype.nextSegment = function () {
    if (this.cur + 1 < this.segCount) { this.jump(this.cur + 1); return; }
    if (this.loopAll) { this.loops++; this.jump(0); } else this.finished = true;
};
QX.FrameSource.prototype.meta = function () {
    return QX.makeMetaFrame({ sid: this.sid, total: this.archive.length, segSize: this.segSize, B: this.B, segCount: this.segCount, flags: 0, sha: this.sha });
};
QX.FrameSource.prototype.next = function () {
    if (this.finished) return null;
    if (this.visitSent >= this.visitTarget(this.cur)) {
        this.nextSegment();
        if (this.finished) return null;
    }
    if (this.sinceMeta >= this.metaEvery) {
        this.sinceMeta = 0;
        return { kind: 'meta', bytes: this.meta(), seg: this.cur };
    }
    const s = this.cur, K = this.K(s), id = this.segNext[s]++;
    const payload = QX.makeSymbol(this.segData(s), this.B, K, s, id);
    this.visitSent++; this.sinceMeta++;
    return { kind: 'data', bytes: QX.makeDataFrame(this.sid, s, id, payload), seg: s, sym: id, K };
};
QX.FrameSource.prototype.estimateFrames = function () {
    let total = 0;
    for (let s = 0; s < this.segCount; s++) {
        const n = Math.ceil(this.K(s) * this.mult);
        total += n + Math.ceil(n / this.metaEvery) + 1;
    }
    return total;
};

/* -------------------------------------------- 수신: 조립기 (카메라 무관) */
QX.Assembler = function () { this.reset(); };
QX.Assembler.prototype.reset = function () {
    this.meta = null; this.dec = []; this.segData = []; this.done = []; this.completed = 0;
    this.frames = 0; this.badFrames = 0; this.otherSid = null; this.otherCount = 0; this.symCount = [];
};
QX.Assembler.prototype.setMeta = function (m) {
    this.meta = m;
    this.dec = new Array(m.segCount).fill(null);
    this.segData = new Array(m.segCount).fill(null);
    this.done = new Array(m.segCount).fill(0);
    this.symCount = new Array(m.segCount).fill(0);
    this.completed = 0;
};
QX.Assembler.prototype.segLen = function (s) {
    const m = this.meta;
    return Math.min(m.segSize, m.total - s * m.segSize);
};
QX.Assembler.prototype.segProgress = function (s) {
    if (this.done[s]) return 1;
    const d = this.dec[s];
    return d ? d.count / d.K : 0;
};
QX.Assembler.prototype.restoreSegment = function (s, data) {
    if (!this.meta || s >= this.meta.segCount || this.done[s]) return false;
    if (data.length !== this.segLen(s)) return false;
    this.segData[s] = data; this.done[s] = 1; this.completed++; this.dec[s] = null;
    return true;
};
// 반환: {kind:'meta'|'sym'|'segdone'|'dup'|'wait'|'other'|'bad'}
QX.Assembler.prototype.ingest = function (frameBytes) {
    const f = QX.parseFrame(frameBytes);
    if (!f) { this.badFrames++; return { kind: 'bad' }; }
    this.frames++;
    if (f.type === 'meta') {
        if (!this.meta) { this.setMeta(f); return { kind: 'meta', first: true }; }
        if (f.sid !== this.meta.sid) { this.otherSid = f.sid; this.otherCount++; return { kind: 'other', sid: f.sid }; }
        return { kind: 'meta', first: false };
    }
    if (!this.meta) return { kind: 'wait' };
    if (f.sid !== this.meta.sid) { this.otherSid = f.sid; this.otherCount++; return { kind: 'other', sid: f.sid }; }
    const m = this.meta;
    if (f.seg >= m.segCount || f.payload.length !== m.B) { this.badFrames++; return { kind: 'bad' }; }
    if (this.done[f.seg]) return { kind: 'dup' };
    let d = this.dec[f.seg];
    if (!d) {
        const len = this.segLen(f.seg);
        d = this.dec[f.seg] = new QX.SegmentDecoder(Math.max(1, Math.ceil(len / m.B)), m.B, len, f.seg);
    }
    this.symCount[f.seg]++;
    d.add(f.sym, f.payload);
    if (d.complete()) {
        this.segData[f.seg] = d.getData(); this.done[f.seg] = 1; this.completed++; this.dec[f.seg] = null;
        return { kind: 'segdone', seg: f.seg };
    }
    return { kind: 'sym', seg: f.seg };
};
QX.Assembler.prototype.isComplete = function () {
    return !!this.meta && this.completed === this.meta.segCount;
};
QX.Assembler.prototype.assemble = function () {
    const m = this.meta, out = new Uint8Array(m.total);
    for (let s = 0; s < m.segCount; s++) out.set(this.segData[s], s * m.segSize);
    return out;
};
QX.Assembler.prototype.finalize = async function (opts) {
    const arc = this.assemble();
    const sha = await QX.sha256(arc);
    if (!QX.bytesEqual(sha, this.meta.sha)) throw new Error('전체 해시(SHA-256)가 일치하지 않습니다. 다시 수신하세요.');
    return QX.unpackArchive(arc, opts);
};

/* 보조: 헤더만 미리 읽어 파일 목록 표시 (구간 0 완료 시) */
QX.Assembler.prototype.peekFiles = function () {
    if (!this.meta || !this.done[0]) return null;
    try {
        const h = QX.parseArchiveHeader(this.segData[0]);
        return h ? h.files : null;
    } catch (e) { return null; }
};

/* case-note.html 내장 DB → 공유용 JSON(version 1) 문자열 */
QX.extractCaseNoteJson = function (htmlBytes) {
    const html = QX.utf8.dec(htmlBytes);
    const m = html.match(/<script id="embedded-db-b64" type="text\/plain">([\s\S]*?)<\/script>/);
    if (!m || !m[1].trim()) return null;
    const bin = atob(m[1].trim());
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const db = JSON.parse(QX.utf8.dec(u8));
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const payload = {
        version: 1,
        exportedAt: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()),
        template: db.template,
        cases: db.cases
    };
    return JSON.stringify(payload, null, 2);
};

if (typeof module !== 'undefined' && module.exports) module.exports = QX;
