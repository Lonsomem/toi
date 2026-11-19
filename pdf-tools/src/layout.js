/* ==========================================================================
   PL layout: PDF 쪽 하나의 글자 조각(위치 포함)과 선(표 테두리)을 받아 읽기 순서의 텍스트로 재구성
   - 줄 묶기(글자 크기 비례 허용오차) / 공백·열 간격 판단 / 표 선 기반 격자·병합 셀 / 선 없는 표 추정
   - 입력 좌표계: y 가 아래로 증가하는 화면 좌표(뷰포트 변환 적용 후), 단위 pt
   - 표 행 표현: '␞' + 셀들을 '␟' 로 연결   (일반 줄은 그대로)
   순수 JS (구형 브라우저 호환, Node 에서도 require 가능)
   ========================================================================== */
var PL = {};
PL.ROW = '␞';   // 표 행 시작 표식
PL.CELL = '␟';  // 셀 구분 표식

/* ------------------------------------------------------------ 줄 묶기 */
// items: [{str, x0, x1, y, size}]  (y = 기준선, 아래로 증가)
PL.makeLines = function (items, opt) {
    opt = opt || {};
    var spaceRatio = opt.spaceRatio || 0.17;   // 글자 크기 × 이 값보다 벌어지면 공백
    var colRatio = opt.colRatio || 1.5;        // 글자 크기 × 이 값보다 벌어지면 '열 간격'
    var arr = [];
    var i;
    for (i = 0; i < items.length; i++) {
        // 공백뿐인 조각은 버린다(PDF.js 가 열 사이 간격을 ' ' 조각으로 채워 넣어 열 경계 판단을 방해함)
        if (items[i].str && /\S/.test(items[i].str)) arr.push(items[i]);
    }
    if (!arr.length) return [];
    // y 로 정렬 후 허용오차 안에서 같은 줄로 묶기
    arr.sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; });
    var lines = [];
    var cur = null;
    for (i = 0; i < arr.length; i++) {
        var it = arr[i];
        var tol = Math.max(it.size, cur ? cur.size : 0) * 0.45;
        if (cur && Math.abs(it.y - cur.y) <= tol) {
            cur.items.push(it);
            cur.ysum += it.y; cur.n++; cur.y = cur.ysum / cur.n;
            if (it.size > cur.size) cur.size = it.size;
        } else {
            cur = { items: [it], ysum: it.y, n: 1, y: it.y, size: it.size };
            lines.push(cur);
        }
    }
    // 줄 내부: 글자 단위 박스로 풀어서(조각이 PDF.js 에서 이미 합쳐졌을 수 있음) 중복 제거 → 간격으로 공백/열 판단
    var out = [];
    for (i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var chars = [];
        for (var q = 0; q < ln.items.length; q++) {
            var t = ln.items[q];
            var str = t.str, n = str.length;
            var cw = (t.x1 - t.x0) / n;
            for (var k = 0; k < n; k++) chars.push({ ch: str.charAt(k), x0: t.x0 + k * cw, x1: t.x0 + (k + 1) * cw, w: cw });
        }
        chars.sort(function (p, r) { return p.x0 - r.x0; });
        var sz = Math.max(ln.size, 1);
        var segs = [], seg = null, lastX1 = null, pendSpace = false, kept = [];
        for (var c2 = 0; c2 < chars.length; c2++) {
            var cr = chars[c2];
            if (/\s/.test(cr.ch)) { pendSpace = true; continue; }
            // 이중 인쇄(가짜 굵게) 제거: 같은 글자가 거의 같은 위치에 겹쳐 있으면 하나만
            var dup = false;
            for (var z = kept.length - 1; z >= 0 && z >= kept.length - 3; z--) {
                var kc = kept[z];
                if (kc.ch === cr.ch) {
                    var d = Math.abs((kc.x0 + kc.x1) / 2 - (cr.x0 + cr.x1) / 2);
                    if (d < Math.min(sz * 0.3, 0.45 * Math.min(kc.w, cr.w))) { dup = true; break; }
                }
            }
            if (dup) continue;
            kept.push(cr);
            if (!seg) {
                seg = { text: cr.ch, x0: cr.x0, x1: cr.x1 };
                segs.push(seg);
            } else {
                var gap = cr.x0 - lastX1;
                if (gap > sz * colRatio && gap > 10) {
                    seg = { text: cr.ch, x0: cr.x0, x1: cr.x1 };
                    segs.push(seg);
                } else {
                    seg.text += ((pendSpace || gap > sz * spaceRatio) ? ' ' : '') + cr.ch;
                    if (cr.x1 > seg.x1) seg.x1 = cr.x1;
                }
            }
            lastX1 = Math.max(lastX1 === null ? cr.x1 : lastX1, cr.x1);
            pendSpace = false;
        }
        if (!segs.length) continue;
        out.push({
            y: ln.y, size: ln.size, top: ln.y - ln.size * 0.85, bottom: ln.y + ln.size * 0.25,
            x0: segs[0].x0, x1: segs[segs.length - 1].x1, segs: segs
        });
    }
    out.sort(function (a, b) { return a.y - b.y; });
    return out;
};

PL.lineText = function (line, sep) {
    var parts = [];
    for (var i = 0; i < line.segs.length; i++) parts.push(line.segs[i].text);
    return parts.join(sep === undefined ? '  ' : sep);
};

/* ------------------------------------------------ 선 기반 표 (격자·병합) */
function clusterValues(vals, tol) {
    vals = vals.slice().sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < vals.length; i++) {
        var last = out.length ? out[out.length - 1] : null;
        if (last && vals[i] - last.max <= tol) { last.sum += vals[i]; last.n++; last.max = vals[i]; }
        else out.push({ sum: vals[i], n: 1, max: vals[i] });
    }
    return out.map(function (c) { return c.sum / c.n; });
}

// segs: [{x1,y1,x2,y2}] → 수평/수직으로 정규화·병합
PL.normalizeSegments = function (segs) {
    var H = [], V = [], i;
    for (i = 0; i < segs.length; i++) {
        var s = segs[i];
        var dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
        if (dy <= 1.2 && dx >= 4) H.push({ y: (s.y1 + s.y2) / 2, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) });
        else if (dx <= 1.2 && dy >= 4) V.push({ x: (s.x1 + s.x2) / 2, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) });
    }
    function merge(list, key) {
        list.sort(function (p, q) { return p[key] - q[key] || p.a - q.a; });
        var res = [];
        for (var k = 0; k < list.length; k++) {
            var it = list[k], placed = false;
            for (var m = res.length - 1; m >= 0 && m >= res.length - 40; m--) {
                var r = res[m];
                if (Math.abs(r[key] - it[key]) <= 1.6 && it.a <= r.b + 2.5 && it.b >= r.a - 2.5) {
                    if (it.a < r.a) r.a = it.a;
                    if (it.b > r.b) r.b = it.b;
                    placed = true; break;
                }
            }
            if (!placed) res.push({ x: it.x, y: it.y, a: it.a, b: it.b });
        }
        return res;
    }
    return { H: merge(H, 'y'), V: merge(V, 'x') };
};

PL.detectRuledTables = function (segs, page) {
    var ns = PL.normalizeSegments(segs), H = ns.H, V = ns.V;
    var n = H.length + V.length;
    if (H.length < 2 || V.length < 2 || n > 6000) return [];
    // 연결 요소 (교차하는 선끼리)
    var parent = [], i, j;
    for (i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    var T = 2.5;
    for (i = 0; i < H.length; i++) {
        for (j = 0; j < V.length; j++) {
            var h = H[i], v = V[j];
            if (v.x >= h.a - T && v.x <= h.b + T && h.y >= v.a - T && h.y <= v.b + T) uni(i, H.length + j);
        }
    }
    var comps = {};
    for (i = 0; i < n; i++) {
        var r = find(i);
        (comps[r] || (comps[r] = { H: [], V: [] }));
        if (i < H.length) comps[r].H.push(H[i]); else comps[r].V.push(V[i - H.length]);
    }
    var tables = [];
    Object.keys(comps).forEach(function (key) {
        var c = comps[key];
        if (c.H.length < 2 || c.V.length < 2) return;
        var xs = clusterValues(c.V.map(function (v) { return v.x; }), 2.0);
        var ys = clusterValues(c.H.map(function (h) { return h.y; }), 2.0);
        if (xs.length < 2 || ys.length < 2) return;
        var nr = ys.length - 1, nc = xs.length - 1;
        if (nr * nc > 4000) return;
        // 경계 존재 여부
        function vBorder(ci, row) { // xs[ci] 위치의 수직선이 row 높이를 덮는가
            var y0 = ys[row], y1 = ys[row + 1], need = (y1 - y0) * 0.6;
            for (var q = 0; q < c.V.length; q++) {
                var v = c.V[q];
                if (Math.abs(v.x - xs[ci]) > 2.2) continue;
                var ov = Math.min(v.b, y1 + 2) - Math.max(v.a, y0 - 2);
                if (ov >= need) return true;
            }
            return false;
        }
        function hBorder(ri, col) {
            var x0 = xs[col], x1 = xs[col + 1], need = (x1 - x0) * 0.6;
            for (var q = 0; q < c.H.length; q++) {
                var h = c.H[q];
                if (Math.abs(h.y - ys[ri]) > 2.2) continue;
                var ov = Math.min(h.b, x1 + 2) - Math.max(h.a, x0 - 2);
                if (ov >= need) return true;
            }
            return false;
        }
        var cp = [];
        var idx = function (r2, c2) { return r2 * nc + c2; };
        for (var q = 0; q < nr * nc; q++) cp.push(q);
        function f2(x) { while (cp[x] !== x) { cp[x] = cp[cp[x]]; x = cp[x]; } return x; }
        function u2(a, b) { a = f2(a); b = f2(b); if (a !== b) cp[a] = b; }
        var rr, cc;
        for (rr = 0; rr < nr; rr++) {
            for (cc = 0; cc < nc; cc++) {
                if (cc + 1 < nc && !vBorder(cc + 1, rr)) u2(idx(rr, cc), idx(rr, cc + 1));
                if (rr + 1 < nr && !hBorder(rr + 1, cc)) u2(idx(rr, cc), idx(rr + 1, cc));
            }
        }
        var groups = {};
        for (rr = 0; rr < nr; rr++) {
            for (cc = 0; cc < nc; cc++) {
                var g = f2(idx(rr, cc));
                var G = groups[g] || (groups[g] = { r0: rr, r1: rr, c0: cc, c1: cc });
                if (rr < G.r0) G.r0 = rr; if (rr > G.r1) G.r1 = rr;
                if (cc < G.c0) G.c0 = cc; if (cc > G.c1) G.c1 = cc;
            }
        }
        var cells = Object.keys(groups).map(function (k2) {
            var G = groups[k2];
            return { r0: G.r0, r1: G.r1, c0: G.c0, c1: G.c1, x0: xs[G.c0], x1: xs[G.c1 + 1], y0: ys[G.r0], y1: ys[G.r1 + 1], items: [] };
        });
        if (cells.length < 2) return;
        var bbox = { x0: xs[0], x1: xs[nc], y0: ys[0], y1: ys[nr] };
        var bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0;
        if (bw < 20 || bh < 8) return;
        if (page && bw >= page.width * 0.95 && bh >= page.height * 0.95 && cells.length < 3) return;
        tables.push({ xs: xs, ys: ys, nr: nr, nc: nc, bbox: bbox, cells: cells });
    });
    return tables;
};

// 글자 조각을 표 셀에 배정. 표 밖 조각 배열을 반환
PL.assignToTables = function (items, tables) {
    var rest = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var cx = (it.x0 + it.x1) / 2, cy = it.y - it.size * 0.3;
        var placed = false;
        for (var t = 0; t < tables.length && !placed; t++) {
            var b = tables[t].bbox;
            if (cx < b.x0 - 2 || cx > b.x1 + 2 || cy < b.y0 - 2 || cy > b.y1 + 2) continue;
            var cells = tables[t].cells;
            var best = null, bestD = 1e9;
            for (var c = 0; c < cells.length; c++) {
                var ce = cells[c];
                if (cx >= ce.x0 - 1 && cx <= ce.x1 + 1 && cy >= ce.y0 - 1 && cy <= ce.y1 + 1) {
                    var d = Math.abs(cx - (ce.x0 + ce.x1) / 2) + Math.abs(cy - (ce.y0 + ce.y1) / 2);
                    if (d < bestD) { bestD = d; best = ce; }
                }
            }
            if (best) { best.items.push(it); placed = true; }
        }
        if (!placed) rest.push(it);
    }
    return rest;
};

PL.cellText = function (cell) {
    var lines = PL.makeLines(cell.items);
    var parts = [];
    for (var i = 0; i < lines.length; i++) parts.push(PL.lineText(lines[i], ' '));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};

// 표 → 행 문자열 배열 (빈 행 제거). 병합 셀은 첫 칸에만 글자, 나머지는 빈 칸
PL.tableRows = function (tbl) {
    var m = [], r, c;
    for (r = 0; r < tbl.nr; r++) { m.push([]); for (c = 0; c < tbl.nc; c++) m[r].push(''); }
    tbl.cells.forEach(function (ce) { m[ce.r0][ce.c0] = PL.cellText(ce); });
    var rows = [];
    for (r = 0; r < tbl.nr; r++) {
        var any = false;
        for (c = 0; c < tbl.nc; c++) if (m[r][c]) { any = true; break; }
        if (any) rows.push(m[r]);
    }
    return rows;
};

PL.rowString = function (cells) { return PL.ROW + cells.join(PL.CELL); };

/* --------------------------------------------- 선 없는 표 (정렬 기반 추정) */
// lines: 표 밖 일반 줄들(y 오름차순). 반환: {blocks:[{top, rows:[[cells]]}], used:{lineIndex:true}}
PL.detectBorderless = function (lines) {
    var used = {}, blocks = [];
    var TOLX = 7;
    var i = 0;
    while (i < lines.length) {
        if (lines[i].segs.length < 2) { i++; continue; }
        // 후보 블록 확장
        var start = i, end = i, multi = 0;
        var j = i;
        while (j < lines.length) {
            var ln = lines[j];
            var gapY = j > start ? ln.top - lines[j - 1].bottom : 0;
            var lineH = Math.max(ln.size, 1);
            if (ln.segs.length >= 2) {
                if (j > start && gapY > lineH * 1.6) break;
                multi++; end = j; j++;
            } else if (j > start && gapY <= lineH * 0.9) {
                // 연속(줄바꿈) 후보: 다음 줄이 계속 이어질 때만 포함
                end = j; j++;
            } else break;
        }
        // 끝이 연속 후보 줄이면 한 줄 되돌림
        while (end > start && lines[end].segs.length < 2) end--;
        if (multi < 3) { i = Math.max(i + 1, end + 1); continue; }
        // 열 시작 위치 군집
        var starts = [];
        for (j = start; j <= end; j++) if (lines[j].segs.length >= 2) lines[j].segs.forEach(function (sg) { starts.push(sg.x0); });
        var cols = clusterValues(starts, TOLX);
        // 충분히 자주 등장하는 열만
        var cnt = cols.map(function (cx) {
            var k = 0;
            for (var q = start; q <= end; q++) {
                if (lines[q].segs.length < 2) continue;
                for (var s = 0; s < lines[q].segs.length; s++) if (Math.abs(lines[q].segs[s].x0 - cx) <= TOLX) { k++; break; }
            }
            return k;
        });
        var cols2 = [];
        for (var ci = 0; ci < cols.length; ci++) if (cnt[ci] >= Math.max(2, Math.ceil(multi * 0.5))) cols2.push(cols[ci]);
        if (cols2.length < 2) { i = Math.max(i + 1, end + 1); continue; }
        // 정렬 일관성 검사: 다열 줄의 70% 이상이 2개 이상 열에 맞아야 함
        var okLines = 0;
        for (j = start; j <= end; j++) {
            if (lines[j].segs.length < 2) continue;
            var hits = 0;
            lines[j].segs.forEach(function (sg) { for (var z = 0; z < cols2.length; z++) if (Math.abs(sg.x0 - cols2[z]) <= TOLX) { hits++; break; } });
            if (hits >= 2) okLines++;
        }
        if (okLines < multi * 0.7) { i = Math.max(i + 1, end + 1); continue; }
        // 행 구성
        var rows = [];
        var colOf = function (x) {
            var best = 0, bd = 1e9;
            for (var z = 0; z < cols2.length; z++) { var d = Math.abs(x - cols2[z]); if (d < bd) { bd = d; best = z; } }
            // 열 시작보다 왼쪽이면 해당 열, 아니면 가장 가까운 열 시작 이하
            var pick = 0;
            for (var z2 = 0; z2 < cols2.length; z2++) if (x >= cols2[z2] - TOLX) pick = z2;
            return (bd <= TOLX) ? best : pick;
        };
        for (j = start; j <= end; j++) {
            var L = lines[j];
            if (L.segs.length >= 2) {
                var row = new Array(cols2.length).fill('');
                L.segs.forEach(function (sg) {
                    var cidx = colOf(sg.x0);
                    row[cidx] = row[cidx] ? row[cidx] + ' ' + sg.text : sg.text;
                });
                rows.push(row);
            } else if (rows.length) {
                var cidx2 = colOf(L.segs[0].x0);
                var last = rows[rows.length - 1];
                last[cidx2] = last[cidx2] ? last[cidx2] + ' ' + L.segs[0].text : L.segs[0].text;
            }
            used[j] = true;
        }
        blocks.push({ top: lines[start].top, rows: rows });
        i = end + 1;
    }
    return { blocks: blocks, used: used };
};

/* ------------------------------------------------------------ 쪽 합성 */
// page: {items:[...], segs:[...], width, height}   opt: {ruled:true, borderless:true}
PL.composePage = function (page, opt) {
    opt = opt || {};
    var useRuled = opt.ruled !== false, useBorderless = opt.borderless !== false;
    var items = page.items || [];
    var tables = useRuled ? PL.detectRuledTables(page.segs || [], page) : [];
    var rest = tables.length ? PL.assignToTables(items, tables) : items;
    // 방어: 1열짜리 '표'(쪽 전체 테두리+머리말 선, 박스 친 문단)나 한 칸에 글이 몰린 표는 표가 아니라 일반 글로 되돌린다
    if (tables.length) {
        var keep = [], back = [];
        tables.forEach(function (t) {
            var cols = {}, total = 0, maxN = 0;
            t.cells.forEach(function (ce) { cols[ce.c0] = 1; total += ce.items.length; if (ce.items.length > maxN) maxN = ce.items.length; });
            var ncols = Object.keys(cols).length;
            var oneBig = t.cells.length <= 4 && total > 0 && maxN / total > 0.7 && total > 40;
            if (ncols <= 1 || oneBig) { t.cells.forEach(function (ce) { back = back.concat(ce.items); }); }
            else keep.push(t);
        });
        if (back.length) { tables = keep; rest = rest.concat(back); }
    }
    var lines = PL.makeLines(rest);
    var blocks = [];  // {top, text}
    var stats = { tables: 0, borderlessTables: 0, lines: 0 };

    tables.forEach(function (t) {
        var rows = PL.tableRows(t);
        if (!rows.length) return;
        stats.tables++;
        blocks.push({ top: t.bbox.y0, text: rows.map(PL.rowString).join('\n') });
    });

    var bl = useBorderless ? PL.detectBorderless(lines) : { blocks: [], used: {} };
    bl.blocks.forEach(function (b) {
        stats.borderlessTables++;
        blocks.push({ top: b.top, text: b.rows.map(PL.rowString).join('\n') });
    });
    for (var i = 0; i < lines.length; i++) {
        if (bl.used[i]) continue;
        stats.lines++;
        blocks.push({ top: lines[i].top, text: PL.lineText(lines[i], '  ') });
    }
    blocks.sort(function (a, b) { return a.top - b.top; });
    var text = blocks.map(function (b) { return b.text; }).join('\n');
    return { text: text.normalize ? text.normalize('NFC') : text, stats: stats };
};

/* ------------------------------------------------ PDF.js 입력 변환 */
function matMul(m, n) { // m × n  (PDF: cm 은 CTM' = M × CTM)
    return [
        m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
    ];
}
function applyM(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

// textContent(PDF.js getTextContent 결과), opList(getOperatorList 결과 or null), vt(viewport.transform)
PL.fromPdfJs = function (textContent, opList, OPS, vt, width, height) {
    var items = [];
    var raw = textContent.items || [];
    var pua = 0;
    for (var i = 0; i < raw.length; i++) {
        var it = raw[i];
        if (!it.str) continue;
        var tr = it.transform;
        var size = it.height || Math.hypot(tr[2], tr[3]) || Math.hypot(tr[0], tr[1]);
        if (!(size > 0)) size = 10;
        var dl = Math.hypot(tr[0], tr[1]) || 1;
        var w = it.width || 0;
        var p0 = applyM(vt, tr[4], tr[5]);
        var p1 = applyM(vt, tr[4] + w * tr[0] / dl, tr[5] + w * tr[1] / dl);
        var sz = size * Math.hypot(vt[0], vt[1]);
        var rotated = Math.abs(p1[1] - p0[1]) > Math.max(sz * 0.6, 2) && Math.abs(p1[1] - p0[1]) > Math.abs(p1[0] - p0[0]);
        if (rotated) {
            // 세로쓰기·회전 글자: 한 글자씩 독립 줄로 취급(읽기 순서 보존 불가, 누락 방지 목적)
            items.push({ str: it.str, x0: p0[0], x1: p0[0] + sz, y: Math.min(p0[1], p1[1]) + sz, size: sz });
        } else {
            var x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]);
            if (x1 - x0 < 0.01 && it.str.length) x1 = x0 + sz * 0.5 * it.str.length;
            items.push({ str: it.str, x0: x0, x1: x1, y: p0[1], size: sz });
        }
        for (var k = 0; k < it.str.length; k++) {
            var cc = it.str.charCodeAt(k);
            if ((cc >= 0xE000 && cc <= 0xF8FF) || cc === 0xFFFD) pua++;
        }
    }
    var segs = [];
    var hasImage = false;
    if (opList && OPS) {
        var fn = opList.fnArray, ar = opList.argsArray;
        var ctm = [1, 0, 0, 1, 0, 0], stack = [];
        var pending = [], clip = false;
        var imgOps = {};
        ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintJpegXObject', 'paintImageMaskXObjectGroup'].forEach(function (nm) { if (OPS[nm] !== undefined) imgOps[OPS[nm]] = true; });
        var paintOps = {};
        ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'].forEach(function (nm) { if (OPS[nm] !== undefined) paintOps[OPS[nm]] = true; });
        var addSeg = function (x1, y1, x2, y2) {
            var a = applyM(ctm, x1, y1), b = applyM(ctm, x2, y2);
            var A = applyM(vt, a[0], a[1]), B = applyM(vt, b[0], b[1]);
            segs.push({ x1: A[0], y1: A[1], x2: B[0], y2: B[1] });
        };
        var flushPending = function () {
            for (var q = 0; q < pending.length; q++) {
                var P = pending[q];
                if (P.type === 'line') addSeg(P.x1, P.y1, P.x2, P.y2);
                else { // 사각형
                    var x = P.x, y = P.y, w2 = P.w, h2 = P.h;
                    var mw = Math.abs(w2), mh = Math.abs(h2);
                    // 변환 후 두께 판단을 위해 CTM 스케일 반영
                    var sx = Math.hypot(ctm[0], ctm[1]), sy = Math.hypot(ctm[2], ctm[3]);
                    var tw = mw * sx, th = mh * sy;
                    if (tw <= 2.2 && th > 3) { addSeg(x + w2 / 2, y, x + w2 / 2, y + h2); }                 // 얇은 세로선
                    else if (th <= 2.2 && tw > 3) { addSeg(x, y + h2 / 2, x + w2, y + h2 / 2); }            // 얇은 가로선
                    else if (tw > 3 && th > 3) { // 큰 사각형: 4변(테두리)으로 간주
                        addSeg(x, y, x + w2, y); addSeg(x + w2, y, x + w2, y + h2);
                        addSeg(x + w2, y + h2, x, y + h2); addSeg(x, y + h2, x, y);
                    }
                }
            }
            pending = [];
        };
        for (var oi = 0; oi < fn.length; oi++) {
            var op = fn[oi], a = ar[oi];
            if (op === OPS.save) stack.push(ctm.slice());
            else if (op === OPS.restore) { if (stack.length) ctm = stack.pop(); }
            else if (op === OPS.transform) ctm = matMul(a, ctm);
            else if (op === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = matMul(a[0], ctm); }
            else if (op === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
            else if (op === OPS.constructPath) {
                var ops = a[0], co = a[1], ci = 0, cx = 0, cy = 0, sx0 = 0, sy0 = 0;
                for (var pi = 0; pi < ops.length; pi++) {
                    var po = ops[pi];
                    if (po === OPS.moveTo) { cx = co[ci++]; cy = co[ci++]; sx0 = cx; sy0 = cy; }
                    else if (po === OPS.lineTo) { var nx = co[ci++], ny = co[ci++]; pending.push({ type: 'line', x1: cx, y1: cy, x2: nx, y2: ny }); cx = nx; cy = ny; }
                    else if (po === OPS.curveTo) { ci += 6; }
                    else if (po === OPS.curveTo2 || po === OPS.curveTo3) { ci += 4; }
                    else if (po === OPS.closePath) { if (cx !== sx0 || cy !== sy0) pending.push({ type: 'line', x1: cx, y1: cy, x2: sx0, y2: sy0 }); cx = sx0; cy = sy0; }
                    else if (po === OPS.rectangle) { var rx = co[ci++], ry = co[ci++], rw = co[ci++], rh = co[ci++]; pending.push({ type: 'rect', x: rx, y: ry, w: rw, h: rh }); }
                }
                if (pending.length > 20000) pending = [];
            } else if (paintOps[op]) {
                if (!clip) flushPending(); else pending = [];
                clip = false;
            } else if (op === OPS.endPath) { pending = []; clip = false; }
            else if (op === OPS.clip || op === OPS.eoClip) { clip = true; }
            else if (imgOps[op]) hasImage = true;
        }
    }
    return { items: items, segs: segs, width: width, height: height, hasImage: hasImage, pua: pua };
};

/* ------------------------------------------------ 텍스트 표시/검색 보조 */
// 저장 텍스트 → 복사용(탭 구분)
PL.toTsv = function (text) {
    return String(text || '').split('\n').map(function (ln) {
        return ln.charAt(0) === PL.ROW ? ln.slice(1).split(PL.CELL).join('\t') : ln;
    }).join('\n');
};
// 저장 텍스트 → 스니펫/목차용 한 줄 표시
PL.toPlain = function (text) {
    return String(text || '').split(PL.ROW).join('').split(PL.CELL).join(' | ');
};

if (typeof module !== 'undefined' && module.exports) module.exports = PL;
