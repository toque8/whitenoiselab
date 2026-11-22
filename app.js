(function () {
'use strict';

function dspCore() {
'use strict';
const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
const LN2 = Math.log(2);

function rng(seed) {
let a = (seed >>> 0) || 1;
return function () {
a = (a + 0x6D2B79F5) >>> 0;
let t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
function gauss(r) {
let u = 0, v = 0;
while (u === 0) u = r();
while (v === 0) v = r();
return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function bqSet(f, kind, fc, q, gdb, sr) {
fc = clamp(fc, 4, sr * 0.47);
q = Math.max(0.05, q);
const w0 = 2 * Math.PI * fc / sr, cw = Math.cos(w0), sw = Math.sin(w0);
let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
if (kind === 'lp') { const al = sw / (2 * q); b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
else if (kind === 'hp') { const al = sw / (2 * q); b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
else if (kind === 'bp') { const al = sw / (2 * q); b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
else if (kind === 'peak') { const A = Math.pow(10, gdb / 40), al = sw / (2 * q); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
else {
const A = Math.pow(10, gdb / 40), al = sw / 2 * Math.SQRT2, t = 2 * Math.sqrt(A) * al;
if (kind === 'ls') { b0 = A * ((A + 1) - (A - 1) * cw + t); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - t); a0 = (A + 1) + (A - 1) * cw + t; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - t; }
else { b0 = A * ((A + 1) + (A - 1) * cw + t); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - t); a0 = (A + 1) - (A - 1) * cw + t; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - t; }
}
f.b0 = b0 / a0; f.b1 = b1 / a0; f.b2 = b2 / a0; f.a1 = a1 / a0; f.a2 = a2 / a0;
return f;
}
function bqNew(kind, fc, q, gdb, sr) {
return bqSet({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }, kind, fc, q, gdb, sr);
}
function bqRun(f, x) {
const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
return y;
}
function rawBq(b0, b1, b2, a0, a1, a2) {
return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function reverbNew(sr, ch, key, wet) {
const P = {
room: { size: 0.56, damp: 0.52, pre: 0.008, width: 0.55 },
hall: { size: 0.78, damp: 0.34, pre: 0.020, width: 0.9 },
opera: { size: 0.86, damp: 0.27, pre: 0.030, width: 1.0 },
cathedral: { size: 0.94, damp: 0.19, pre: 0.045, width: 1.0 },
parking: { size: 0.82, damp: 0.63, pre: 0.014, width: 0.8 },
tunnel: { size: 0.90, damp: 0.46, pre: 0.050, width: 0.65 }
}[key] || { size: 0.78, damp: 0.34, pre: 0.020, width: 0.9 };
const sc = sr / 44100;
const fb = 0.30 + P.size * 0.66;
const damp = clamp(P.damp, 0, 0.9) * 0.45;
const w = clamp(wet, 0, 1);
const combT = [1116, 1188, 1277, 1356];
const apT = [556, 441, 225];
const pre = Math.max(1, Math.round(P.pre * sr));
const erD = [Math.max(1, Math.round(0.017 * sr)), Math.max(2, Math.round(0.029 * sr)), Math.max(3, Math.round(0.043 * sr))];
const dlN = Math.max(pre, erD[2]) + 2;
const chans = [];
for (let c = 0; c < ch; c++) {
const off = Math.round(c * 23 * P.width * sc);
const combs = [];
for (let i = 0; i < combT.length; i++) { const n = Math.max(4, Math.round(combT[i] * sc) + off); combs.push({ b: new Float32Array(n), n: n, i: 0, s: 0 }); }
const aps = [];
for (let i = 0; i < apT.length; i++) { const n = Math.max(4, Math.round(apT[i] * sc) + off); aps.push({ b: new Float32Array(n), n: n, i: 0 }); }
chans.push({ combs: combs, aps: aps, dl: new Float32Array(dlN), di: 0 });
}
return {
process: function (bufs, n) {
const nch = Math.min(ch, bufs.length);
for (let i = 0; i < n; i++) {
for (let c = 0; c < nch; c++) {
const st = chans[c], dry = bufs[c][i];
st.dl[st.di] = dry;
const rd = function (d) { return st.dl[(st.di - d + dlN * 2) % dlN]; };
let inp = rd(pre) + 0.34 * rd(erD[0]) + 0.24 * rd(erD[1]) + 0.16 * rd(erD[2]);
st.di = (st.di + 1) % dlN;
inp *= 0.32;
let acc = 0;
for (let k = 0; k < st.combs.length; k++) {
const cm = st.combs[k];
const y = cm.b[cm.i];
cm.s = y * (1 - damp) + cm.s * damp;
cm.b[cm.i] = inp + cm.s * fb;
cm.i = (cm.i + 1) % cm.n;
acc += y;
}
for (let k = 0; k < st.aps.length; k++) {
const ap = st.aps[k];
const buf = ap.b[ap.i];
const y = -acc + buf;
ap.b[ap.i] = acc + buf * 0.5;
ap.i = (ap.i + 1) % ap.n;
acc = y;
}
bufs[c][i] = dry * (1 - w * 0.55) + acc * w * 0.42;
}
}
}
};
}
function fftMake(n) {
const levels = Math.round(Math.log2(n));
const rev = new Uint32Array(n);
for (let i = 0; i < n; i++) { let x = i, r = 0; for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
const ct = new Float64Array(n / 2), st = new Float64Array(n / 2);
for (let i = 0; i < n / 2; i++) { ct[i] = Math.cos(2 * Math.PI * i / n); st[i] = Math.sin(2 * Math.PI * i / n); }
return function (re, im, inv) {
for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
for (let size = 2; size <= n; size *= 2) {
const half = size >> 1, step = n / size;
for (let i = 0; i < n; i += size) {
for (let j = i, k = 0; j < i + half; j++, k += step) {
const c = ct[k], s = inv ? st[k] : -st[k];
const tr = re[j + half] * c - im[j + half] * s;
const ti = re[j + half] * s + im[j + half] * c;
re[j + half] = re[j] - tr; im[j + half] = im[j] - ti;
re[j] += tr; im[j] += ti;
}
}
}
if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
};
}
const GF = [1, 5, 15, 36, 75, 138, 235, 376, 572, 835, 1181, 1500, 2183, 2874, 3718, 4800, 5946, 7377, 9051, 10996, 13239, 15808, 18735, 22050];
const GD = [61, 61, 56, 40, 25, 17, 11, 7, 5, 4, 6, 8, 3, 1, 1, 4, 9, 14, 17, 16, 10, 5, 2, 1];
function greyDb(f) {
if (f <= GF[0]) return GD[0];
if (f >= GF[GF.length - 1]) return GD[GD.length - 1];
let lo = 0, hi = GF.length - 1;
while (hi - lo > 1) { const m = (lo + hi) >> 1; if (GF[m] <= f) lo = m; else hi = m; }
const t = (Math.log(f) - Math.log(GF[lo])) / (Math.log(GF[hi]) - Math.log(GF[lo]));
return GD[lo] + t * (GD[hi] - GD[lo]);
}
const GREY_REF = greyDb(1000);
function curveDbAt(curve, f, fMin, fMax) {
if (f <= fMin) return (curve[0] - 0.5) * 48;
if (f >= fMax) return (curve[curve.length - 1] - 0.5) * 48;
const t = Math.log(f / fMin) / Math.log(fMax / fMin);
const p = t * (curve.length - 1);
const i = Math.floor(p), fr = p - i;
const a = curve[i], b = curve[Math.min(curve.length - 1, i + 1)];
const v = a + (b - a) * fr;
return v <= 0.008 ? -80 : (v - 0.5) * 48;
}
function magFor(type, tilt, sr, curve) {
const fMin = 20, fMax = Math.min(20000, sr * 0.47);
const tl = tilt || 0;
let matchRef = 1;
if (type === 'match' && curve && curve.length) {
let mx = 0;
for (let i = 0; i < curve.length; i++) if (curve[i] > mx) mx = curve[i];
matchRef = mx > 1e-20 ? mx : 1;
}
return function (f) {
if (f <= 0) return 0;
const hp = 1 / (1 + Math.pow(fMin / f, 4));
const lp = 1 / (1 + Math.pow(f / fMax, 4));
let a = 1;
if (type === 'pink') a = Math.pow(f / 1000, -0.5);
else if (type === 'brown') a = Math.pow(f / 1000, -1);
else if (type === 'blue') a = Math.pow(f / 1000, 0.5);
else if (type === 'violet') a = f / 1000;
else if (type === 'alpha') a = Math.pow(f / 1000, -tl / 2);
else if (type === 'green') { const l = Math.log(f / 500) / LN2; a = Math.exp(-(l * l) / 0.5); }
else if (type === 'grey') a = Math.pow(10, (greyDb(f) - GREY_REF) / 20);
else if (type === 'curve') a = Math.pow(10, curveDbAt(curve, f, fMin, fMax) / 20);
else if (type === 'pinkband') a = (f >= 500 && f <= 2000) ? Math.pow(f / 1000, -0.5) : 0;
else if (type === 'match') {
if (!curve || !curve.length) return 0;
const N = curve.length * 2;
const k = f * N / sr;
if (k >= curve.length - 1) return 0;
const i = Math.max(0, Math.floor(k)), fr = k - i;
const p0 = curve[i], p1 = curve[Math.min(curve.length - 1, i + 1)];
a = Math.sqrt(Math.max(p0 + (p1 - p0) * fr, 0) / matchRef);
}
if (type !== 'alpha' && type !== 'curve' && Math.abs(tl) > 0.02) a *= Math.pow(f / 1000, -tl / 2);
return a * hp * lp;
};
}
function firDesign(taps, sr, mag) {
const N = taps, fft = fftMake(N);
const re = new Float64Array(N), im = new Float64Array(N);
for (let k = 0; k <= N / 2; k++) {
const m = mag(k * sr / N);
re[k] = m; im[k] = 0;
if (k > 0 && k < N / 2) { re[N - k] = m; im[N - k] = 0; }
}
fft(re, im, true);
const h = new Float32Array(N);
for (let n = 0; n < N; n++) {
const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
h[n] = re[(n + N / 2) % N] * w;
}
return h;
}
function firGen(h, r, useGauss) {
const L = h.length, M = 2 * L, fft = fftMake(M);
const Hr = new Float64Array(M), Hi = new Float64Array(M);
for (let i = 0; i < L; i++) Hr[i] = h[i];
fft(Hr, Hi, false);
const xr = new Float64Array(M), xi = new Float64Array(M);
const hist = new Float64Array(L);
const outBuf = new Float32Array(L);
let pos = L;
function block() {
for (let j = 0; j < L; j++) { xr[j] = hist[j]; xi[j] = 0; }
for (let j = 0; j < L; j++) { const w = useGauss ? gauss(r) * 0.5 : r() * 2 - 1; xr[L + j] = w; xi[L + j] = 0; hist[j] = w; }
fft(xr, xi, false);
for (let k = 0; k < M; k++) { const a = xr[k], b = xi[k]; xr[k] = a * Hr[k] - b * Hi[k]; xi[k] = a * Hi[k] + b * Hr[k]; }
fft(xr, xi, true);
for (let j = 0; j < L; j++) outBuf[j] = xr[L + j];
pos = 0;
}
return function (out, n) { for (let i = 0; i < n; i++) { if (pos >= L) block(); out[i] = outBuf[pos++]; } };
}
function granularGen(src, sr, seed, grainMs) {
const r = rng(seed);
const base = Math.max(256, Math.round(sr * clamp(grainMs, 20, 400) / 1000));
const hop = Math.max(64, base >> 2);
const voices = [];
let outIdx = 0, nextStart = 0;
const srcLen = src.length;
return function (out, n) {
for (let i = 0; i < n; i++) {
if (outIdx >= nextStart) {
const len = Math.max(128, Math.round(base * (0.7 + r() * 0.7)));
const rate = 0.85 + r() * 0.3;
const room = srcLen - Math.ceil(len * rate) - 2;
voices.push({ p: room > 1 ? r() * room : 0, rate: rate, t: 0, len: len, g: 0.55 + r() * 0.45 });
nextStart += hop;
}
let s = 0;
for (let k = voices.length - 1; k >= 0; k--) {
const v = voices[k];
const x = v.t / v.len;
const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
const i0 = Math.floor(v.p);
if (i0 >= 0 && i0 < srcLen - 1) s += (src[i0] + (src[i0 + 1] - src[i0]) * (v.p - i0)) * env * v.g;
v.p += v.rate; v.t++;
if (v.t >= v.len) voices.splice(k, 1);
}
out[i] = s * 0.5;
outIdx++;
}
};
}
function tiltChain(tilt, sr) {
if (!tilt || Math.abs(tilt) < 0.02) return null;
const fMax = Math.min(20000, sr * 0.47), fMin = 20, d = 1.25;
const m = Math.ceil(Math.log2(fMax / fMin) / d);
const step = 3.0103 * tilt * d;
const f = [];
for (let i = 0; i < m; i++) f.push(bqNew('ls', fMax / Math.pow(2, i * d), 0.9, step, sr));
return { f: f, n: f.length, norm: Math.pow(10, -Math.abs(step) * f.length / 40) };
}
function noiseGen(type, sr, seed, opts) {
const o = opts || {};
const r = rng(seed);
const useGauss = o.dist === 'gauss';
const src = useGauss ? function () { return gauss(r) * 0.5; } : function () { return r() * 2 - 1; };
const warp = 44100 / sr;
const tc = type === 'alpha' ? null : tiltChain(o.tilt, sr);
function wrap(gen) {
if (!tc) return gen;
return function (out, n) {
gen(out, n);
for (let i = 0; i < n; i++) {
let v = out[i];
for (let k = 0; k < tc.n; k++) v = bqRun(tc.f[k], v);
out[i] = v * tc.norm;
}
};
}
if (type === 'pink' || type === 'pinkband' || type === 'blue') {
const p0 = [0.99886, 0.99332, 0.96900, 0.86650, 0.55000];
const p = p0.map(function (v) { return Math.pow(v, warp); });
const g0 = [0.0555179, 0.0750759, 0.1538520, 0.3104856, 0.5329522];
const g = g0.map(function (v, i) { return v * (1 - p[i]) / (1 - p0[i]); });
const pn = -Math.pow(0.7616, warp);
const gn = -0.0168980 * (1 - pn) / (1 + 0.7616);
const blueK = 0.35 * warp;
let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, prev = 0;
const band = type === 'pinkband' ? [bqNew('hp', 500, 0.7, 0, sr), bqNew('hp', 500, 0.7, 0, sr), bqNew('lp', 2000, 0.7, 0, sr), bqNew('lp', 2000, 0.7, 0, sr)] : null;
return wrap(function (out, n) {
for (let i = 0; i < n; i++) {
let w = src();
if (type === 'blue') { const d = (w - prev) * blueK; prev = w; w = d; }
b0 = p[0] * b0 + g[0] * w; b1 = p[1] * b1 + g[1] * w; b2 = p[2] * b2 + g[2] * w;
b3 = p[3] * b3 + g[3] * w; b4 = p[4] * b4 + g[4] * w; b5 = pn * b5 + gn * w;
let v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
b6 = w * 0.115926;
if (band) { for (let k = 0; k < 4; k++) v = bqRun(band[k], v); }
out[i] = v;
}
});
}
if (type === 'brown') {
const a = Math.exp(-2 * Math.PI * 20 / sr);
const dc = Math.exp(-2 * Math.PI * 8 / sr);
const sig = useGauss ? 0.5 : 0.57735;
const rmsY = sig * Math.sqrt((1 - a) / (1 + a));
const k = rmsY > 1e-12 ? 0.1 / rmsY : 1;
let y = 0, m = 0;
return wrap(function (out, n) {
for (let i = 0; i < n; i++) {
y = a * y + (1 - a) * src();
m = dc * m + (1 - dc) * y;
out[i] = (y - m) * k;
}
});
}
if (type === 'violet') {
let prev = 0;
const k = 0.5 * warp;
return wrap(function (out, n) { for (let i = 0; i < n; i++) { const w = src(); out[i] = (w - prev) * k; prev = w; } });
}
if (type === 'green') {
const f = [bqNew('bp', 500, 1.05, 0, sr), bqNew('bp', 500, 1.05, 0, sr), bqNew('bp', 500, 1.05, 0, sr), bqNew('bp', 500, 1.05, 0, sr)];
return wrap(function (out, n) { for (let i = 0; i < n; i++) { let v = src(); for (let k = 0; k < 4; k++) v = bqRun(f[k], v); out[i] = v * 6; } });
}
if (type === 'grey') {
const f = [bqNew('ls', 15, 1, 8, sr), bqNew('ls', 70, 1, 20, sr), bqNew('ls', 250, 1, 12, sr), bqNew('peak', 1500, 1.5, 3, sr), bqNew('peak', 3200, 1.2, -6, sr), bqNew('hs', 7000, 1, 14, sr), bqNew('lp', 15000, 0.7, 0, sr), bqNew('lp', 13000, 0.6, 0, sr)];
return wrap(function (out, n) { for (let i = 0; i < n; i++) { let v = src(); for (let k = 0; k < 8; k++) v = bqRun(f[k], v); out[i] = v * 0.06; } });
}
if (type === 'alpha') {
const al = o.alpha === undefined ? 1 : o.alpha;
if (Math.abs(al) < 0.02) return function (out, n) { for (let i = 0; i < n; i++) out[i] = src(); };
const t = tiltChain(al, sr);
return function (out, n) { for (let i = 0; i < n; i++) { let v = src(); for (let k = 0; k < t.n; k++) v = bqRun(t.f[k], v); out[i] = v * t.norm; } };
}
return wrap(function (out, n) { for (let i = 0; i < n; i++) out[i] = src(); });
}
function synthGen(kind, sr, seed, drift, alpha) {
const r = rng(seed);
const base = noiseGen('alpha', sr, (seed ^ 0x9e3779b9) >>> 0, { alpha: alpha });
const f = kind === 'rain' ? bqNew('hp', 2000, 0.5, 0, sr) : (kind === 'surf' ? bqNew('lp', 1200, 1.2, 0, sr) : bqNew('lp', 600, 3, 0, sr));
const dr = clamp(drift, 0, 100) / 100;
const twoPi = 2 * Math.PI;
let ctl = 0, idx = 0, amp = kind === 'rain' ? 0.35 : 0.4;
let wander = 0, target = 0, wctl = 0;
return function (out, n) {
base(out, n);
for (let i = 0; i < n; i++) {
if (ctl === 0) {
const t = idx / sr;
if (wctl === 0) { target = (r() * 2 - 1) * dr; wctl = Math.round(sr * 0.7); }
wctl--;
wander += (target - wander) * 0.0006;
if (kind === 'wind') {
bqSet(f, 'lp', 600 * Math.pow(2, wander * 0.9) + 350 * Math.sin(twoPi * 0.15 * t) + 120 * Math.sin(twoPi * 0.037 * t), 3, 0, sr);
amp = 0.4 * (1 + wander * 0.4);
} else if (kind === 'surf') {
amp = (0.4 + 0.3 * Math.sin(twoPi * 0.08 * t)) * (1 + wander * 0.5);
bqSet(f, 'lp', 1200 * Math.pow(2, wander * 0.5), 1.2, 0, sr);
} else {
bqSet(f, 'hp', 2000 * Math.pow(2, wander * 0.4), 0.5, 0, sr);
amp = 0.35 * (1 + wander * 0.35);
}
ctl = 64;
}
ctl--; idx++;
out[i] = bqRun(f, out[i]) * amp;
}
};
}
function kFilters(sr) {
let K = Math.tan(Math.PI * 1681.974450955533 / sr);
const Vh = Math.pow(10, 3.99984385397334 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
let a0 = 1 + K / 0.7071752369554196 + K * K;
const shelf = rawBq(Vh + Vb * K / 0.7071752369554196 + K * K, 2 * (K * K - Vh), Vh - Vb * K / 0.7071752369554196 + K * K, a0, 2 * (K * K - 1), 1 - K / 0.7071752369554196 + K * K);
K = Math.tan(Math.PI * 38.13547087602444 / sr);
a0 = 1 + K / 0.5003270373238773 + K * K;
const hp = rawBq(1, -2, 1, a0, 2 * (K * K - 1), 1 - K / 0.5003270373238773 + K * K);
return [shelf, hp];
}
function tpCoeffs() {
const out = [];
for (let p = 1; p <= 3; p++) {
const d = p / 4, c = new Float64Array(16);
let s = 0;
for (let k = 0; k < 16; k++) {
const x = k - 7 - d;
const sc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
const t = (k + 0.5) / 16;
const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
c[k] = sc * w; s += c[k];
}
for (let k = 0; k < 16; k++) c[k] /= s;
out.push(c);
}
return out;
}
const TPC = tpCoeffs();
function truePeakOf(a) {
let pk = 0;
for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > pk) pk = v; }
for (let i = 8; i < a.length - 8; i++) {
const av = a[i] < 0 ? -a[i] : a[i];
if (av < pk * 0.5) continue;
const p = a[i - 1] < 0 ? -a[i - 1] : a[i - 1], n = a[i + 1] < 0 ? -a[i + 1] : a[i + 1];
if (av < p || av < n) continue;
for (let ph = 0; ph < 3; ph++) {
const co = TPC[ph];
let s = 0;
for (let k = 0; k < 16; k++) s += co[k] * a[i - 7 + k];
const as = s < 0 ? -s : s;
if (as > pk) pk = as;
}
}
return pk;
}
function spectralCore(sr, total, N, windowName, colsWanted) {
const half = N >> 1;
const cols = Math.max(8, Math.min(colsWanted, Math.max(8, Math.floor(total / 64))));
const hop = Math.max(1, Math.floor(total / cols));
const fft = fftMake(N);
const re = new Float64Array(N), im = new Float64Array(N);
const win = new Float64Array(N);
let ws2 = 0;
for (let i = 0; i < N; i++) {
const t = i / (N - 1);
let w;
if (windowName === 'hamming') w = 0.54 - 0.46 * Math.cos(2 * Math.PI * t);
else if (windowName === 'blackman') w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
else if (windowName === 'rect') w = 1;
else w = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
win[i] = w; ws2 += w * w;
}
const spectra = new Float32Array(cols * half);
const ring = new Float32Array(N);
let rp = 0, col = 0;
let nextAt = total >= N ? Math.min(N - 1, total - 1) : Math.min(hop, Math.max(0, total - 1));
function frame() {
for (let i = 0; i < N; i++) { re[i] = ring[(rp + i) % N] * win[i]; im[i] = 0; }
fft(re, im, false);
const base = col * half, k2 = 2 / (N * ws2);
for (let k = 0; k < half; k++) spectra[base + k] = (re[k] * re[k] + im[k] * im[k]) * (k === 0 ? k2 * 0.5 : k2);
col++;
}
return {
cols: cols, hop: hop, half: half, fftSize: N,
feed: function (arr, n, start) {
for (let i = 0; i < n; i++) {
ring[rp] = arr[i];
rp = (rp + 1) % N;
if (start + i === nextAt && col < cols) { frame(); nextAt += hop; }
}
},
finish: function () {
while (col < cols) frame();
const avg = new Float32Array(half);
for (let c = 0; c < cols; c++) { const b = c * half; for (let k = 0; k < half; k++) avg[k] += spectra[b + k]; }
for (let k = 0; k < half; k++) avg[k] /= cols;
return { spectra: spectra, avg: avg, cols: cols, half: half, hop: hop, fftSize: N, window: windowName };
}
};
}
function measureSpectrum(arr, sr, N, windowName) {
const sp = spectralCore(sr, arr.length, N, windowName, 256);
const CH = 32768;
let pos = 0;
while (pos < arr.length) {
const n = Math.min(CH, arr.length - pos);
sp.feed(arr.subarray(pos, pos + n), n, pos);
pos += n;
}
return sp.finish().avg;
}
const HB = 256;
function makeAnalyzer(sr, ch, total, opts) {
const sp = spectralCore(sr, total, opts.fftSize, opts.window, opts.cols);
const kf = []; for (let c = 0; c < ch; c++) kf.push(kFilters(sr));
const sub = Math.max(1, Math.round(sr * 0.1));
const energies = []; for (let c = 0; c < ch; c++) energies.push([]);
const acc = new Float64Array(ch);
let subIdx = 0;
const tpRing = []; for (let c = 0; c < ch; c++) tpRing.push(new Float32Array(24));
let tpPos = 0, tpFill = 0;
const hist = new Float64Array(HB);
const peaksMin = new Float32Array(opts.buckets).fill(Infinity);
const peaksMax = new Float32Array(opts.buckets).fill(-Infinity);
const bStep = opts.buckets / total;
const tpBlocks = [];
let tpBlockMax = 0, tpBlockIdx = 0;
let peak = 0, tp = 0, sum = 0, sum2 = 0, sum3 = 0, sum4 = 0, nAct = 0;
let sL = 0, sR = 0, sLL = 0, sRR = 0, sLR = 0, nCorr = 0;
let clipped = 0;
const aStart = opts.activeStart, aEnd = opts.activeEnd;
return {
feed: function (bufs, n, start) {
for (let i = 0; i < n; i++) {
const g = start + i;
const active = g >= aStart && g < aEnd;
const bucket = Math.min(opts.buckets - 1, (g * bStep) | 0);
let frameMax = 0;
for (let c = 0; c < ch; c++) {
const v = bufs[c][i];
const a = v < 0 ? -v : v;
if (v < peaksMin[bucket]) peaksMin[bucket] = v;
if (v > peaksMax[bucket]) peaksMax[bucket] = v;
if (a > peak) peak = a;
if (a > 1) clipped++;
if (a > frameMax) frameMax = a;
const kv = bqRun(kf[c][1], bqRun(kf[c][0], v));
acc[c] += kv * kv;
tpRing[c][tpPos] = v;
if (active) {
sum += v; sum2 += v * v; sum3 += v * v * v; sum4 += v * v * v * v; nAct++;
hist[clamp(((v + 1) * 0.5 * HB) | 0, 0, HB - 1)]++;
}
}
if (tpFill >= 24) {
for (let c = 0; c < ch; c++) {
const tr = tpRing[c];
const ci = (tpPos - 12 + 24) % 24;
const v = tr[ci], av = v < 0 ? -v : v;
if (av > peak * 0.5) {
const pv = tr[(ci - 1 + 24) % 24], nx = tr[(ci + 1) % 24];
if (av >= (pv < 0 ? -pv : pv) && av >= (nx < 0 ? -nx : nx)) {
for (let p = 0; p < 3; p++) {
const co = TPC[p];
let s = 0;
for (let k = 0; k < 16; k++) s += co[k] * tr[(ci - 7 + k + 48) % 24];
const as = s < 0 ? -s : s;
if (as > tp) tp = as;
if (as > tpBlockMax) tpBlockMax = as;
}
}
}
}
}
tpPos = (tpPos + 1) % 24;
if (tpFill < 24) tpFill++;
if (frameMax > tp) tp = frameMax;
if (frameMax > tpBlockMax) tpBlockMax = frameMax;
if (ch === 2 && active) { const l = bufs[0][i], rr = bufs[1][i]; sL += l; sR += rr; sLL += l * l; sRR += rr * rr; sLR += l * rr; nCorr++; }
subIdx++;
if (subIdx === sub) { for (let c = 0; c < ch; c++) { energies[c].push(acc[c]); acc[c] = 0; } subIdx = 0; }
tpBlockIdx++;
if (tpBlockIdx === sub) { tpBlocks.push(tpBlockMax); tpBlockMax = 0; tpBlockIdx = 0; }
}
sp.feed(bufs[0], n, start);
},
finish: function () {
const s = sp.finish();
if (subIdx > 0) for (let c = 0; c < ch; c++) energies[c].push(acc[c] * sub / subIdx);
if (tpBlockIdx > 0) tpBlocks.push(tpBlockMax);
for (let i = 0; i < peaksMin.length; i++) {
if (!isFinite(peaksMin[i])) peaksMin[i] = 0;
if (!isFinite(peaksMax[i])) peaksMax[i] = 0;
}
const nSub = energies[0].length;
const loud = function (p) { return -0.691 + 10 * Math.log10(Math.max(p, 1e-14)); };
function blockLoud(i, len) {
let p = 0;
for (let c = 0; c < ch; c++) { let sm = 0; for (let k = i; k < i + len; k++) sm += energies[c][k]; p += sm / (len * sub); }
return loud(p);
}
const M = new Float32Array(nSub), S = new Float32Array(nSub);
for (let i = 0; i < nSub; i++) {
M[i] = i >= 3 ? blockLoud(i - 3, 4) : NaN;
S[i] = i >= 29 ? blockLoud(i - 29, 30) : NaN;
}
const mAbs = [];
for (let i = 3; i < nSub; i++) if (M[i] > -70) mAbs.push(M[i]);
let I = NaN;
if (mAbs.length) {
const mean = mAbs.reduce(function (a, b) { return a + Math.pow(10, b / 10); }, 0) / mAbs.length;
const rel = 10 * Math.log10(mean) - 10;
const gated = mAbs.filter(function (v) { return v > rel; });
if (gated.length) I = 10 * Math.log10(gated.reduce(function (a, b) { return a + Math.pow(10, b / 10); }, 0) / gated.length);
}
let LRA = NaN;
const sAbs = [];
for (let i = 29; i < nSub; i++) if (S[i] > -70) sAbs.push(S[i]);
if (sAbs.length > 2) {
const mean = sAbs.reduce(function (a, b) { return a + Math.pow(10, b / 10); }, 0) / sAbs.length;
const rel = 10 * Math.log10(mean) - 20;
const g = sAbs.filter(function (v) { return v > rel; }).sort(function (a, b) { return a - b; });
if (g.length > 2) LRA = g[Math.floor((g.length - 1) * 0.95)] - g[Math.floor((g.length - 1) * 0.1)];
}
const rms = nAct ? Math.sqrt(sum2 / nAct) : 0;
const mean = nAct ? sum / nAct : 0;
const varr = nAct ? Math.max(1e-24, sum2 / nAct - mean * mean) : 0;
const sd = Math.sqrt(varr);
const kurt = nAct ? (sum4 / nAct - 4 * mean * sum3 / nAct + 6 * mean * mean * sum2 / nAct - 3 * Math.pow(mean, 4)) / (varr * varr) : NaN;
const skew = nAct ? (sum3 / nAct - 3 * mean * sum2 / nAct + 2 * Math.pow(mean, 3)) / Math.pow(sd, 3) : NaN;
let corr = NaN;
if (nCorr > 2) {
const cov = sLR / nCorr - (sL / nCorr) * (sR / nCorr);
const vl = sLL / nCorr - Math.pow(sL / nCorr, 2), vr = sRR / nCorr - Math.pow(sR / nCorr, 2);
if (vl > 1e-20 && vr > 1e-20) corr = cov / Math.sqrt(vl * vr);
}
return {
spectra: s.spectra, avg: s.avg, cols: s.cols, half: s.half, hop: s.hop, fftSize: s.fftSize, window: s.window,
hist: hist, histN: nAct, peaks: { min: peaksMin, max: peaksMax },
M: M, S: S, TP: Float32Array.from(tpBlocks), subSec: sub / sr,
peak: peak, truePeak: Math.max(tp, peak), rms: rms, dc: mean,
kurt: kurt, skew: skew, corr: corr, clipped: clipped, I: I, LRA: LRA,
activeFrames: nAct / ch, sr: sr, ch: ch
};
}
};
}
function wavHeader(sr, ch, bits, dataSize) {
const bps = bits === 16 ? 2 : (bits === 24 ? 3 : 4);
const ext = ch > 2;
const extra = ext ? 24 : 0;
const ab = new ArrayBuffer(44 + extra);
const dv = new DataView(ab);
let p = 0;
const ws = function (t) { for (let i = 0; i < t.length; i++) dv.setUint8(p++, t.charCodeAt(i)); };
ws('RIFF'); dv.setUint32(p, 36 + extra + dataSize, true); p += 4;
ws('WAVE'); ws('fmt '); dv.setUint32(p, ext ? 40 : 16, true); p += 4;
dv.setUint16(p, ext ? 0xFFFE : (bits === 32 ? 3 : 1), true); p += 2;
dv.setUint16(p, ch, true); p += 2;
dv.setUint32(p, sr, true); p += 4;
dv.setUint32(p, sr * ch * bps, true); p += 4;
dv.setUint16(p, ch * bps, true); p += 2;
dv.setUint16(p, bps * 8, true); p += 2;
if (ext) {
dv.setUint16(p, 22, true); p += 2;
dv.setUint16(p, bits, true); p += 2;
dv.setUint32(p, ch === 6 ? 0x3F : (ch === 8 ? 0x63F : 0), true); p += 4;
dv.setUint16(p, bits === 32 ? 3 : 1, true); p += 2;
dv.setUint16(p, 0, true); p += 2;
dv.setUint32(p, 0x00100000, true); p += 4;
dv.setUint32(p, 0x0000AA00, true); p += 4;
dv.setUint32(p, 0x719B3800, true); p += 4;
}
ws('data'); dv.setUint32(p, dataSize, true);
return new Uint8Array(ab);
}
function readSlice(blob, a, b) {
const s = blob.slice(a, b);
if (typeof s.arrayBuffer === 'function') return s.arrayBuffer();
if (typeof FileReaderSync === 'function') { try { return Promise.resolve(new FileReaderSync().readAsArrayBuffer(s)); } catch (e) {} }
return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(new Error('slice')); }; fr.readAsArrayBuffer(s); });
}
function quantWriter(bits, dither, r) {
if (bits === 16) {
if (dither) return function (dv, p, v) {
const d = (r() - r()) / 32768;
let q = Math.round((v + d) * 32767);
if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
dv.setInt16(p, q, true);
};
return function (dv, p, v) { let q = Math.round(clamp(v, -1, 1) * 32767); if (q < -32768) q = -32768; dv.setInt16(p, q, true); };
}
if (bits === 24) return function (dv, p, v) {
let q = Math.round(clamp(v, -1, 1) * 8388607);
if (q > 8388607) q = 8388607; else if (q < -8388608) q = -8388608;
dv.setUint8(p, q & 255); dv.setUint8(p + 1, (q >> 8) & 255); dv.setUint8(p + 2, (q >> 16) & 255);
};
return function (dv, p, v) { dv.setFloat32(p, clamp(v, -1, 1), true); };
}
async function quantize(master, sr, ch, bits, dither, gain, hooks, from, to) {
const bps = bits === 16 ? 2 : (bits === 24 ? 3 : 4);
const total = Math.floor(master.size / (ch * 4));
const parts = [wavHeader(sr, ch, bits, total * ch * bps)];
const r = rng(0x5eed1234);
const w = quantWriter(bits, dither && bits === 16, r);
const framesPer = Math.max(1024, Math.floor(262144 / (ch * 4)));
let frame = 0, t0 = Date.now();
while (frame < total) {
const n = Math.min(framesPer, total - frame);
const ab = await readSlice(master, frame * ch * 4, (frame + n) * ch * 4);
const src = new Float32Array(ab);
const out = new ArrayBuffer(n * ch * bps);
const dv = new DataView(out);
let p = 0;
for (let i = 0; i < n * ch; i++) { w(dv, p, src[i] * gain); p += bps; }
parts.push(new Uint8Array(out));
frame += n;
if (Date.now() - t0 > 40) {
hooks.progress(from + (to - from) * frame / total, 'Квантование ' + bits + ' бит');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
t0 = Date.now();
}
}
const blob = new Blob(parts, { type: 'audio/wav' });
parts.length = 0;
return blob;
}
async function fillChunked(gen, arr, hooks, from, to, label) {
const CH = 65536;
let pos = 0, t0 = Date.now();
while (pos < arr.length) {
const n = Math.min(CH, arr.length - pos);
gen(arr.subarray(pos, pos + n), n);
pos += n;
if (Date.now() - t0 > 30) {
hooks.progress(from + (to - from) * pos / arr.length, label);
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
t0 = Date.now();
}
}
}
function percArrays(kind, sr, seed) {
const r = rng(seed);
if (kind === 'kick') {
const n = Math.max(1, Math.floor(sr * 0.45)), out = new Float32Array(n);
const f0 = 130 + r() * 40, f1 = 44 + r() * 8;
let ph = 0;
for (let i = 0; i < n; i++) {
const t = i / n, f = f1 + (f0 - f1) * Math.exp(-t * 26);
ph += 2 * Math.PI * f / sr; if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
const e = Math.exp(-t * 6.5) * (1 - Math.exp(-t * 400));
out[i] = Math.tanh((Math.sin(ph) * e + (r() * 2 - 1) * Math.exp(-t * 220) * 0.25) * 1.4) * 0.9;
}
return out;
}
if (kind === 'snare') {
const n = Math.max(1, Math.floor(sr * 0.3)), out = new Float32Array(n);
const bp = bqNew('bp', 1900 + r() * 300, 0.8, 0, sr), hp = bqNew('hp', 500, 0.7, 0, sr);
const f1 = 175 + r() * 20, f2 = 330 + r() * 30;
let p1 = 0, p2 = 0;
for (let i = 0; i < n; i++) {
const t = i / n;
const nz = bqRun(hp, bqRun(bp, r() * 2 - 1)) * Math.exp(-t * 17);
p1 += 2 * Math.PI * f1 / sr; p2 += 2 * Math.PI * f2 / sr;
out[i] = (nz * 0.85 + (Math.sin(p1) * 0.6 + Math.sin(p2) * 0.35) * Math.exp(-t * 30) * 0.5) * (1 - Math.exp(-t * 600));
}
return out;
}
const n = Math.max(1, Math.floor(sr * 0.11)), out = new Float32Array(n);
const hp = bqNew('hp', 7000 + r() * 1500, 0.7, 0, sr), bp = bqNew('bp', 10000 + r() * 2000, 1.1, 0, sr);
const dec = 42 + r() * 16;
for (let i = 0; i < n; i++) { const t = i / n; out[i] = bqRun(bp, bqRun(hp, r() * 2 - 1)) * Math.exp(-t * dec) * (1 - Math.exp(-t * 900)); }
return out;
}
async function surroundArrays(spec, hooks) {
const sr = spec.sr, n = Math.max(1, Math.round(sr * spec.dur));
const ch = spec.kind === 'sur51' ? 6 : 8;
const lvl = Math.pow(10, spec.level / 20);
const out = [];
for (let c = 0; c < ch; c++) out.push(new Float32Array(n));
if (spec.kind === 'surid') {
const freqs = [440, 550, 660, 90, 880, 990, 1100, 1320];
const seg = Math.max(1, Math.floor(n / ch));
const fade = Math.max(1, Math.min(Math.round(sr * 0.02), seg >> 3));
let t0 = Date.now();
for (let c = 0; c < ch; c++) {
const d = out[c], f = freqs[c];
for (let j = 0; j < seg; j++) {
const i = c * seg + j;
if (i >= n) break;
let g = 1;
if (j < fade) g = j / fade;
if (j >= seg - fade) g = (seg - 1 - j) / fade;
d[i] = Math.sin(2 * Math.PI * f * j / sr) * lvl * g;
}
if (Date.now() - t0 > 30) { hooks.progress(0.02 + 0.06 * c / ch, 'Генерация обхода каналов'); await hooks.tick(); if (hooks.cancelled()) throw new Error('cancelled'); t0 = Date.now(); }
}
return out;
}
for (let c = 0; c < ch; c++) {
await fillChunked(noiseGen('pink', sr, (spec.seed + c * 7919) >>> 0, {}), out[c], hooks, 0.02 + 0.06 * c / ch, 0.02 + 0.06 * (c + 1) / ch, 'Генерация каналов');
if (c === 3) {
const lp1 = bqNew('lp', 120, 0.7, 0, sr), lp2 = bqNew('lp', 120, 0.7, 0, sr);
const d = out[c];
for (let i = 0; i < n; i++) d[i] = bqRun(lp2, bqRun(lp1, d[i]));
}
const d = out[c];
let s = 0; for (let i = 0; i < n; i++) s += d[i] * d[i];
const rms = Math.sqrt(s / n);
const g = rms > 1e-9 ? lvl / Math.SQRT2 / rms : 1;
for (let i = 0; i < n; i++) d[i] *= g;
}
return out;
}
async function signalArrays(spec, hooks) {
const sr = spec.sr, dur = spec.dur, n = Math.max(1, Math.round(sr * dur));
const kind = spec.kind, lvl = Math.pow(10, spec.level / 20);
if (kind === 'sur51' || kind === 'sur71' || kind === 'surid') return await surroundArrays(spec, hooks);
const L = new Float32Array(n), R = new Float32Array(n);
const useL = spec.chan !== 'r', useR = spec.chan !== 'l';
const fade = Math.max(1, Math.min(Math.round(sr * 0.02), n >> 2));
function env(i) { let g = 1; if (i < fade) g *= i / fade; if (i >= n - fade) g *= (n - 1 - i) / fade; return g; }
const CH = 32768;
let t0 = Date.now();
async function loop(fn, label) {
let i = 0;
while (i < n) {
const e = Math.min(n, i + CH);
fn(i, e);
i = e;
if (Date.now() - t0 > 30) { hooks.progress(0.02 + 0.06 * i / n, label); await hooks.tick(); if (hooks.cancelled()) throw new Error('cancelled'); t0 = Date.now(); }
}
}
if (kind === 'sweep') {
const f1 = 20, f2 = Math.min(20000, sr * 0.47), k = Math.log(f2 / f1);
await loop(function (a, b) {
for (let i = a; i < b; i++) { const t = i / sr; const ph = 2 * Math.PI * f1 * dur / k * (Math.exp(k * t / dur) - 1); const v = Math.sin(ph) * lvl * env(i); if (useL) L[i] = v; if (useR) R[i] = v; }
}, 'Генерация свипа');
} else if (kind === 'steps') {
const bands = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000].filter(function (f) { return f < sr * 0.47; });
const seg = Math.max(1, Math.floor(n / bands.length));
for (let b = 0; b < bands.length; b++) {
const f = bands[b], sf = Math.max(1, Math.min(Math.round(sr * 0.01), seg >> 3));
for (let j = 0; j < seg; j++) {
let g = 1; if (j < sf) g = j / sf; if (j >= seg - sf) g = (seg - 1 - j) / sf;
const v = Math.sin(2 * Math.PI * f * j / sr) * lvl * g;
const i = b * seg + j;
if (i < n) { if (useL) L[i] = v; if (useR) R[i] = v; }
}
if (Date.now() - t0 > 30) { hooks.progress(0.02 + 0.06 * b / bands.length, 'Генерация ступеней'); await hooks.tick(); if (hooks.cancelled()) throw new Error('cancelled'); t0 = Date.now(); }
}
} else if (kind === 'tone') {
await loop(function (a, b) {
for (let i = a; i < b; i++) { const v = Math.sin(2 * Math.PI * 1000 * i / sr) * lvl * env(i); if (useL) L[i] = v; if (useR) R[i] = v; }
}, 'Генерация тона');
} else if (kind === 'pinkband') {
const h = firDesign(2048, sr, magFor('pinkband', 0, sr, null));
await fillChunked(firGen(h, rng(spec.seed), false), L, hooks, 0.02, 0.05, 'Генерация полосового шума');
await fillChunked(firGen(h, rng((spec.seed + 7717) >>> 0), false), R, hooks, 0.05, 0.08, 'Генерация полосового шума');
let pk = 0;
for (let i = 0; i < n; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > pk) pk = a; }
const k = pk > 1e-9 ? lvl / pk : 1;
for (let i = 0; i < n; i++) { L[i] = useL ? L[i] * k * env(i) : 0; R[i] = useR ? R[i] * k * env(i) : 0; }
} else if (kind === 'polarity') {
const period = Math.max(1, Math.round(sr * 0.35));
const burst = Math.max(1, Math.round(sr * 0.12));
const f = 200;
await loop(function (a, b) {
for (let i = a; i < b; i++) {
const j = i % period;
let v = 0;
if (j < burst) {
const t = j / sr;
const e = Math.sin(Math.PI * j / burst);
v = Math.max(0, Math.sin(2 * Math.PI * f * t)) * lvl * 1.6 * e;
}
if (useL) L[i] = v; if (useR) R[i] = v;
}
}, 'Генерация импульсов');
} else if (kind === 'channels') {
const seg = Math.max(1, Math.floor(n / 6));
for (let s = 0; s < 6; s++) {
const mode = s % 3, f = mode === 1 ? 880 : 440;
const sf = Math.max(1, Math.min(Math.round(sr * 0.02), seg >> 3));
for (let j = 0; j < seg; j++) {
let g = 1; if (j < sf) g = j / sf; if (j >= seg - sf) g = (seg - 1 - j) / sf;
const i = s * seg + j;
if (i >= n) continue;
const v = Math.sin(2 * Math.PI * f * j / sr) * lvl * g;
if (mode === 0) L[i] = v;
else if (mode === 1) R[i] = v;
else { L[i] = v; R[i] = Math.sin(2 * Math.PI * 880 * j / sr) * lvl * g; }
}
}
} else if (kind === 'phase') {
const seg = Math.max(1, Math.round(sr * 0.9));
const xf = Math.max(1, Math.round(sr * 0.03));
await loop(function (a, b) {
for (let i = a; i < b; i++) {
const block = Math.floor(i / seg);
const j = i % seg;
let sign = block % 2 === 0 ? 1 : -1;
if (j < xf) sign *= j / xf;
else if (j >= seg - xf) sign *= (seg - 1 - j) / xf;
const v = Math.sin(2 * Math.PI * 440 * i / sr) * lvl * env(i);
L[i] = v; R[i] = v * sign;
}
}, 'Генерация фазового теста');
} else {
const f = sr / 4, amp = Math.pow(10, -0.1 / 20) / Math.SQRT1_2;
await loop(function (a, b) {
for (let i = a; i < b; i++) { const v = Math.sin(2 * Math.PI * f * i / sr + Math.PI / 4) * amp * env(i); if (useL) L[i] = v; if (useR) R[i] = v; }
}, 'Генерация выброса');
}
return [L, R];
}
async function calibArrays(spec, hooks) {
const sr = spec.sr, n = Math.max(1, Math.round(sr * spec.dur));
const arr = [new Float32Array(n), new Float32Array(n)];
if (spec.band === 'speech') {
const h = firDesign(2048, sr, magFor('pinkband', 0, sr, null));
await fillChunked(firGen(h, rng(spec.seed), false), arr[0], hooks, 0.02, 0.05, 'Генерация калибровки');
await fillChunked(firGen(h, rng((spec.seed + 7717) >>> 0), false), arr[1], hooks, 0.05, 0.08, 'Генерация калибровки');
} else {
await fillChunked(noiseGen('pink', sr, spec.seed, {}), arr[0], hooks, 0.02, 0.05, 'Генерация калибровки');
await fillChunked(noiseGen('pink', sr, (spec.seed + 7717) >>> 0, {}), arr[1], hooks, 0.05, 0.08, 'Генерация калибровки');
}
for (let c = 0; c < 2; c++) {
const on = spec.chan === 'both' || (spec.chan === 'l' && c === 0) || (spec.chan === 'r' && c === 1);
const d = arr[c];
if (!on) { d.fill(0); continue; }
let s = 0; for (let i = 0; i < n; i++) s += d[i] * d[i];
const rms = Math.sqrt(s / n);
const g = rms > 1e-9 ? Math.pow(10, -20 / 20) / rms : 1;
for (let i = 0; i < n; i++) d[i] *= g;
}
return arr;
}
async function ditherArrays(useDither, sr, hooks) {
const n = sr * 5, out = new Float32Array(n);
const amp = Math.pow(10, -90 / 20);
const r = rng(useDither ? 424242 : 171717);
let pk = 0, t0 = Date.now();
for (let i = 0; i < n; i++) {
let v = amp * Math.sin(2 * Math.PI * 440 * i / sr);
if (useDither) v += (r() - r()) / 32768;
let q = Math.round(v * 32767);
if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
const s = q / 32767;
out[i] = s;
const a = s < 0 ? -s : s;
if (a > pk) pk = a;
if ((i & 65535) === 65535 && Date.now() - t0 > 30) { hooks.progress(0.02 + 0.06 * i / n, 'Генерация тона'); await hooks.tick(); if (hooks.cancelled()) throw new Error('cancelled'); t0 = Date.now(); }
}
const g = pk > 1e-12 ? Math.pow(10, -3 / 20) / pk : 1;
for (let i = 0; i < n; i++) out[i] *= g;
return { arr: out, boostDb: 20 * Math.log10(Math.max(g, 1e-12)) };
}
async function buildArrays(spec, hooks) {
if (spec.source === 'arrays') return spec.arrays;
if (spec.source === 'signal') return await signalArrays(spec, hooks);
if (spec.source === 'calib') return await calibArrays(spec, hooks);
if (spec.source === 'perc') {
hooks.progress(0.04, 'Генерация удара');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
const a = percArrays(spec.percType, spec.sr, spec.seed);
let pk = 0; for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > pk) pk = v; }
const g = pk > 1e-9 ? Math.pow(10, -1 / 20) / pk : 1;
for (let i = 0; i < a.length; i++) a[i] *= g;
return [a];
}
if (spec.source === 'dither') {
const d = await ditherArrays(spec.tpdf, spec.sr, hooks);
spec.boostDb = d.boostDb;
return [d.arr];
}
throw new Error('Неизвестный источник');
}
async function render(spec, hooks) {
const sr = spec.sr;
let arrays = null, gens = null, srcArrays = null;
if (spec.source !== 'gen') arrays = await buildArrays(spec, hooks);
if (spec.kind === 'match' || spec.kind === 'granular') { srcArrays = arrays; arrays = null; }
const ch = spec.channels;
const body = arrays ? arrays[0].length : spec.bodyFrames;
const canLoop = spec.source === 'gen' || spec.kind === 'match' || spec.kind === 'granular';
const loop = !!spec.loop && canLoop;
const padA = loop ? 0 : (spec.padA || 0), padB = loop ? 0 : (spec.padB || 0);
const total = padA + body + padB;
const fi = loop ? 0 : Math.min(body, spec.fadeIn || 0), fo = loop ? 0 : Math.min(body, spec.fadeOut || 0);
const loopFade = loop ? Math.max(1, Math.min(Math.floor(sr * 0.25), body >> 2)) : 0;
const CH = 16384;
const bufs = []; for (let c = 0; c < ch; c++) bufs.push(new Float32Array(CH));
if (!arrays) {
gens = [];
let matchAvg = null;
if (spec.kind === 'match' && srcArrays && srcArrays.length) {
hooks.progress(0.09, 'Замер спектра записи');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
matchAvg = measureSpectrum(srcArrays[0], sr, 8192, 'hann');
}
for (let c = 0; c < ch; c++) {
const sd = (spec.seed + c * 1013904223) >>> 0;
if (spec.kind === 'synth') gens.push(synthGen(spec.synthType, sr, sd, spec.drift, spec.alpha));
else if (spec.kind === 'granular' && srcArrays && srcArrays.length) gens.push(granularGen(srcArrays[Math.min(c, srcArrays.length - 1)], sr, sd, spec.grain || 90));
else if (spec.kind === 'match' && matchAvg) gens.push(firGen(firDesign(spec.taps || 4096, sr, magFor('match', spec.tilt, sr, matchAvg)), rng(sd), spec.dist === 'gauss'));
else if (spec.exact || spec.kind === 'curve') {
const mag = magFor(spec.kind === 'curve' ? 'curve' : spec.type, spec.tilt, sr, spec.curve);
gens.push(firGen(firDesign(spec.taps || 4096, sr, mag), rng(sd), spec.dist === 'gauss'));
} else gens.push(noiseGen(spec.type, sr, sd, { tilt: spec.tilt, dist: spec.dist }));
}
}
const rev = spec.reverb ? reverbNew(sr, ch, spec.reverbPreset, (spec.reverbWet === undefined ? 30 : spec.reverbWet) / 100) : null;
const an = makeAnalyzer(sr, ch, total, { fftSize: spec.fftSize, window: spec.window, cols: 480, buckets: 1600, activeStart: padA, activeEnd: padA + body });
const parts = [];
const head = [], tail = [];
if (loop) for (let c = 0; c < ch; c++) { head.push(new Float32Array(loopFade)); tail.push(new Float32Array(loopFade)); }
let pos = 0, t0 = Date.now();
hooks.progress(0.11, 'Генерация и измерения');
while (pos < total) {
let limit = total;
if (pos < padA) limit = padA; else if (pos < padA + body) limit = padA + body;
const n = Math.min(CH, limit - pos);
const inBody = pos >= padA && pos < padA + body;
if (inBody) {
const bi = pos - padA;
if (arrays) { for (let c = 0; c < ch; c++) { const a = arrays[c]; for (let i = 0; i < n; i++) bufs[c][i] = a[bi + i] || 0; } }
else { for (let c = 0; c < ch; c++) gens[c](bufs[c], n); }
if (rev) rev.process(bufs, n);
for (let i = 0; i < n; i++) {
const idx = bi + i;
let g = 1;
if (fi > 0 && idx < fi) g *= idx / fi;
if (fo > 0 && idx >= body - fo) g *= (body - 1 - idx) / fo;
for (let c = 0; c < ch; c++) {
const v = bufs[c][i] * g;
bufs[c][i] = v;
if (loop && idx < loopFade) head[c][idx] = v;
}
}
} else for (let c = 0; c < ch; c++) bufs[c].fill(0, 0, n);
an.feed(bufs, n, pos);
const ab = new ArrayBuffer(n * ch * 4);
const f = new Float32Array(ab);
let k = 0;
for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) f[k++] = bufs[c][i];
parts.push(new Uint8Array(ab));
pos += n;
if (Date.now() - t0 > 40) {
hooks.progress(0.11 + 0.49 * pos / total, 'Генерация и измерения');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
t0 = Date.now();
}
}
if (loop) {
let done = 0;
while (done < loopFade) {
const n = Math.min(CH, loopFade - done);
for (let c = 0; c < ch; c++) {
gens[c](bufs[c], n);
for (let i = 0; i < n; i++) tail[c][done + i] = bufs[c][i];
}
if (rev) rev.process(bufs, n);
done += n;
}
}
const res = an.finish();
let master = new Blob(parts, { type: 'application/octet-stream' });
parts.length = 0;
if (loop) {
const blended = [];
let bpk = 0, btp = 0;
for (let c = 0; c < ch; c++) {
const b = new Float32Array(loopFade);
for (let i = 0; i < loopFade; i++) {
const t = i / loopFade;
b[i] = head[c][i] * Math.sqrt(t) + tail[c][i] * Math.sqrt(1 - t);
const a = b[i] < 0 ? -b[i] : b[i];
if (a > bpk) bpk = a;
}
const t2 = truePeakOf(b);
if (t2 > btp) btp = t2;
blended.push(b);
}
if (bpk > res.peak) res.peak = bpk;
if (btp > res.truePeak) res.truePeak = btp;
const inter = new Float32Array(loopFade * ch);
for (let i = 0; i < loopFade; i++) for (let c = 0; c < ch; c++) inter[i * ch + c] = blended[c][i];
master = new Blob([new Uint8Array(inter.buffer), master.slice(loopFade * ch * 4)], { type: 'application/octet-stream' });
}
let gain = 1, limited = false;
const ceil = Math.pow(10, -0.1 / 20);
if (spec.norm === 'rms') { if (res.rms > 1e-9) gain = Math.pow(10, spec.target / 20) / res.rms; }
else if (spec.norm === 'lufs') { if (isFinite(res.I)) gain = Math.pow(10, (spec.target - res.I) / 20); else if (res.rms > 1e-9) gain = Math.pow(10, spec.target / 20) / res.rms; }
else if (spec.norm === 'truepeak') { if (res.truePeak > 1e-9) gain = Math.pow(10, spec.target / 20) / res.truePeak; }
else if (spec.norm === 'peak') { if (res.peak > 1e-9) gain = Math.pow(10, spec.target / 20) / res.peak; }
if ((spec.norm === 'rms' || spec.norm === 'lufs') && res.truePeak * gain > ceil && res.truePeak > 1e-9) { gain = ceil / res.truePeak; limited = true; }
res.master = master;
res.gain = gain; res.limited = limited;
res.duration = total / sr; res.sr = sr; res.ch = ch;
res.boostDb = spec.boostDb || 0;
const forceBits = spec.source === 'dither' ? 16 : spec.bits;
const forceDither = spec.source === 'dither' ? false : spec.dither;
hooks.progress(0.64, 'Квантование');
res.wav = await quantize(master, sr, ch, forceBits, forceDither, gain, hooks, 0.64, 1);
res.bits = forceBits;
return res;
}
async function requantize(spec, hooks) {
const blob = await quantize(spec.master, spec.sr, spec.ch, spec.bits, spec.dither, spec.gain, hooks, 0.05, 1);
return { wav: blob, bits: spec.bits };
}
async function respectrum(spec, hooks) {
const sr = spec.sr, ch = spec.ch;
const total = Math.floor(spec.master.size / (ch * 4));
const sp = spectralCore(sr, total, spec.fftSize, spec.window, 480);
const framesPer = Math.max(1024, Math.floor(131072 / ch));
const c0 = new Float32Array(framesPer);
let pos = 0, t0 = Date.now();
hooks.progress(0.02, 'Пересчёт спектра');
while (pos < total) {
const n = Math.min(framesPer, total - pos);
const ab = await readSlice(spec.master, pos * ch * 4, (pos + n) * ch * 4);
const f = new Float32Array(ab);
for (let i = 0; i < n; i++) c0[i] = f[i * ch];
sp.feed(c0, n, pos);
pos += n;
if (Date.now() - t0 > 40) {
hooks.progress(0.02 + 0.95 * pos / total, 'Пересчёт спектра');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
t0 = Date.now();
}
}
return sp.finish();
}
return { render: render, requantize: requantize, respectrum: respectrum, noiseGen: noiseGen, rng: rng, gauss: gauss, clamp: clamp, bqSet: bqSet, bqNew: bqNew, bqRun: bqRun, firDesign: firDesign, firGen: firGen, magFor: magFor, reverbNew: reverbNew };
}

const $ = function (id) { return document.getElementById(id); };
const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
const DSP = dspCore();
const TYPES = ['white', 'pink', 'brown', 'blue', 'violet', 'green', 'grey'];
const LABELS = { white: 'Белый', pink: 'Розовый', brown: 'Коричневый', blue: 'Синий', violet: 'Фиолетовый', green: 'Зелёный', grey: 'Серый' };
const COLORS = { white: '#e8e2da', pink: '#dba9a3', brown: '#8f6b47', blue: '#7d8fa8', violet: '#9b7fa8', green: '#88a383', grey: '#8a8278' };
const THIRD = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
const SIZE_LIMIT = 340 * 1024 * 1024;
const STORE = 'wnl.v10';
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const NORM_DEF = { peak: -1, truepeak: -1, rms: -20, lufs: -16, none: -1 };
const NORM_UNIT = { peak: 'dBFS', truepeak: 'dBTP', rms: 'dBFS', lufs: 'LUFS', none: '—' };
const NORM_NOTE = {
peak: 'Выравнивает самый громкий отсчёт. Межвыборочные выбросы не учитываются',
truepeak: 'Истинный пик по четырёхкратной передискретизации: учитывает выбросы между отсчётами, которые клипуют ЦАП',
rms: 'Выравнивает среднюю мощность активного участка — все виды шума звучат одинаково громко',
lufs: 'Интегральная громкость: взвешивание по слуху, блоки 400 мс, отсечение тихих участков',
none: 'Уровень не меняется. Клиппинг, если он появится, будет показан в отчёте'
};
const SIG_NOTE = {
sweep: 'Логарифмический свип с фейдами по 20 мс',
steps: 'Третьоктавные ступени от 25 Гц до 20 кГц, каждая со своими микрофейдами',
tone: 'Опорный тон 1 кГц',
pinkband: 'Розовый шум в полосе 500 Гц – 2 кГц, нормирован по пиковому уровню. Пригоден для настройки речевого тракта',
polarity: 'Пачки только положительных полуволн 200 Гц. На волне видно, что сигнал несимметричен: переворот полярности меняет форму вверх ногами',
channels: 'Шесть сегментов: L 440 Гц, R 880 Гц, оба, и повтор. Проверка распайки и баланса',
phase: 'Чередование синфазы и противофазы каждые 0,9 с. В противофазе звук растекается по сторонам и почти исчезает при сведении в моно',
isp: 'Синус на четверти частоты дискретизации со сдвигом 45°: отсчёты −0,1 dBFS, истинный пик около +2,9 dBTP. Уровень здесь не используется',
sur51: 'Шесть независимых каналов: FL, FR, FC, LFE, BL, BR. LFE ограничен 120 Гц. Порядок и маска каналов прописаны в WAV, MP3 для такого файла недоступен',
sur71: 'Восемь независимых каналов: FL, FR, FC, LFE, BL, BR, SL, SR. Каждый со своим seed, поэтому каналы полностью декоррелированы',
surid: 'Поочерёдный обход восьми каналов 7.1: FL 440, FR 550, FC 660, LFE 90, BL 880, BR 990, SL 1100, SR 1320 Гц. Проверка распайки surround-системы'
};
const OWN_NOTE = {
asis: 'Исходная запись без изменений, доступны только огибающая, уровень и пространство',
match: 'Замеряется усреднённый спектр записи и синтезируется стационарный шум с той же АЧХ. Тембр помещения остаётся, события исчезают',
granular: 'Запись режется на зёрна и собирается заново со случайными сдвигами и скоростью. Фактура остаётся живой, но перестаёт повторяться'
};

const state = {
mode: 'generate', type: 'pink', mixType: 'pink', testType: 'pink', liveType: 'pink',
tilt: 0, duration: 60, sampleRate: 44100, bitDepth: 24, dither: true, channels: 2, dist: 'uniform',
norm: 'truepeak', target: -1, exact: false,
fadeIn: 0, fadeOut: 0, padStart: 0, padEnd: 0, loop: false,
reverb: false, reverbPreset: 'hall', reverbWet: 30,
liveReverb: false, liveReverbPreset: 'hall', liveReverbWet: 30,
seed: 12345, seedAuto: true, snr: -20, keepLevel: true, mixFile: null,
labTool: 'notch', notchFreq: 1000, notchQ: 8, binBase: 200, binBeat: 6, rot8dSpeed: 4,
notchTimer: 0, binTimer: 0,
liveTilt: 0, liveDrift: 25, liveLevel: -18,
curveDur: 20, curveTaps: 4096,
signalKind: 'sweep', signalDur: 20, signalLevel: -12, signalChan: 'both',
calibDur: 30, calibBand: 'full', calibChan: 'both',
synthType: 'wind', synthDur: 30, synthAlpha: 0.6, synthDrift: 35, percType: 'snare',
ownMode: 'asis', ownDur: 60, ownGrain: 90, ownTaps: 4096,
ownFadeIn: 0, ownFadeOut: 0, ownPadA: 0, ownPadB: 0, ownTilt: 0,
ownNorm: 'truepeak', ownTarget: -1, ownReverb: false, ownPreset: 'hall', ownWet: 30, ownLoop: false,
fftSize: 8192, window: 'hann', freqScale: 'log', specTop: -20, specRange: 80,
volume: 80, view: 'wave', dlBits: 24, mp3Rate: 192,
busy: false, cancelled: false, analysis: null, master: null, gain: 1, meta: null,
duration_s: 0, sr: 44100, ch: 2, key: 'noise', bits: 24, wav: null, url: null,
seeking: false, tooBig: false, fftPending: false
};
const curveData = new Float32Array(400);
curveData.fill(0.5);
const SAVE_KEYS = ['mode','type','mixType','testType','liveType','tilt','duration','sampleRate','bitDepth','dither','channels','dist','norm','target','exact','fadeIn','fadeOut','padStart','padEnd','loop','reverb','reverbPreset','reverbWet','liveReverb','liveReverbPreset','liveReverbWet','seed','seedAuto','snr','keepLevel','labTool','notchFreq','notchQ','binBase','binBeat','rot8dSpeed','notchTimer','binTimer','liveTilt','liveDrift','liveLevel','curveDur','curveTaps','signalKind','signalDur','signalLevel','signalChan','calibDur','calibBand','calibChan','synthType','synthDur','synthAlpha','synthDrift','percType','ownMode','ownDur','ownGrain','ownTaps','ownFadeIn','ownFadeOut','ownPadA','ownPadB','ownTilt','ownNorm','ownTarget','ownReverb','ownPreset','ownWet','ownLoop','fftSize','window','freqScale','specTop','specRange','volume','view','dlBits','mp3Rate'];

function load() {
try {
const raw = localStorage.getItem(STORE);
if (!raw) return;
const o = JSON.parse(raw);
Object.keys(o).forEach(function (k) { if (k !== 'curve' && k in state) state[k] = o[k]; });
if (Array.isArray(o.curve) && o.curve.length === curveData.length) for (let i = 0; i < o.curve.length; i++) curveData[i] = clamp(+o.curve[i] || 0, 0, 1);
if (TYPES.indexOf(state.type) < 0) state.type = 'pink';
if (TYPES.indexOf(state.mixType) < 0) state.mixType = 'pink';
if (TYPES.indexOf(state.testType) < 0) state.testType = 'pink';
if (TYPES.indexOf(state.liveType) < 0) state.liveType = 'pink';
} catch (e) {}
}
load();

let audioCtx = null, labSession = null;
let worker = null, workerOk = false, jobId = 0, pending = null;
let rafMeters = 0, resizeRaf = 0, progressTimer = null, progressP = 0, railW = 0;
let spectroImg = null, spectroDirty = true, curveLastIdx = -1, curveLastVal = 0.5, curveDrawing = false;
let ltasRows = [], artUrl = null;
let workletReady = false, workletTried = false;
let mp3Lib = null, mp3Promise = null;
const loopCache = new Map();
const live = { on: false, node: null, src: null, lfo: null, lfoGain: null, gain: null, an: null, data: null, raf: 0, watch: 0, kind: 'none' };
const knobs = {};
const waveView = { a: 0, b: 1, sa: -1, sb: -1 };
const own = { arrays: null, sr: 44100, ch: 1, name: '', rec: false, stream: null, node: null, sp: null, sink: null, chunks: null, frames: 0, timer: 0, t0: 0, meterT: 0, workletTried: false, workletOk: false };

const tick = (function () {
if (typeof MessageChannel === 'function') {
const c = new MessageChannel(), q = [];
c.port1.onmessage = function () { const r = q.shift(); if (r) r(); };
return function () { return new Promise(function (r) { q.push(r); c.port2.postMessage(0); }); };
}
return function () { return new Promise(function (r) { setTimeout(r, 0); }); };
})();

function save() {
try {
const o = {};
SAVE_KEYS.forEach(function (k) { o[k] = state[k]; });
o.curve = Array.from(curveData);
localStorage.setItem(STORE, JSON.stringify(o));
} catch (e) {}
}
function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
function fmtTimeMs(s) { if (!isFinite(s)) return '—'; const t = Math.max(0, s); const m = Math.floor(t / 60); const sec = t - m * 60; return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(2).replace('.', ','); }
function fmtSize(b) { if (b < 1024) return b + ' Б'; if (b < 1048576) return (b / 1024).toFixed(1).replace('.', ',') + ' КБ'; return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ'; }
function db(v, d) { if (!isFinite(v)) return '—'; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d === undefined ? 1 : d).replace('.', ','); }
function num(v, d) { if (!isFinite(v)) return '—'; return v.toFixed(d).replace('.', ','); }
function stamp() { const d = new Date(), p = function (v) { return (v < 10 ? '0' : '') + v; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes()); }
function friendly(e) {
const m = e && e.message ? e.message : String(e || '');
if (m === 'cancelled') return 'Отменено';
if (/allocat|memory|Array buffer/i.test(m)) return 'Не хватило памяти. Уменьшите длительность, частоту или битрейт';
return m || 'Неизвестная ошибка';
}
function gainDb() { return 20 * Math.log10(Math.max(state.gain, 1e-12)); }

const dock = $('progressDock'), sq = $('progressSquare');
function applyP() { sq.style.setProperty('--x', (railW * progressP).toFixed(1) + 'px'); sq.style.setProperty('--drift', railW.toFixed(1) + 'px'); dock.style.setProperty('--p', progressP.toFixed(4)); }
function measureRail() { railW = Math.max(0, $('progressTrack').clientWidth - 14); applyP(); }
function pSet(p, label) { if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; } dock.dataset.state = 'work'; progressP = clamp(p, 0, 1); applyP(); $('progressLabel').textContent = label; $('progressPercent').textContent = Math.round(progressP * 100) + '%'; }
function pBusy(label) { if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; } dock.dataset.state = 'busy'; $('progressLabel').textContent = label; $('progressPercent').textContent = ''; }
function pIdle() { dock.dataset.state = 'idle'; progressP = 0; applyP(); $('progressLabel').textContent = 'Готов к работе'; $('progressPercent').textContent = '0%'; progressTimer = null; }
function pHint(msg) { if (progressTimer) clearTimeout(progressTimer); dock.dataset.state = 'idle'; progressP = 0; applyP(); $('progressLabel').textContent = msg; $('progressPercent').textContent = ''; progressTimer = setTimeout(pIdle, 8000); }
function pDone(l) { if (progressTimer) clearTimeout(progressTimer); dock.dataset.state = 'done'; progressP = 1; applyP(); $('progressLabel').textContent = l; $('progressPercent').textContent = '100%'; progressTimer = setTimeout(pIdle, 2400); }
function pFail(m) { if (progressTimer) clearTimeout(progressTimer); dock.dataset.state = 'error'; $('progressLabel').textContent = m; $('progressPercent').textContent = ''; progressTimer = setTimeout(pIdle, 9000); }

function initWorker() {
if (typeof Worker !== 'function') return;
try {
const src = 'const DSP=(' + dspCore.toString() + ')();let cancel=false;const tick=function(){return new Promise(function(r){setTimeout(r,0);});};self.onmessage=async function(e){const d=e.data;if(d.cmd==="cancel"){cancel=true;return;}cancel=false;const hooks={progress:function(p,l){self.postMessage({t:"p",id:d.id,p:p,l:l});},tick:tick,cancelled:function(){return cancel;}};try{let r;if(d.cmd==="run")r=await DSP.render(d.spec,hooks);else if(d.cmd==="requant")r=await DSP.requantize(d.spec,hooks);else r=await DSP.respectrum(d.spec,hooks);const seen=new Set();const tr=[];const add=function(v){if(v&&v.buffer&&v.buffer instanceof ArrayBuffer&&!seen.has(v.buffer)){seen.add(v.buffer);tr.push(v.buffer);}};for(const k in r){const v=r[k];if(!v||typeof v!=="object"||v instanceof Blob)continue;if(v.buffer){add(v);}else if(!Array.isArray(v)){for(const j in v)add(v[j]);}}self.postMessage({t:"done",id:d.id,r:r},tr);}catch(err){self.postMessage({t:"err",id:d.id,m:err&&err.message?err.message:String(err)});}};';
worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
worker.onmessage = function (e) {
const d = e.data;
if (!pending || d.id !== pending.id) return;
if (d.t === 'p') pending.hooks.progress(d.p, d.l);
else if (d.t === 'done') { const p = pending; pending = null; p.resolve(d.r); }
else if (d.t === 'err') { const p = pending; pending = null; p.reject(new Error(d.m)); }
};
worker.onerror = function () {
workerOk = false;
if (pending) { const p = pending; pending = null; p.reject(new Error('worker-fallback')); }
};
workerOk = true;
} catch (e) { workerOk = false; }
}
async function runDsp(cmd, spec, hooks) {
if (workerOk && worker) {
try {
return await new Promise(function (resolve, reject) {
const id = ++jobId;
pending = { id: id, resolve: resolve, reject: reject, hooks: hooks };
const tr = [];
if (spec.arrays) spec.arrays.forEach(function (a) { try { tr.push(a.buffer); } catch (e) {} });
try { worker.postMessage({ cmd: cmd, id: id, spec: spec }, tr); }
catch (e) { pending = null; reject(e); }
});
} catch (e) {
if (e && e.message === 'cancelled') throw e;
workerOk = false;
}
}
const h = { progress: hooks.progress, tick: tick, cancelled: hooks.cancelled };
if (cmd === 'run') return DSP.render(spec, h);
if (cmd === 'requant') return DSP.requantize(spec, h);
return DSP.respectrum(spec, h);
}
function cancelJob() { state.cancelled = true; if (workerOk && worker && pending) worker.postMessage({ cmd: 'cancel' }); }

function loadScript(src) {
return new Promise(function (res, rej) {
const s = document.createElement('script');
s.src = src; s.async = true;
s.onload = function () { res(); };
s.onerror = function () { s.remove(); rej(new Error('load')); };
document.head.appendChild(s);
});
}
async function ensureMp3() {
if (mp3Lib) return mp3Lib;
if (window.lamejs && window.lamejs.Mp3Encoder) { mp3Lib = window.lamejs; return mp3Lib; }
if (!mp3Promise) {
mp3Promise = (async function () {
const urls = ['mp3-encoder.js', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js', 'https://unpkg.com/lamejs@1.2.1/lame.min.js'];
for (let i = 0; i < urls.length; i++) {
try { await loadScript(urls[i]); if (window.lamejs && window.lamejs.Mp3Encoder) { mp3Lib = window.lamejs; return mp3Lib; } } catch (e) {}
}
mp3Promise = null;
throw new Error('MP3 пока недоступен: положите файл mp3-encoder.js рядом с index.html или включите интернет. WAV работает всегда');
})();
}
return mp3Promise;
}
function toInt16(v) { const s = v > 1 ? 1 : (v < -1 ? -1 : v); return Math.round(s * 32767); }
async function readSliceMain(blob, a, b) {
const s = blob.slice(a, b);
if (typeof s.arrayBuffer === 'function') return s.arrayBuffer();
return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsArrayBuffer(s); });
}
async function encodeMp3(master, sr, ch, kbps, gain, hooks) {
if (ch > 2) throw new Error('MP3 поддерживает только моно и стерео. Сохраните такой результат в WAV');
const lib = await ensureMp3();
const outSr = MP3_RATES.indexOf(sr) >= 0 ? sr : 48000;
const ratio = outSr / sr;
const totalIn = Math.floor(master.size / (ch * 4));
const totalOut = Math.max(1, Math.round(totalIn * ratio));
const enc = new lib.Mp3Encoder(ch, outSr, kbps);
const parts = [];
const CH = 9216;
const L = new Int16Array(CH), R = new Int16Array(CH);
let out = 0, t0 = Date.now();
while (out < totalOut) {
const m = Math.min(CH, totalOut - out);
const i0 = Math.floor(out / ratio);
const i1 = Math.min(totalIn - 1, Math.floor((out + m - 1) / ratio) + 1);
const ab = await readSliceMain(master, i0 * ch * 4, (i1 + 1) * ch * 4);
const src = new Float32Array(ab);
const frames = Math.floor(src.length / ch);
for (let k = 0; k < m; k++) {
const p = (out + k) / ratio - i0;
const a = Math.floor(p), t = p - a;
const a0 = Math.min(a, frames - 1), a1 = Math.min(a + 1, frames - 1);
const v0 = src[a0 * ch] + (src[a1 * ch] - src[a0 * ch]) * t;
L[k] = toInt16(v0 * gain);
if (ch > 1) {
const v1 = src[a0 * ch + 1] + (src[a1 * ch + 1] - src[a0 * ch + 1]) * t;
R[k] = toInt16(v1 * gain);
}
}
const d = ch > 1 ? enc.encodeBuffer(L.subarray(0, m), R.subarray(0, m)) : enc.encodeBuffer(L.subarray(0, m));
if (d.length) parts.push(new Int8Array(d));
out += m;
if (Date.now() - t0 > 30) {
hooks.progress(0.1 + 0.88 * out / totalOut, 'Кодирование MP3');
await hooks.tick();
if (hooks.cancelled()) throw new Error('cancelled');
t0 = Date.now();
}
}
const fl = enc.flush();
if (fl.length) parts.push(new Int8Array(fl));
const blob = new Blob(parts, { type: 'audio/mpeg' });
parts.length = 0;
return { blob: blob, sr: outSr };
}

function showVisual(kind) {
$('waveform').style.display = kind === 'wave' ? 'block' : 'none';
$('spectroCanvas').classList.toggle('hidden', kind !== 'spectro');
$('welchCanvas').classList.toggle('hidden', kind !== 'welch');
$('histCanvas').classList.toggle('hidden', kind !== 'hist');
$('loudCanvas').classList.toggle('hidden', kind !== 'loud');
$('ltasWrap').classList.toggle('hidden', kind !== 'ltas');
$('curveCanvas').classList.toggle('hidden', kind !== 'curve');
$('emptyState').classList.toggle('hidden', kind !== 'empty');
$('cursorRead').classList.toggle('hidden', kind !== 'spectro' && kind !== 'welch');
$('waveControls').classList.toggle('hidden', kind !== 'wave');
$('plotControls').classList.toggle('hidden', kind !== 'spectro' && kind !== 'welch');
$('specLegend').classList.toggle('hidden', kind !== 'spectro');
$('welchControls').classList.toggle('hidden', kind !== 'welch');
$('ltasControls').classList.toggle('hidden', kind !== 'ltas');
}
function fit(canvas) {
const r = $('visualizer').getBoundingClientRect();
const dpr = Math.min(2, window.devicePixelRatio || 1);
const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
const cw = Math.max(1, Math.floor(w * dpr)), chh = Math.max(1, Math.floor(h * dpr));
if (canvas.width !== cw || canvas.height !== chh) { canvas.width = cw; canvas.height = chh; }
const c = canvas.getContext('2d');
c.setTransform(dpr, 0, 0, dpr, 0, 0);
return { c: c, w: w, h: h };
}
const HEAT = [[0, 16, 14, 12], [0.22, 58, 34, 22], [0.45, 140, 74, 32], [0.68, 193, 154, 107], [0.86, 232, 200, 140], [1, 250, 240, 220]];
function heat(v, o) {
v = clamp(v, 0, 1);
for (let i = 1; i < HEAT.length; i++) if (v <= HEAT[i][0]) { const a = HEAT[i - 1], b = HEAT[i], t = (v - a[0]) / (b[0] - a[0]); o[0] = a[1] + (b[1] - a[1]) * t; o[1] = a[2] + (b[2] - a[2]) * t; o[2] = a[3] + (b[3] - a[3]) * t; return; }
o[0] = 250; o[1] = 240; o[2] = 220;
}
const PAD = { l: 48, r: 14, t: 12, b: 24 };
function fMin() { return 20; }
function fMax() { return Math.min(20000, state.sr * 0.5); }
function freqNorm(f) { return state.freqScale === 'lin' ? clamp((f - fMin()) / (fMax() - fMin()), 0, 1) : clamp(Math.log(f / fMin()) / Math.log(fMax() / fMin()), 0, 1); }
function normFreq(t) { return state.freqScale === 'lin' ? fMin() + (fMax() - fMin()) * t : fMin() * Math.pow(fMax() / fMin(), t); }
function waveInfoUpdate() {
const el = $('waveInfo');
if (!state.analysis) { el.textContent = 'Нет результата'; return; }
const d = state.duration_s;
const span = (waveView.b - waveView.a) * d;
let t = 'Окно ' + fmtTimeMs(waveView.a * d) + ' – ' + fmtTimeMs(waveView.b * d) + ' · ' + num(span, 2) + ' с';
if (waveView.sa >= 0 && waveView.sb > waveView.sa) {
const a = state.analysis, B = a.peaks.min.length;
let pk = 0;
const i0 = clamp(Math.floor(waveView.sa * B), 0, B - 1), i1 = clamp(Math.ceil(waveView.sb * B), i0 + 1, B);
for (let i = i0; i < i1; i++) {
const lo = Math.abs(a.peaks.min[i]), hi = Math.abs(a.peaks.max[i]);
if (lo > pk) pk = lo;
if (hi > pk) pk = hi;
}
t += ' · выделение ' + num((waveView.sb - waveView.sa) * d, 2) + ' с · пик ' + db(20 * Math.log10(Math.max(pk * state.gain, 1e-12)), 1) + ' dBFS';
}
el.textContent = t;
}
function drawWave() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('wave');
const f = fit($('waveform')), c = f.c, w = f.w, h = f.h;
c.clearRect(0, 0, w, h);
const mn = a.peaks.min, mx = a.peaks.max, B = mn.length, g = state.gain;
const va = waveView.a, vb = waveView.b, span = Math.max(1e-6, vb - va);
if (waveView.sa >= 0 && waveView.sb > waveView.sa) {
const x0 = (waveView.sa - va) / span * w, x1 = (waveView.sb - va) / span * w;
const l = Math.max(0, Math.min(x0, x1)), r = Math.min(w, Math.max(x0, x1));
if (r > l) {
c.fillStyle = 'rgba(193,154,107,0.10)';
c.fillRect(l, 0, r - l, h);
c.strokeStyle = 'rgba(212,173,125,0.55)'; c.lineWidth = 1;
c.beginPath(); c.moveTo(l + .5, 0); c.lineTo(l + .5, h); c.moveTo(r - .5, 0); c.lineTo(r - .5, h); c.stroke();
}
}
c.strokeStyle = 'rgba(193,154,107,.85)'; c.lineWidth = 1; c.beginPath();
for (let x = 0; x < w; x++) {
const t0 = va + span * x / w, t1 = va + span * (x + 1) / w;
const s = clamp(Math.floor(t0 * B), 0, B - 1);
const e = clamp(Math.max(s + 1, Math.floor(t1 * B)), s + 1, B);
let lo = 0, hi = 0;
for (let i = s; i < e; i++) {
const l = mn[i], m = mx[i];
if (isFinite(l) && l < lo) lo = l;
if (isFinite(m) && m > hi) hi = m;
}
const y1 = h / 2 - hi * g * h / 2 * 0.92, y2 = h / 2 - lo * g * h / 2 * 0.92;
c.moveTo(x + .5, y1); c.lineTo(x + .5, Math.max(y2, y1 + .6));
}
c.stroke();
c.strokeStyle = 'rgba(192,112,95,.4)'; c.setLineDash([4, 4]); c.beginPath();
c.moveTo(0, h * 0.04); c.lineTo(w, h * 0.04); c.moveTo(0, h * 0.96); c.lineTo(w, h * 0.96); c.stroke(); c.setLineDash([]);
if (audioEl.duration > 0) {
const t = clamp(audioEl.currentTime / audioEl.duration, 0, 1);
if (t >= va && t <= vb) {
const x = (t - va) / span * w;
c.strokeStyle = '#e8c88c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
c.fillStyle = '#e8c88c'; c.beginPath(); c.moveTo(x - 4, 0); c.lineTo(x + 4, 0); c.lineTo(x, 6); c.fill();
}
}
c.fillStyle = 'rgba(107,97,86,.9)'; c.font = '10px system-ui,sans-serif';
c.fillText(fmtTimeMs(va * state.duration_s), 6, h - 8);
c.textAlign = 'right';
c.fillText(fmtTimeMs(vb * state.duration_s), w - 6, h - 8);
c.textAlign = 'left';
waveInfoUpdate();
}
function buildSpectro() {
const a = state.analysis;
if (!a) { spectroImg = null; return; }
const rows = 220, cols = a.cols, half = a.half, N = a.fftSize, sr = state.sr, lg = gainDb();
const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
const cx = cv.getContext('2d'), img = cx.createImageData(cols, rows), rgb = [0, 0, 0];
const top = state.specTop, range = state.specRange;
const map = new Int32Array(rows + 1);
for (let r = 0; r <= rows; r++) map[r] = clamp(Math.round(normFreq(r / rows) * N / sr), 0, half - 1);
for (let y = 0; y < rows; y++) {
const r = rows - 1 - y;
const k0 = map[r], k1 = Math.max(k0 + 1, map[r + 1]);
for (let x = 0; x < cols; x++) {
let p = 0; const b = x * half;
for (let k = k0; k < k1 && k < half; k++) p += a.spectra[b + k];
p /= (k1 - k0);
heat((10 * Math.log10(Math.max(p, 1e-20)) + lg - (top - range)) / range, rgb);
const o = (y * cols + x) * 4;
img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
}
}
cx.putImageData(img, 0, 0);
spectroImg = cv; spectroDirty = false;
}
function axesSpectro(c, w, h) {
const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
c.strokeStyle = 'rgba(61,53,46,.9)'; c.lineWidth = 1;
c.strokeRect(PAD.l + .5, PAD.t + .5, pw - 1, ph - 1);
c.font = '10px system-ui,sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
[25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(function (fq) {
if (fq < fMin() || fq > fMax()) return;
const y = PAD.t + ph * (1 - freqNorm(fq));
c.strokeStyle = 'rgba(20,18,16,.42)'; c.beginPath(); c.moveTo(PAD.l, y + .5); c.lineTo(PAD.l + pw, y + .5); c.stroke();
c.fillStyle = 'rgba(168,155,140,.85)'; c.fillText(fq >= 1000 ? (fq / 1000) + 'к' : String(fq), PAD.l - 6, y);
});
c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(168,155,140,.85)';
for (let i = 0; i <= 4; i++) c.fillText(fmtTime(state.duration_s * i / 4), clamp(PAD.l + pw * i / 4, PAD.l + 14, PAD.l + pw - 14), PAD.t + ph + 6);
c.textAlign = 'left'; c.fillStyle = 'rgba(107,97,86,.9)'; c.fillText('Гц', 6, PAD.t - 2);
}
function drawSpectro() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('spectro');
if (spectroDirty || !spectroImg) buildSpectro();
const f = fit($('spectroCanvas')), c = f.c;
c.clearRect(0, 0, f.w, f.h);
const pw = f.w - PAD.l - PAD.r, ph = f.h - PAD.t - PAD.b;
c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
if (spectroImg) c.drawImage(spectroImg, PAD.l, PAD.t, pw, ph);
axesSpectro(c, f.w, f.h);
c.fillStyle = 'rgba(168,155,140,.9)'; c.textAlign = 'right'; c.textBaseline = 'top';
c.fillText(db(state.specTop, 0) + ' dBFS', f.w - PAD.r - 4, PAD.t + 3);
c.fillText(db(state.specTop - state.specRange, 0) + ' dBFS', f.w - PAD.r - 4, PAD.t + ph - 13);
c.textAlign = 'left';
}
function slopeFit() {
const a = state.analysis; if (!a) return NaN;
const N = a.fftSize, sr = state.sr, half = a.half;
let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
for (let k = 1; k < half; k++) {
const fq = k * sr / N;
if (fq < 40 || fq > Math.min(12000, sr * 0.45)) continue;
const d = 10 * Math.log10(Math.max(a.avg[k], 1e-20));
if (d + gainDb() < state.specTop - state.specRange - 10) continue;
const x = Math.log2(fq);
n++; sx += x; sy += d; sxx += x * x; sxy += x * d;
}
if (n < 8) return NaN;
return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
function drawWelch() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('welch');
const f = fit($('welchCanvas')), c = f.c, w = f.w, h = f.h;
c.clearRect(0, 0, w, h);
const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
const top = state.specTop, range = state.specRange, lg = gainDb();
const half = a.half, N = a.fftSize, sr = state.sr;
const yOf = function (d) { return PAD.t + ph * (1 - clamp((d - (top - range)) / range, 0, 1)); };
const xOf = function (fq) { return PAD.l + pw * freqNorm(fq); };
c.font = '10px system-ui,sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
for (let d = top; d >= top - range; d -= 10) {
const y = yOf(d);
c.strokeStyle = 'rgba(46,40,35,.75)'; c.beginPath(); c.moveTo(PAD.l, y + .5); c.lineTo(PAD.l + pw, y + .5); c.stroke();
c.fillStyle = 'rgba(168,155,140,.8)'; c.fillText(String(Math.round(d)), PAD.l - 6, y);
}
c.textAlign = 'center'; c.textBaseline = 'top';
[25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(function (fq) {
if (fq < fMin() || fq > fMax()) return;
const x = xOf(fq);
c.strokeStyle = 'rgba(46,40,35,.6)'; c.beginPath(); c.moveTo(x + .5, PAD.t); c.lineTo(x + .5, PAD.t + ph); c.stroke();
c.fillStyle = 'rgba(168,155,140,.8)'; c.fillText(fq >= 1000 ? (fq / 1000) + 'к' : String(fq), x, PAD.t + ph + 6);
});
let refD = -Infinity;
for (let k = 1; k < half; k++) { const fq = k * sr / N; if (fq >= 900 && fq <= 1100) { const d = 10 * Math.log10(Math.max(a.avg[k], 1e-20)) + lg; if (d > refD) refD = d; } }
if (!isFinite(refD)) refD = top - range * 0.4;
[[0, '#6b6156'], [-3.0103, '#88a383'], [-6.0206, '#8f6b47'], [3.0103, '#7d8fa8'], [6.0206, '#9b7fa8']].forEach(function (s) {
c.strokeStyle = s[1]; c.globalAlpha = .45; c.setLineDash([5, 4]); c.lineWidth = 1;
c.beginPath();
c.moveTo(xOf(1000), yOf(refD)); c.lineTo(xOf(fMax()), yOf(refD + s[0] * Math.log2(fMax() / 1000)));
c.moveTo(xOf(1000), yOf(refD)); c.lineTo(xOf(fMin()), yOf(refD + s[0] * Math.log2(fMin() / 1000)));
c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
});
c.strokeStyle = '#c19a6b'; c.lineWidth = 1.6; c.beginPath();
for (let x = 0; x < pw; x++) {
const fq = normFreq(x / pw);
const k = clamp(Math.round(fq * N / sr), 1, half - 1);
const y = yOf(10 * Math.log10(Math.max(a.avg[k], 1e-20)) + lg);
if (x === 0) c.moveTo(PAD.l + x, y); else c.lineTo(PAD.l + x, y);
}
c.stroke();
c.strokeStyle = 'rgba(61,53,46,.9)'; c.lineWidth = 1; c.strokeRect(PAD.l + .5, PAD.t + .5, pw - 1, ph - 1);
c.textAlign = 'left'; c.textBaseline = 'top';
let ly = PAD.t + 4;
[['0 дБ/окт', '#6b6156'], ['−3 дБ/окт', '#88a383'], ['−6 дБ/окт', '#8f6b47'], ['+3 дБ/окт', '#7d8fa8'], ['+6 дБ/окт', '#9b7fa8']].forEach(function (s) {
c.fillStyle = s[1]; c.fillRect(PAD.l + 8, ly + 4, 12, 2); c.fillStyle = 'rgba(168,155,140,.9)'; c.fillText(s[0], PAD.l + 25, ly); ly += 13;
});
c.textAlign = 'right'; c.fillStyle = 'rgba(168,155,140,.95)';
c.fillText('наклон ' + db(slopeFit(), 2) + ' дБ/окт', w - PAD.r - 4, PAD.t + 3);
c.fillText('dBFS на полосу', w - PAD.r - 4, PAD.t + 16);
c.textAlign = 'left'; c.fillStyle = 'rgba(107,97,86,.9)'; c.fillText('dBFS', 6, PAD.t - 2);
c.textAlign = 'center'; c.fillText('Гц', PAD.l + pw / 2, PAD.t + ph + 15); c.textAlign = 'left';
$('welchSummary').textContent = 'Усреднение по ' + a.cols + ' окнам · окно ' + a.fftSize + ' · наклон ' + db(slopeFit(), 2) + ' дБ/окт';
}
function drawHist() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('hist');
const f = fit($('histCanvas')), c = f.c, w = f.w, h = f.h;
c.clearRect(0, 0, w, h);
const pl = 48, pr = 14, pt = 14, pb = 26, pw = w - pl - pr, ph = h - pt - pb;
const H = a.hist, g = state.gain;
let mx = 0; for (let i = 0; i < H.length; i++) if (H[i] > mx) mx = H[i];
const lg = mx > 0 ? Math.log10(mx + 1) : 1;
c.fillStyle = 'rgba(193,154,107,.75)';
const bw = pw / H.length;
for (let i = 0; i < H.length; i++) { const v = Math.log10(H[i] + 1) / lg; c.fillRect(pl + i * bw, pt + ph * (1 - v), Math.max(1, bw - .4), ph * v); }
c.strokeStyle = 'rgba(125,143,168,.85)'; c.lineWidth = 1.4; c.beginPath();
const rms = a.rms;
for (let x = 0; x < pw; x++) {
const v = -1 + 2 * x / pw;
const y = pt + ph * (1 - (rms > 0 ? Math.exp(-v * v / (2 * rms * rms)) : 0));
if (x === 0) c.moveTo(pl + x, y); else c.lineTo(pl + x, y);
}
c.stroke();
c.strokeStyle = 'rgba(61,53,46,.9)'; c.lineWidth = 1; c.strokeRect(pl + .5, pt + .5, pw - 1, ph - 1);
c.font = '10px system-ui,sans-serif'; c.fillStyle = 'rgba(168,155,140,.85)'; c.textAlign = 'center'; c.textBaseline = 'top';
[-1, -0.5, 0, 0.5, 1].forEach(function (v) { c.fillText(num(v * g, 2), pl + pw * (v + 1) / 2, pt + ph + 6); });
c.textAlign = 'left'; c.fillText('амплитуда после нормализации · логарифмическая частота', pl + 4, pt + 2);
c.fillStyle = 'rgba(125,143,168,.9)'; c.fillText('гауссова огибающая', pl + 4, pt + 15);
c.fillStyle = 'rgba(168,155,140,.9)';
c.fillText('эксцесс ' + num(a.kurt, 2) + ' · асимметрия ' + num(a.skew, 2) + ' · крест-фактор ' + db(20 * Math.log10(Math.max(a.peak, 1e-12) / Math.max(a.rms, 1e-12)), 1) + ' дБ', pl + 4, pt + 28);
}
function drawLoud() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('loud');
const f = fit($('loudCanvas')), c = f.c, w = f.w, h = f.h;
c.clearRect(0, 0, w, h);
const pl = 48, pr = 14, pt = 14, pb = 26, pw = w - pl - pr, ph = h - pt - pb, lg = gainDb();
const yOf = function (v) { return pt + ph * (1 - clamp((v + 60) / 60, 0, 1)); };
c.font = '10px system-ui,sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
for (let v = 0; v >= -60; v -= 10) {
const y = yOf(v);
c.strokeStyle = 'rgba(46,40,35,.8)'; c.beginPath(); c.moveTo(pl, y + .5); c.lineTo(pl + pw, y + .5); c.stroke();
c.fillStyle = 'rgba(168,155,140,.8)'; c.fillText(String(v), pl - 6, y);
}
if (isFinite(a.I)) { const y = yOf(a.I + lg); c.strokeStyle = 'rgba(134,160,109,.85)'; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(pl, y); c.lineTo(pl + pw, y); c.stroke(); c.setLineDash([]); }
function curveOf(arr, col, off) {
c.strokeStyle = col; c.lineWidth = 1.3; c.beginPath();
let st = false;
for (let i = 0; i < arr.length; i++) {
if (!isFinite(arr[i])) continue;
const x = pl + pw * i / Math.max(1, arr.length - 1), y = yOf(arr[i] + off);
if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y);
}
c.stroke();
}
curveOf(a.S, '#7d8fa8', lg); curveOf(a.M, '#c19a6b', lg);
c.strokeStyle = 'rgba(180,98,42,.75)'; c.lineWidth = 1; c.beginPath();
for (let i = 0; i < a.TP.length; i++) {
const d = 20 * Math.log10(Math.max(a.TP[i] * state.gain, 1e-12));
const x = pl + pw * i / Math.max(1, a.TP.length - 1), y = yOf(d);
if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
}
c.stroke();
if (audioEl.duration > 0) { const x = pl + pw * clamp(audioEl.currentTime / audioEl.duration, 0, 1); c.strokeStyle = '#e8c88c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, pt); c.lineTo(x, pt + ph); c.stroke(); }
c.strokeStyle = 'rgba(61,53,46,.9)'; c.lineWidth = 1; c.strokeRect(pl + .5, pt + .5, pw - 1, ph - 1);
c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(168,155,140,.85)';
for (let i = 0; i <= 4; i++) c.fillText(fmtTime(state.duration_s * i / 4), clamp(pl + pw * i / 4, pl + 14, pl + pw - 14), pt + ph + 6);
c.textAlign = 'left';
let ly = pt + 3;
[['M 400 мс', '#c19a6b'], ['S 3 с', '#7d8fa8'], ['Истинный пик', '#b4622a'], ['I интегральная', '#86a06d']].forEach(function (s) { c.fillStyle = s[1]; c.fillRect(pl + 8, ly + 4, 12, 2); c.fillStyle = 'rgba(168,155,140,.9)'; c.fillText(s[0], pl + 25, ly); ly += 13; });
if (state.ch > 2) { c.fillStyle = 'rgba(201,162,39,.9)'; c.textAlign = 'right'; c.fillText('многоканальная сумма без взвешивания', w - 14, pt + 3); c.textAlign = 'left'; }
}
function buildLtas() {
const a = state.analysis;
ltasRows = [];
if (!a) return;
const N = a.fftSize, sr = state.sr, half = a.half, lg = gainDb();
let total = 0;
THIRD.forEach(function (fc) {
const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
if (hi > sr * 0.5 || lo < 12) return;
const k0 = clamp(Math.floor(lo * N / sr), 0, half - 1), k1 = clamp(Math.ceil(hi * N / sr), k0 + 1, half);
let p = 0;
for (let k = k0; k < k1; k++) p += a.avg[k];
total += p;
ltasRows.push({ fc: fc, lo: lo, hi: hi, db: 10 * Math.log10(Math.max(p, 1e-20)) + lg, bins: k1 - k0 });
});
$('ltasSummary').textContent = 'Сумма полос ' + db(10 * Math.log10(Math.max(total, 1e-20)) + lg, 1) + ' dBFS RMS · полос ' + ltasRows.length;
}
function drawLtas() {
const a = state.analysis;
if (!a) { showVisual('empty'); return; }
showVisual('ltas');
buildLtas();
let mx = -Infinity;
ltasRows.forEach(function (r) { if (r.db > mx) mx = r.db; });
const html = ['<table class="ltas-table"><thead><tr><th>Полоса, Гц</th><th>Границы</th><th>Уровень, dBFS</th><th>Отн., дБ</th><th style="width:34%">Профиль</th></tr></thead><tbody>'];
ltasRows.forEach(function (r) {
const rel = r.db - mx;
html.push('<tr><td>' + (r.fc >= 1000 ? (r.fc / 1000) + 'k' : r.fc) + '</td><td>' + Math.round(r.lo) + '–' + Math.round(r.hi) + '</td><td>' + db(r.db, 1) + '</td><td>' + db(rel, 1) + '</td><td><div class="ltas-bar" style="width:' + (clamp((rel + 60) / 60, 0.01, 1) * 100).toFixed(1) + '%"></div></td></tr>');
});
html.push('</tbody></table>');
$('ltasWrap').innerHTML = html.join('');
}
function drawCurve() {
const f = fit($('curveCanvas')), c = f.c, w = f.w, h = f.h;
c.clearRect(0, 0, w, h);
const pl = 44, pr = 12, pt = 12, pb = 22, pw = w - pl - pr, ph = h - pt - pb;
const fm = Math.min(20000, state.sampleRate * 0.47);
c.font = '10px system-ui,sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
[24, 12, 0, -12, -24].forEach(function (d) {
const y = pt + ph * (0.5 - d / 48);
c.strokeStyle = d === 0 ? 'rgba(193,154,107,.35)' : 'rgba(193,154,107,.13)';
c.lineWidth = 1; c.beginPath(); c.moveTo(pl, y + .5); c.lineTo(pl + pw, y + .5); c.stroke();
c.fillStyle = 'rgba(168,155,140,.85)'; c.fillText((d > 0 ? '+' : '') + d, pl - 6, y);
});
c.textAlign = 'center'; c.textBaseline = 'top';
[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(function (fq) {
if (fq > fm) return;
const x = pl + pw * Math.log(fq / 20) / Math.log(fm / 20);
c.strokeStyle = 'rgba(193,154,107,.1)'; c.beginPath(); c.moveTo(x + .5, pt); c.lineTo(x + .5, pt + ph); c.stroke();
c.fillStyle = 'rgba(168,155,140,.8)'; c.fillText(fq >= 1000 ? (fq / 1000) + 'к' : String(fq), x, pt + ph + 5);
});
c.strokeStyle = '#c19a6b'; c.lineWidth = 2; c.beginPath();
for (let x = 0; x < pw; x++) {
const i = Math.min(curveData.length - 1, Math.floor(x / pw * curveData.length));
const y = pt + ph * (1 - curveData[i]);
if (x === 0) c.moveTo(pl + x, y); else c.lineTo(pl + x, y);
}
c.stroke();
c.fillStyle = 'rgba(107,97,86,.9)'; c.textAlign = 'left'; c.fillText('дБ', 6, pt - 2);
c.textAlign = 'right'; c.fillText('Гц', w - 6, pt + ph + 5); c.textAlign = 'left';
}
function curveMode() { return state.mode === 'lab' && state.labTool === 'curve'; }
function renderView() {
if (curveMode() && (state.view === 'curve' || !state.analysis)) { showVisual('curve'); drawCurve(); return; }
if (!state.analysis) { showVisual('empty'); return; }
if (state.view === 'spectro') drawSpectro();
else if (state.view === 'welch') drawWelch();
else if (state.view === 'ltas') drawLtas();
else if (state.view === 'hist') drawHist();
else if (state.view === 'loud') drawLoud();
else drawWave();
}
function setView(v) {
state.view = v;
$('viewToggle').querySelectorAll('.view-btn').forEach(function (b) { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
renderView(); save();
}
function syncView() {
const cm = curveMode();
$('viewCurveBtn').classList.toggle('hidden', !cm);
if (cm) state.view = 'curve'; else if (state.view === 'curve') state.view = 'wave';
setView(state.view);
}
function renderChips() {
const a = state.analysis, el = $('analysis');
if (!a) { el.classList.add('hidden'); el.innerHTML = ''; return; }
const lg = gainDb();
const pk = 20 * Math.log10(Math.max(a.peak * state.gain, 1e-12));
const tp = 20 * Math.log10(Math.max(a.truePeak * state.gain, 1e-12));
const rms = 20 * Math.log10(Math.max(a.rms * state.gain, 1e-12));
const ch = [];
ch.push('<span class="chip"><span>Пик</span><b>' + db(pk) + ' dBFS</b></span>');
ch.push('<span class="chip' + (tp > 0 ? ' bad' : (tp > -0.5 ? ' warn' : ' ok')) + '"><span>Истинный пик</span><b>' + db(tp) + ' dBTP</b></span>');
ch.push('<span class="chip"><span>RMS акт.</span><b>' + db(rms) + ' dBFS</b></span>');
if (isFinite(a.I)) ch.push('<span class="chip"><span>I</span><b>' + db(a.I + lg) + ' LUFS</b></span>');
if (isFinite(a.LRA)) ch.push('<span class="chip"><span>LRA</span><b>' + num(a.LRA, 1) + ' LU</b></span>');
ch.push('<span class="chip"><span>Крест</span><b>' + num(pk - rms, 1) + ' дБ</b></span>');
ch.push('<span class="chip' + (Math.abs(a.dc) > 0.001 ? ' warn' : '') + '"><span>DC</span><b>' + (a.dc < 0 ? '−' : '+') + Math.abs(a.dc * state.gain).toFixed(5).replace('.', ',') + '</b></span>');
if (isFinite(a.corr)) ch.push('<span class="chip' + (a.corr > 0.999 ? ' warn' : '') + '"><span>Корр. L/R</span><b>' + num(a.corr, 3) + '</b></span>');
ch.push('<span class="chip"><span>Эксцесс</span><b>' + num(a.kurt, 2) + '</b></span>');
const sl = slopeFit();
if (isFinite(sl)) ch.push('<span class="chip"><span>Наклон</span><b>' + db(sl, 2) + ' дБ/окт</b></span>');
if (state.ch > 2) ch.push('<span class="chip warn"><span>Каналов</span><b>' + state.ch + '</b></span>');
if (a.clipped > 0) ch.push('<span class="chip bad"><span>Клиппинг</span><b>' + a.clipped + ' отсч.</b></span>');
else ch.push('<span class="chip ok"><b>Клиппинга нет</b></span>');
if (a.limited) ch.push('<span class="chip warn"><b>Огранижено по пику</b></span>');
el.innerHTML = ch.join('');
el.classList.remove('hidden');
}
function meterSet(id, fid, v, lo, hi) {
$(id).textContent = isFinite(v) ? db(v, 1) : '—';
$(fid).style.transform = 'scaleX(' + (isFinite(v) ? clamp((v - lo) / (hi - lo), 0, 1).toFixed(3) : 0) + ')';
}
function updateMeters() {
const a = state.analysis;
if (!a) { $('meters').classList.add('hidden'); return; }
$('meters').classList.remove('hidden');
const lg = gainDb();
let idx = -1;
if (audioEl.duration > 0) idx = clamp(Math.floor(audioEl.currentTime / a.subSec), 0, a.M.length - 1);
meterSet('mM', 'fM', idx >= 0 && isFinite(a.M[idx]) ? a.M[idx] + lg : NaN, -60, 0);
meterSet('mS', 'fS', idx >= 0 && isFinite(a.S[idx]) ? a.S[idx] + lg : NaN, -60, 0);
meterSet('mI', 'fI', isFinite(a.I) ? a.I + lg : NaN, -60, 0);
$('mLRA').textContent = isFinite(a.LRA) ? num(a.LRA, 1) + ' LU' : '—';
$('fLRA').style.transform = 'scaleX(' + (isFinite(a.LRA) ? clamp(a.LRA / 20, 0, 1).toFixed(3) : 0) + ')';
meterSet('mTP', 'fTP', idx >= 0 && a.TP[idx] !== undefined ? 20 * Math.log10(Math.max(a.TP[idx] * state.gain, 1e-12)) : NaN, -60, 6);
}
function meterLoop() {
updateMeters();
if (state.view === 'wave' || state.view === 'loud') renderView();
rafMeters = audioEl.paused ? 0 : requestAnimationFrame(meterLoop);
}

const audioEl = new Audio();
audioEl.preload = 'auto';
audioEl.setAttribute('playsinline', '');
const seekBar = $('seekBar');
function playIcon(p) { $('playIcon').innerHTML = p ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>'; $('playBtn').setAttribute('aria-label', p ? 'Пауза' : 'Воспроизвести'); }
function timeText() { $('timeDisplay').textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration || state.duration_s); }
audioEl.addEventListener('timeupdate', function () { timeText(); if (!state.seeking && audioEl.duration > 0) seekBar.value = Math.floor(audioEl.currentTime / audioEl.duration * 1000); positionState(); });
audioEl.addEventListener('loadedmetadata', function () { timeText(); seekBar.disabled = false; });
audioEl.addEventListener('play', function () { playIcon(true); if (!rafMeters) rafMeters = requestAnimationFrame(meterLoop); mediaMeta(); });
audioEl.addEventListener('pause', function () { playIcon(false); updateMeters(); positionState(); });
audioEl.addEventListener('ended', function () { playIcon(false); updateMeters(); });
audioEl.addEventListener('error', function () { if (state.url) pFail('Браузер не смог воспроизвести файл, но скачать его можно'); });
function togglePlay() {
if (!state.url) return;
if (audioEl.paused) { const p = audioEl.play(); if (p && p.catch) p.catch(function () { pFail('Нажмите ещё раз — браузер блокирует автозапуск'); }); }
else audioEl.pause();
}
function seekBy(d) {
if (!(audioEl.duration > 0)) return;
audioEl.currentTime = clamp(audioEl.currentTime + d, 0, Math.max(0, audioEl.duration - 0.05));
seekBar.value = Math.floor(audioEl.currentTime / audioEl.duration * 1000);
timeText(); updateMeters(); if (state.view === 'wave' || state.view === 'loud') renderView(); positionState();
}
$('playBtn').addEventListener('click', togglePlay);
seekBar.addEventListener('pointerdown', function () { state.seeking = true; });
seekBar.addEventListener('input', function () { if (audioEl.duration > 0) audioEl.currentTime = seekBar.value / 1000 * audioEl.duration; });
['pointerup', 'pointercancel', 'change'].forEach(function (e) { seekBar.addEventListener(e, function () { state.seeking = false; }); });
window.addEventListener('pointerup', function () { state.seeking = false; });
$('volume').addEventListener('input', function () {
state.volume = parseInt($('volume').value, 10);
audioEl.volume = state.volume / 100;
$('volNum').textContent = state.volume + '%';
if (live.on) liveApplyLevel();
if (labSession) { try { labSession.master.gain.setTargetAtTime(state.volume / 100, audioCtx.currentTime, 0.05); } catch (e) {} }
save();
});
$('loopBtn').addEventListener('click', function () { setLoop(!state.loop); });
function artwork() {
try {
const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
const c = cv.getContext('2d');
const g = c.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#241f1a'); g.addColorStop(1, '#141210');
c.fillStyle = g; c.fillRect(0, 0, 512, 512);
c.lineCap = 'round'; c.lineWidth = 48;
[[112, 160, 352, '#c19a6b'], [208, 96, 416, '#d4ad7d'], [304, 176, 336, '#c19a6b'], [400, 112, 400, '#c19a6b']].forEach(function (b) { c.strokeStyle = b[3]; c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0], b[2]); c.stroke(); });
return cv.toDataURL('image/png');
} catch (e) { return null; }
}
function mediaMeta() {
if (!('mediaSession' in navigator)) return;
try {
if (!artUrl) artUrl = artwork();
navigator.mediaSession.metadata = new MediaMetadata({
title: 'White Noise Lab', artist: live.on ? 'Живой шум · ' + LABELS[state.liveType] : state.key,
album: live.on ? 'бесконечно' : fmtTime(state.duration_s) + ' · ' + state.sr + ' Гц',
artwork: artUrl ? [{ src: artUrl, sizes: '512x512', type: 'image/png' }] : []
});
navigator.mediaSession.playbackState = (audioEl.paused && !live.on) ? 'paused' : 'playing';
} catch (e) {}
}
function positionState() {
if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
try { if (audioEl.duration > 0 && isFinite(audioEl.duration)) navigator.mediaSession.setPositionState({ duration: audioEl.duration, playbackRate: audioEl.playbackRate || 1, position: clamp(audioEl.currentTime, 0, audioEl.duration) }); } catch (e) {}
}
function initMedia() {
if (!('mediaSession' in navigator)) return;
[['play', function () { if (live.on) return; if (audioEl.paused) togglePlay(); }],
['pause', function () { if (live.on) { liveStop(); return; } if (!audioEl.paused) audioEl.pause(); }],
['stop', function () { if (live.on) { liveStop(); return; } audioEl.pause(); audioEl.currentTime = 0; }],
['seekbackward', function (d) { seekBy(-(d && d.seekOffset ? d.seekOffset : 10)); }],
['seekforward', function (d) { seekBy(d && d.seekOffset ? d.seekOffset : 10); }],
['seekto', function (d) { if (d && d.seekTime !== undefined && audioEl.duration > 0) { audioEl.currentTime = clamp(d.seekTime, 0, audioEl.duration); updateMeters(); } }],
['previoustrack', function () { seekBy(-30); }], ['nexttrack', function () { seekBy(30); }]].forEach(function (p) { try { navigator.mediaSession.setActionHandler(p[0], p[1]); } catch (e) {} });
}

function applyResult(r, key, meta) {
audioEl.pause();
const old = state.url;
state.analysis = r; state.master = r.master; state.gain = r.gain;
state.wav = r.wav; state.bits = r.bits; state.duration_s = r.duration; state.sr = r.sr; state.ch = r.ch;
state.key = key; state.meta = meta; state.fftPending = false;
state.url = URL.createObjectURL(r.wav);
audioEl.src = state.url; audioEl.loop = state.loop; audioEl.volume = state.volume / 100;
if (old) URL.revokeObjectURL(old);
spectroDirty = true; spectroImg = null;
waveView.a = 0; waveView.b = 1; waveView.sa = -1; waveView.sb = -1;
$('dlBitDepth').value = String(r.bits); state.dlBits = r.bits;
seekBar.disabled = false; seekBar.value = 0;
let label = meta.label;
if (r.boostDb) label += ' · +' + num(r.boostDb, 0) + ' дБ';
$('stageMeta').textContent = label + ' · ' + fmtTime(r.duration) + ' · ' + r.sr + ' Гц · ' + (r.ch > 2 ? r.ch + ' кан.' : (r.ch === 2 ? 'стерео' : 'моно')) + ' · ' + r.bits + ' бит · ' + fmtSize(r.wav.size);
timeText(); renderChips(); buildLtas(); updateMeters(); syncView(); refresh(); mediaMeta();
}
function refresh() {
const b = state.busy;
$('generateBtn').disabled = b || state.tooBig;
$('mixBtn').disabled = b || !state.mixFile;
['curveGen', 'signalGen', 'calibBtn', 'synthBtn', 'percBtn', 'ditherNo', 'ditherYes', 'ltasCsv', 'welchCsv', 'ownGen', 'ownRec'].forEach(function (id) { const e = $(id); if (e) e.disabled = b; });
$('ownGen').disabled = b || !own.arrays;
$('ownRec').disabled = b;
$('ownWav').disabled = b || !state.wav;
$('ownMp3').disabled = b || !state.master || state.ch > 2;
$('reanalyzeBtn').disabled = b || !state.master;
$('reanalyzeBtn').classList.toggle('pending', state.fftPending && !b);
$('dlWavBtn').disabled = b || !state.wav;
$('dlMp3Btn').disabled = b || !state.master || state.ch > 2;
$('playBtn').disabled = !state.url;
['cancelBtn', 'cancelBtnMix', 'cancelBtnCurve', 'cancelBtnSignal', 'cancelBtnCalib', 'cancelBtnSynth', 'ownCancel'].forEach(function (id) { const e = $(id); if (e) e.classList.toggle('hidden', !b); });
$('viewToggle').querySelectorAll('.view-btn').forEach(function (btn) { btn.disabled = btn.dataset.view === 'curve' ? false : !state.analysis; });
$('waveZoomIn').disabled = !state.analysis;
$('waveZoomOut').disabled = !state.analysis;
$('waveFit').disabled = !state.analysis;
$('waveSelClear').disabled = !state.analysis;
}
async function job(btn, label, fn) {
if (state.busy) return;
state.busy = true; state.cancelled = false;
const html = btn ? btn.innerHTML : '';
if (btn) btn.innerHTML = label;
refresh(); pBusy(label);
try {
await tick();
await fn({ progress: pSet, tick: tick, cancelled: function () { return state.cancelled; } });
pDone('Готово');
} catch (e) {
if (e && e.message === 'cancelled') pFail('Отменено пользователем');
else { console.error(e); pFail(friendly(e)); }
} finally {
if (btn) btn.innerHTML = html;
state.busy = false; state.cancelled = false; refresh(); save();
}
}
function swatches(id, active, cb) {
const el = $(id); el.innerHTML = '';
TYPES.forEach(function (t) {
const b = document.createElement('button');
b.type = 'button'; b.className = 'swatch' + (t === active ? ' active' : '');
b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', t === active ? 'true' : 'false');
b.innerHTML = '<span class="swatch-dot" style="background:' + COLORS[t] + '"></span><span class="swatch-name">' + LABELS[t] + '</span>';
b.addEventListener('click', function () {
el.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
b.classList.add('active'); b.setAttribute('aria-checked', 'true'); cb(t); save();
});
el.appendChild(b);
});
}
function segment(id, attr, cb) {
$(id).addEventListener('click', function (e) {
const b = e.target.closest('.seg'); if (!b) return;
$(id).querySelectorAll('.seg').forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
b.classList.add('active'); b.setAttribute('aria-checked', 'true');
cb(b.dataset[attr]); save();
});
}
function slider(sid, nid, key, min, max, dec, cb) {
const s = $(sid), n = $(nid);
if (!s || !n) return;
const round = function (v) { return dec ? Math.round(v * 100) / 100 : Math.round(v); };
function commit(v) { v = clamp(round(isNaN(v) ? min : v), min, max); state[key] = v; s.value = v; n.value = v; if (cb) cb(v); save(); }
s.addEventListener('input', function () { const v = clamp(round(parseFloat(s.value)), min, max); state[key] = v; n.value = v; if (cb) cb(v); save(); });
n.addEventListener('input', function () { const v = parseFloat(n.value); if (isNaN(v) || v < min || v > max) return; state[key] = round(v); s.value = state[key]; if (cb) cb(state[key]); save(); });
n.addEventListener('change', function () { commit(parseFloat(n.value)); });
n.addEventListener('blur', function () { commit(parseFloat(n.value)); });
s.value = state[key]; n.value = state[key];
}
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arcPath(cx, cy, r, a0, a1) {
const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
}
function makeKnob(id, opt) {
const host = $(id);
host.className = 'knob';
host.setAttribute('role', 'slider');
host.setAttribute('tabindex', '0');
host.setAttribute('aria-label', opt.label);
host.setAttribute('aria-valuemin', String(opt.min));
host.setAttribute('aria-valuemax', String(opt.max));
host.innerHTML = '<svg viewBox="0 0 88 88" aria-hidden="true">' +
'<defs><linearGradient id="' + id + '-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0bd8e"/><stop offset="0.55" stop-color="#c19a6b"/><stop offset="1" stop-color="#b4622a"/></linearGradient></defs>' +
'<circle class="knob-bg" cx="44" cy="44" r="40"/>' +
'<path class="knob-track" d="' + arcPath(44, 44, 34, -135, 135) + '"/>' +
'<path class="knob-value" stroke="url(#' + id + '-g)" d=""/>' +
'<circle class="knob-cap" cx="44" cy="44" r="25"/>' +
'<line class="knob-pointer" x1="44" y1="44" x2="44" y2="23"/>' +
'</svg><div class="knob-read"><b></b><span>' + opt.unit + '</span></div>';
const valPath = host.querySelector('.knob-value');
const pointer = host.querySelector('.knob-pointer');
const read = host.querySelector('.knob-read b');
let value = opt.value;
function render() {
const t = clamp((value - opt.min) / (opt.max - opt.min), 0, 1);
const ang = -135 + 270 * t;
valPath.setAttribute('d', t <= 0.002 ? '' : arcPath(44, 44, 34, -135, ang));
pointer.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' 44 44)');
read.textContent = opt.format(value);
host.setAttribute('aria-valuenow', String(value));
host.setAttribute('aria-valuetext', opt.format(value) + ' ' + opt.unit);
}
function set(v, fire) {
v = clamp(Math.round(v / opt.step) * opt.step, opt.min, opt.max);
v = Math.round(v * 1000) / 1000;
if (v === value && fire !== true) { render(); return; }
value = v; render();
if (fire !== false) opt.onInput(value);
}
render();
let drag = null;
host.addEventListener('pointerdown', function (e) {
e.preventDefault();
try { host.setPointerCapture(e.pointerId); } catch (x) {}
host.classList.add('dragging');
drag = { x: e.clientX, y: e.clientY, v: value };
});
host.addEventListener('pointermove', function (e) {
if (!drag) return;
const span = opt.max - opt.min;
const d = (drag.y - e.clientY) + (e.clientX - drag.x);
set(drag.v + d * span / (e.shiftKey ? 800 : 190));
});
function end() { drag = null; host.classList.remove('dragging'); }
host.addEventListener('pointerup', end);
host.addEventListener('pointercancel', end);
host.addEventListener('lostpointercapture', end);
host.addEventListener('wheel', function (e) { e.preventDefault(); set(value + (e.deltaY < 0 ? 1 : -1) * opt.step * (e.shiftKey ? 1 : 4)); }, { passive: false });
host.addEventListener('dblclick', function () { set(opt.def); });
host.addEventListener('keydown', function (e) {
const big = opt.step * 10;
if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + (e.shiftKey ? opt.step : big)); }
else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - (e.shiftKey ? opt.step : big)); }
else if (e.key === 'Home') { e.preventDefault(); set(opt.min); }
else if (e.key === 'End') { e.preventDefault(); set(opt.max); }
else if (e.key === 'PageUp') { e.preventDefault(); set(value + big * 2); }
else if (e.key === 'PageDown') { e.preventDefault(); set(value - big * 2); }
});
return { set: function (v) { set(v, false); } };
}
function estimate() {
const t = state.duration + (state.loop ? 0 : state.padStart + state.padEnd);
const bps = state.bitDepth === 16 ? 2 : (state.bitDepth === 24 ? 3 : 4);
const size = 44 + Math.round(t * state.sampleRate) * state.channels * bps;
const el = $('estimate');
state.tooBig = size > SIZE_LIMIT;
el.classList.toggle('warn', state.tooBig);
el.textContent = state.tooBig ? ('Слишком большой файл: ' + fmtSize(size) + '. Уменьшите длительность, частоту или битрейт') : ('WAV ≈ ' + fmtSize(size) + ' · ' + fmtTime(t) + ' · ' + (state.channels === 2 ? 'стерео' : 'моно') + (state.loop ? ' · по кругу' : '') + ' · seed ' + state.seed);
refresh();
}
function setLoop(on) {
state.loop = on; audioEl.loop = on;
$('loopToggle').checked = on;
$('loopBtn').classList.toggle('active', on);
$('loopBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
['fadeIn', 'fadeOut', 'padStart', 'padEnd'].forEach(function (k) { $(k + 'Section').classList.toggle('dimmed', on); $(k + 'Slider').disabled = on; $(k + 'Num').disabled = on; });
estimate(); save();
}
function syncNormUI() {
$('normModeSelect').value = state.norm;
$('normTargetSlider').value = state.target;
$('normTargetNum').value = state.target;
$('normTargetUnit').textContent = NORM_UNIT[state.norm];
$('normNote').textContent = NORM_NOTE[state.norm];
const off = state.norm === 'none';
$('normTargetSlider').disabled = off; $('normTargetNum').disabled = off;
}
function setNorm(m) { state.norm = m; state.target = NORM_DEF[m]; syncNormUI(); save(); }
function syncDitherUI() {
const on = state.bitDepth === 16;
$('ditherToggle').disabled = !on;
$('ditherRow').classList.toggle('dimmed', !on);
$('ditherSub').textContent = on ? 'Убирает ступеньки квантования на тихих участках и длинных фейдах' : 'Работает только при 16 бит. При 24 и 32 бит квантование настолько мелкое, что дизеринг не нужен';
}
function syncReverbUI() {
$('reverbSection').classList.toggle('dimmed', !state.reverb);
$('reverbPreset').disabled = !state.reverb;
$('reverbWet').disabled = !state.reverb;
$('reverbWetNum').disabled = !state.reverb;
$('liveReverbSection').classList.toggle('dimmed', !state.liveReverb);
$('liveReverbPreset').disabled = !state.liveReverb;
$('liveReverbWet').disabled = !state.liveReverb;
$('liveReverbWetNum').disabled = !state.liveReverb;
$('ownReverbSection').classList.toggle('dimmed', !state.ownReverb);
$('ownReverbPreset').disabled = !state.ownReverb;
$('ownWet').disabled = !state.ownReverb;
$('ownWetNum').disabled = !state.ownReverb;
}
function nextSeed() { if (state.seedAuto) { state.seed = (Math.random() * 4294967295 >>> 0) || 1; $('seedNum').value = state.seed; } }
function baseSpec() {
return { sr: state.sampleRate, channels: state.channels, bits: state.bitDepth, dither: state.dither, norm: state.norm, target: state.target, seed: state.seed, fftSize: state.fftSize, window: state.window, exact: state.exact, dist: state.dist, tilt: state.tilt, reverb: state.reverb, reverbPreset: state.reverbPreset, reverbWet: state.reverbWet };
}

swatches('swatches', state.type, function (t) { state.type = t; refresh(); });
swatches('mixSwatches', state.mixType, function (t) { state.mixType = t; });
swatches('testSwatches', state.testType, function (t) { state.testType = t; if (labSession && labSession.kind === 'test') labSession.switchTo(t); });
swatches('liveSwatches', state.liveType, function (t) { state.liveType = t; if (live.on) liveRebuild(); });

knobs.level = makeKnob('knobLevel', { min: -60, max: 0, step: 0.5, value: state.liveLevel, def: -18, unit: 'дБ', label: 'Уровень живого шума', format: function (v) { return num(v, 1); }, onInput: function (v) { state.liveLevel = v; if (live.on) liveApplyLevel(); save(); } });
knobs.drift = makeKnob('knobDrift', { min: 0, max: 100, step: 1, value: state.liveDrift, def: 25, unit: '%', label: 'Медленный дрейф', format: function (v) { return num(v, 0); }, onInput: function (v) { state.liveDrift = v; if (live.on) liveParams(); save(); } });
knobs.tilt = makeKnob('knobTilt', { min: -2, max: 2, step: 0.05, value: state.liveTilt, def: 0, unit: 'α', label: 'Дополнительный наклон', format: function (v) { return num(v, 2); }, onInput: function (v) { state.liveTilt = v; if (live.on) liveRebuild(); save(); } });

slider('tiltSlider', 'tiltNum', 'tilt', -2, 2, true, function () { $('tiltNote').textContent = 'Добавляет ' + db(-3.0103 * state.tilt, 2) + ' дБ/окт к выбранному виду шума'; });
slider('durationSlider', 'durationNum', 'duration', 1, 600, false, estimate);
slider('normTargetSlider', 'normTargetNum', 'target', -40, 0, true);
slider('fadeInSlider', 'fadeInNum', 'fadeIn', 0, 30);
slider('fadeOutSlider', 'fadeOutNum', 'fadeOut', 0, 30);
slider('padStartSlider', 'padStartNum', 'padStart', 0, 60, false, estimate);
slider('padEndSlider', 'padEndNum', 'padEnd', 0, 60, false, estimate);
slider('reverbWet', 'reverbWetNum', 'reverbWet', 0, 100);
slider('liveReverbWet', 'liveReverbWetNum', 'liveReverbWet', 0, 100, false, function () { if (live.on) liveRebuild(); });
slider('snrSlider', 'snrNum', 'snr', -40, 20);
slider('notchFreq', 'notchFreqNum', 'notchFreq', 100, 12000, false, function (v) { if (labSession && labSession.notch) labSession.notch.frequency.setTargetAtTime(v, audioCtx.currentTime, 0.02); });
slider('notchQ', 'notchQNum', 'notchQ', 1, 50, true, function (v) { if (labSession && labSession.notch) labSession.notch.Q.setTargetAtTime(v, audioCtx.currentTime, 0.02); });
slider('binBase', 'binBaseNum', 'binBase', 100, 500, false, function (v) { if (labSession && labSession.oscL) { const t = audioCtx.currentTime; labSession.oscL.frequency.setTargetAtTime(v, t, 0.03); labSession.oscR.frequency.setTargetAtTime(v + state.binBeat, t, 0.03); } });
slider('binBeat', 'binBeatNum', 'binBeat', 1, 20, true, function (v) { if (labSession && labSession.oscR) labSession.oscR.frequency.setTargetAtTime(state.binBase + v, audioCtx.currentTime, 0.03); });
slider('rot8dSpeed', 'rot8dSpeedNum', 'rot8dSpeed', 1, 20, false, function (v) { if (labSession && labSession.oscX) { const f = v * 0.06; labSession.oscX.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.05); labSession.oscZ.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.05); } });
slider('curveDur', 'curveDurNum', 'curveDur', 5, 120);
slider('signalDur', 'signalDurNum', 'signalDur', 2, 60);
slider('signalLevel', 'signalLevelNum', 'signalLevel', -60, 0);
slider('calibDur', 'calibDurNum', 'calibDur', 10, 120);
slider('synthDur', 'synthDurNum', 'synthDur', 5, 600);
slider('synthAlpha', 'synthAlphaNum', 'synthAlpha', -1, 2.5, true);
slider('synthDrift', 'synthDriftNum', 'synthDrift', 0, 100);
slider('ownDur', 'ownDurNum', 'ownDur', 5, 600);
slider('ownGrain', 'ownGrainNum', 'ownGrain', 20, 400);
slider('ownFadeIn', 'ownFadeInNum', 'ownFadeIn', 0, 30, true);
slider('ownFadeOut', 'ownFadeOutNum', 'ownFadeOut', 0, 30, true);
slider('ownPadA', 'ownPadANum', 'ownPadA', 0, 30, true);
slider('ownPadB', 'ownPadBNum', 'ownPadB', 0, 30, true);
slider('ownTilt', 'ownTiltNum', 'ownTilt', -2, 2, true);
slider('ownTarget', 'ownTargetNum', 'ownTarget', -40, 0, true);
slider('ownWet', 'ownWetNum', 'ownWet', 0, 100);

$('sampleRateSelect').addEventListener('change', function () { state.sampleRate = parseInt($('sampleRateSelect').value, 10); estimate(); syncCurveRange(); save(); });
$('bitDepthSelect').addEventListener('change', function () { state.bitDepth = parseInt($('bitDepthSelect').value, 10); syncDitherUI(); estimate(); save(); });
$('ditherToggle').addEventListener('change', function () { state.dither = $('ditherToggle').checked; save(); });
$('keepLevelToggle').addEventListener('change', function () { state.keepLevel = $('keepLevelToggle').checked; save(); });
$('exactToggle').addEventListener('change', function () { state.exact = $('exactToggle').checked; save(); });
$('normModeSelect').addEventListener('change', function () { setNorm($('normModeSelect').value); });
$('loopToggle').addEventListener('change', function () { setLoop($('loopToggle').checked); });
$('reverbToggle').addEventListener('change', function () { state.reverb = $('reverbToggle').checked; syncReverbUI(); save(); });
$('reverbPreset').addEventListener('change', function () { state.reverbPreset = $('reverbPreset').value; save(); });
$('liveReverbToggle').addEventListener('change', function () { state.liveReverb = $('liveReverbToggle').checked; syncReverbUI(); if (live.on) liveRebuild(); save(); });
$('liveReverbPreset').addEventListener('change', function () { state.liveReverbPreset = $('liveReverbPreset').value; if (live.on) liveRebuild(); save(); });
$('curveTaps').addEventListener('change', function () { state.curveTaps = parseInt($('curveTaps').value, 10); save(); });
$('dlBitDepth').addEventListener('change', function () { state.dlBits = parseInt($('dlBitDepth').value, 10); save(); });
$('mp3Rate').addEventListener('change', function () { state.mp3Rate = parseInt($('mp3Rate').value, 10); save(); });
$('signalKind').addEventListener('change', function () { state.signalKind = $('signalKind').value; syncSignalUI(); save(); });
$('seedNum').addEventListener('change', function () { state.seed = clamp(parseInt($('seedNum').value, 10) || 1, 1, 4294967295); $('seedNum').value = state.seed; estimate(); save(); });
$('seedRandom').addEventListener('click', function () { state.seed = (Math.random() * 4294967295 >>> 0) || 1; $('seedNum').value = state.seed; estimate(); save(); });
$('seedLock').addEventListener('click', function () {
state.seedAuto = !state.seedAuto;
$('seedLock').classList.toggle('active', state.seedAuto);
$('seedLock').setAttribute('aria-pressed', state.seedAuto ? 'true' : 'false');
$('seedLock').textContent = state.seedAuto ? 'Авто' : 'Фикс';
save();
});
segment('channelSegmented', 'channels', function (v) { state.channels = parseInt(v, 10); estimate(); });
segment('distSegmented', 'dist', function (v) { state.dist = v; });
segment('signalChannel', 'schan', function (v) { state.signalChan = v; });
segment('calibBand', 'band', function (v) { state.calibBand = v; });
segment('calibChannel', 'cchan', function (v) { state.calibChan = v; });
segment('synthType', 'synth', function (v) { state.synthType = v; });
segment('percType', 'perc', function (v) { state.percType = v; });
segment('notchTimer', 'min', function (v) { state.notchTimer = parseInt(v, 10); if (labSession && labSession.kind === 'notch') attachTimer(labSession, state.notchTimer, $('notchCountdown')); });
segment('binTimer', 'min', function (v) { state.binTimer = parseInt(v, 10); if (labSession && labSession.kind === 'bin') attachTimer(labSession, state.binTimer, $('binCountdown')); });
['cancelBtn', 'cancelBtnMix', 'cancelBtnCurve', 'cancelBtnSignal', 'cancelBtnCalib', 'cancelBtnSynth', 'ownCancel'].forEach(function (id) { $(id).addEventListener('click', cancelJob); });

function syncCurveRange() {
const fm = Math.min(20000, state.sampleRate * 0.47);
$('curveRange').textContent = 'Диапазон: 20 Гц – ' + (fm >= 1000 ? num(fm / 1000, 2) + ' кГц' : num(fm, 0) + ' Гц') + ' · определяется частотой дискретизации';
}
function syncSignalUI() {
const k = state.signalKind;
const sur = k === 'sur51' || k === 'sur71' || k === 'surid';
$('signalNote').textContent = SIG_NOTE[k] || '';
$('signalChanSection').classList.toggle('dimmed', sur);
$('signalChannel').querySelectorAll('.seg').forEach(function (b) { b.disabled = sur; });
$('signalLevel').disabled = k === 'isp';
$('signalLevelNum').disabled = k === 'isp';
}
function markFftPending() { state.fftPending = true; refresh(); pHint('Параметры анализа изменены — нажмите «Пересчитать»'); }
$('fftSize').addEventListener('change', function () { state.fftSize = parseInt($('fftSize').value, 10); markFftPending(); save(); });
$('fftWindow').addEventListener('change', function () { state.window = $('fftWindow').value; markFftPending(); save(); });
$('freqScale').addEventListener('change', function () { state.freqScale = $('freqScale').value; spectroDirty = true; renderView(); save(); });
$('specTop').addEventListener('input', function () { state.specTop = parseInt($('specTop').value, 10); $('specTopVal').textContent = db(state.specTop, 0); spectroDirty = true; renderView(); save(); });
$('specRange').addEventListener('input', function () { state.specRange = parseInt($('specRange').value, 10); $('specRangeVal').textContent = state.specRange; spectroDirty = true; renderView(); save(); });
$('reanalyzeBtn').addEventListener('click', function () {
if (!state.master) { pFail('Сначала сгенерируйте результат'); return; }
const spec = { master: state.master, sr: state.sr, ch: state.ch, fftSize: state.fftSize, window: state.window };
job($('reanalyzeBtn'), 'Пересчёт…', async function (hooks) {
const s = await runDsp('respec', spec, hooks);
const a = state.analysis;
a.spectra = s.spectra; a.avg = s.avg; a.cols = s.cols; a.half = s.half; a.hop = s.hop; a.fftSize = s.fftSize; a.window = s.window;
state.fftPending = false;
spectroDirty = true; spectroImg = null;
renderChips(); buildLtas(); renderView();
});
});
function csvDownload(name, text) {
const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
const u = URL.createObjectURL(blob), a = document.createElement('a');
a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
setTimeout(function () { URL.revokeObjectURL(u); }, 15000);
}
$('ltasCsv').addEventListener('click', function () {
if (!ltasRows.length) buildLtas();
let mx = -Infinity; ltasRows.forEach(function (r) { if (r.db > mx) mx = r.db; });
const rows = ['fc_hz;low_hz;high_hz;level_dbfs;relative_db;bins'];
ltasRows.forEach(function (r) { rows.push([r.fc, r.lo.toFixed(2), r.hi.toFixed(2), r.db.toFixed(3), (r.db - mx).toFixed(3), r.bins].join(';')); });
csvDownload('wnl-ltas-' + state.key + '-' + stamp() + '.csv', rows.join('\n'));
});
$('welchCsv').addEventListener('click', function () {
const a = state.analysis; if (!a) return;
const rows = ['freq_hz;level_dbfs_per_band'], lg = gainDb();
for (let k = 1; k < a.half; k++) { const f = k * state.sr / a.fftSize; if (f < 10) continue; rows.push(f.toFixed(3) + ';' + (10 * Math.log10(Math.max(a.avg[k], 1e-20)) + lg).toFixed(4)); }
csvDownload('wnl-spectrum-' + state.key + '-' + stamp() + '.csv', rows.join('\n'));
});
function grab(blob, ext, bits) {
const u = URL.createObjectURL(blob), a = document.createElement('a');
a.href = u;
a.download = 'wnl-' + state.key + '-' + Math.round(state.duration_s) + 's-' + state.sr + 'hz-' + (ext === 'mp3' ? state.mp3Rate + 'kbps' : bits + 'bit') + '-seed' + state.seed + '-' + stamp() + '.' + ext;
document.body.appendChild(a); a.click(); document.body.removeChild(a);
setTimeout(function () { URL.revokeObjectURL(u); }, 20000);
}
$('dlWavBtn').addEventListener('click', function () {
if (!state.wav) return;
const bits = parseInt($('dlBitDepth').value, 10);
if (bits === state.bits) { grab(state.wav, 'wav', bits); return; }
job($('dlWavBtn'), 'Генерация…', async function (hooks) {
const r = await runDsp('requant', { master: state.master, sr: state.sr, ch: state.ch, bits: bits, dither: state.dither, gain: state.gain }, hooks);
grab(r.wav, 'wav', bits);
});
});
$('dlMp3Btn').addEventListener('click', function () {
if (!state.master) return;
const kbps = parseInt($('mp3Rate').value, 10);
job($('dlMp3Btn'), 'Генерация…', async function (hooks) {
hooks.progress(0.03, 'Подготовка MP3');
const r = await encodeMp3(state.master, state.sr, state.ch, kbps, state.gain, hooks);
grab(r.blob, 'mp3', 16);
});
});

$('generateBtn').addEventListener('click', function () {
nextSeed();
const spec = baseSpec();
spec.source = 'gen'; spec.kind = 'noise'; spec.type = state.type;
spec.bodyFrames = Math.max(1, Math.round(state.duration * spec.sr));
spec.padA = state.loop ? 0 : Math.round(state.padStart * spec.sr);
spec.padB = state.loop ? 0 : Math.round(state.padEnd * spec.sr);
spec.fadeIn = Math.round(state.fadeIn * spec.sr); spec.fadeOut = Math.round(state.fadeOut * spec.sr);
spec.loop = state.loop;
job($('generateBtn'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, state.type, { label: LABELS[state.type] + (Math.abs(state.tilt) > 0.02 ? ' · α ' + num(state.tilt, 2) : '') + (state.reverb ? ' · пространство' : '') });
});
});

$('mixFileInput').addEventListener('change', function () {
const f = $('mixFileInput').files[0]; if (!f) return;
state.mixFile = f; $('mixFileName').textContent = f.name;
const i = $('mixInfo');
i.classList.toggle('warn', f.size > 180 * 1048576);
i.textContent = f.size > 180 * 1048576 ? ('Файл ' + fmtSize(f.size) + ' — слишком большой') : ('Размер файла: ' + fmtSize(f.size));
refresh();
});
function readBuf(f) {
if (typeof f.arrayBuffer === 'function') return f.arrayBuffer();
return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsArrayBuffer(f); });
}
function ctx() {
if (!audioCtx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) throw new Error('Браузер не поддерживает звук'); audioCtx = new A(); }
return audioCtx;
}
async function ensureCtx() { const c = ctx(); if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} } return c; }
$('mixBtn').addEventListener('click', function () {
const f = state.mixFile; if (!f) return;
const type = state.mixType, snr = state.snr, keep = state.keepLevel;
job($('mixBtn'), 'Генерация…', async function (hooks) {
if (f.size > 180 * 1048576) throw new Error('Файл больше 180 МБ');
hooks.progress(0.02, 'Чтение файла'); await tick();
const ab = await readBuf(f);
pBusy('Декодирование трека'); await tick();
const c = await ensureCtx();
let dec;
try { dec = await c.decodeAudioData(ab); } catch (e) { throw new Error('Не удалось прочитать аудио — WAV, MP3, OGG, M4A, FLAC'); }
const sr = dec.sampleRate, len = dec.length, ch = Math.min(2, dec.numberOfChannels);
if (len / sr > 600) throw new Error('Трек длиннее 10 минут');
if (len * ch * 4 > 340 * 1048576) throw new Error('Трек слишком длинный для частоты ' + sr + ' Гц');
const arr = [];
for (let k = 0; k < ch; k++) arr.push(dec.getChannelData(k).slice());
dec = null;
hooks.progress(0.08, 'Замер уровня трека');
let ts = 0;
for (let k = 0; k < ch; k++) { const d = arr[k]; for (let i = 0; i < len; i++) ts += d[i] * d[i]; }
const trackRms = Math.sqrt(ts / (len * ch));
if (trackRms < 1e-6) throw new Error('Трек пустой или слишком тихий');
const probeN = Math.min(len, Math.round(sr * 30));
const pb = new Float32Array(probeN);
DSP.noiseGen(type, sr, state.seed, { tilt: state.tilt, dist: state.dist })(pb, probeN);
let ps = 0; for (let i = 0; i < probeN; i++) ps += pb[i] * pb[i];
const noiseRms = Math.sqrt(ps / probeN);
if (noiseRms < 1e-9) throw new Error('Не удалось построить шум');
const ng = trackRms * Math.pow(10, snr / 20) / noiseRms;
const gens = [];
for (let k = 0; k < ch; k++) gens.push(DSP.noiseGen(type, sr, (state.seed + k * 7919) >>> 0, { tilt: state.tilt, dist: state.dist }));
const CH = 16384, nb = new Float32Array(CH);
let pos = 0, t0 = Date.now();
while (pos < len) {
const n = Math.min(CH, len - pos);
for (let k = 0; k < ch; k++) { gens[k](nb, n); const d = arr[k]; for (let i = 0; i < n; i++) d[pos + i] += nb[i] * ng; }
pos += n;
if (Date.now() - t0 > 40) { hooks.progress(0.1 + 0.2 * pos / len, 'Наложение шума'); await tick(); if (hooks.cancelled()) throw new Error('cancelled'); t0 = Date.now(); }
}
const spec = {
source: 'arrays', arrays: arr, sr: sr, channels: ch, bits: state.bitDepth, dither: state.dither,
bodyFrames: len, padA: 0, padB: 0, fadeIn: 0, fadeOut: 0, loop: false,
norm: keep ? 'none' : state.norm, target: state.target, fftSize: state.fftSize, window: state.window, seed: state.seed
};
const r = await runDsp('run', spec, hooks);
applyResult(r, 'mix-' + type, { label: 'Наложение · ' + LABELS[type] + ' · ' + db(snr, 0) + ' дБ' });
arr.length = 0;
});
});

const LOOP_SEC = 8;
function loopBuf(type) {
if (loopCache.has(type)) return loopCache.get(type);
const sr = audioCtx.sampleRate, n = Math.floor(sr * LOOP_SEC), fade = Math.floor(sr * 0.08);
const b = audioCtx.createBuffer(2, n, sr);
for (let c = 0; c < 2; c++) {
const tmp = new Float32Array(n + fade);
DSP.noiseGen(type, sr, (1234567 + c * 7717) >>> 0, {})(tmp, n + fade);
let s = 0; for (let i = 0; i < n + fade; i++) s += tmp[i] * tmp[i];
const rms = Math.sqrt(s / (n + fade)), g = rms > 1e-9 ? 0.12 / rms : 1;
const d = b.getChannelData(c);
for (let i = 0; i < n; i++) d[i] = tmp[i] * g;
for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = tmp[i] * g * Math.sqrt(t) + tmp[n + i] * g * Math.sqrt(1 - t); }
}
loopCache.set(type, b);
return b;
}
function resetLab() {
['notch', 'bin', 'rot8d', 'test', 'live'].forEach(function (id) { const p = $(id + 'Play'), s = $(id + 'Stop'); if (p) p.classList.remove('hidden'); if (s) s.classList.add('hidden'); });
$('notchCountdown').classList.add('hidden'); $('binCountdown').classList.add('hidden');
}
function stopLab() {
if (!labSession) return;
const s = labSession; labSession = null;
if (s.timerId) clearInterval(s.timerId);
if (s.endTo) clearTimeout(s.endTo);
if (s.raf) cancelAnimationFrame(s.raf);
const t = audioCtx.currentTime;
try { s.master.gain.cancelScheduledValues(t); s.master.gain.setValueAtTime(s.master.gain.value, t); s.master.gain.linearRampToValueAtTime(0, t + 0.06); } catch (e) {}
setTimeout(function () { s.src.forEach(function (x) { try { x.stop(); } catch (e) {} try { x.disconnect(); } catch (e) {} }); s.nodes.forEach(function (x) { try { x.disconnect(); } catch (e) {} }); }, 170);
}
function baseSess(kind) {
const m = audioCtx.createGain();
m.gain.value = 0; m.connect(audioCtx.destination);
m.gain.setValueAtTime(0, audioCtx.currentTime);
m.gain.linearRampToValueAtTime(state.volume / 100, audioCtx.currentTime + 0.2);
return { kind: kind, master: m, src: new Set(), nodes: new Set([m]), timerId: null, endTo: null, raf: 0 };
}
function attachTimer(s, min, el) {
if (s.timerId) { clearInterval(s.timerId); s.timerId = null; }
if (s.endTo) { clearTimeout(s.endTo); s.endTo = null; }
if (!min) { el.classList.add('hidden'); return; }
const t = audioCtx.currentTime;
try { s.master.gain.cancelScheduledValues(t); s.master.gain.setValueAtTime(Math.max(0.0001, s.master.gain.value), t); s.master.gain.linearRampToValueAtTime(state.volume / 100, t + 0.3); } catch (e) {}
const end = Date.now() + min * 60000;
el.classList.remove('hidden');
function step() {
const left = Math.max(0, end - Date.now());
el.textContent = 'Осталось ' + fmtTime(left / 1000);
if (left <= 0) {
if (labSession !== s) return;
if (s.timerId) { clearInterval(s.timerId); s.timerId = null; }
const tt = audioCtx.currentTime;
try { s.master.gain.cancelScheduledValues(tt); s.master.gain.setValueAtTime(s.master.gain.value, tt); s.master.gain.linearRampToValueAtTime(0.0001, tt + 2); } catch (e) {}
el.textContent = 'Таймер завершён';
s.endTo = setTimeout(function () { if (labSession === s) { stopLab(); resetLab(); $('stageMeta').textContent = 'Таймер завершён'; } }, 2200);
}
}
step(); s.timerId = setInterval(step, 500);
}
function showStop(id) { $(id + 'Play').classList.add('hidden'); $(id + 'Stop').classList.remove('hidden'); }
$('notchPlay').addEventListener('click', async function () {
stopLab(); liveStop(); ownAbort(); await ensureCtx();
const s = baseSess('notch');
const src = audioCtx.createBufferSource(); src.buffer = loopBuf('pink'); src.loop = true;
const nf = audioCtx.createBiquadFilter(); nf.type = 'notch'; nf.frequency.value = state.notchFreq; nf.Q.value = state.notchQ;
const g = audioCtx.createGain(); g.gain.value = 2.2;
src.connect(nf); nf.connect(g); g.connect(s.master); src.start();
s.src.add(src); s.nodes.add(nf); s.nodes.add(g); s.notch = nf;
labSession = s; attachTimer(s, state.notchTimer, $('notchCountdown')); showStop('notch');
$('stageMeta').textContent = 'Вырез · ' + state.notchFreq + ' Гц · Q ' + num(state.notchQ, 1);
mediaMeta();
});
$('notchStop').addEventListener('click', function () { stopLab(); resetLab(); $('stageMeta').textContent = '— · —'; });
$('binPlay').addEventListener('click', async function () {
stopLab(); liveStop(); ownAbort(); await ensureCtx();
const s = baseSess('bin');
const bed = audioCtx.createBufferSource(); bed.buffer = loopBuf('pink'); bed.loop = true;
const bg = audioCtx.createGain(); bg.gain.value = 0.45; bed.connect(bg); bg.connect(s.master);
const oL = audioCtx.createOscillator(); oL.frequency.value = state.binBase;
const oR = audioCtx.createOscillator(); oR.frequency.value = state.binBase + state.binBeat;
const pL = audioCtx.createStereoPanner(); pL.pan.value = -1;
const pR = audioCtx.createStereoPanner(); pR.pan.value = 1;
const og = audioCtx.createGain(); og.gain.value = 0.5;
oL.connect(pL); pL.connect(og); oR.connect(pR); pR.connect(og); og.connect(s.master);
bed.start(); oL.start(); oR.start();
s.src.add(bed); s.src.add(oL); s.src.add(oR);
[bg, pL, pR, og].forEach(function (n) { s.nodes.add(n); });
s.oscL = oL; s.oscR = oR;
labSession = s; attachTimer(s, state.binTimer, $('binCountdown')); showStop('bin');
$('stageMeta').textContent = 'Бинаурал · ' + state.binBase + ' Гц · разница ' + num(state.binBeat, 1) + ' Гц';
mediaMeta();
});
$('binStop').addEventListener('click', function () { stopLab(); resetLab(); $('stageMeta').textContent = '— · —'; });
$('rot8dPlay').addEventListener('click', async function () {
stopLab(); liveStop(); ownAbort(); await ensureCtx();
const s = baseSess('rot8d');
const src = audioCtx.createBufferSource(); src.buffer = loopBuf('pink'); src.loop = true;
const p = audioCtx.createPanner();
p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = 10; p.rolloffFactor = 0;
const g = audioCtx.createGain(); g.gain.value = 2.2;
src.connect(p); p.connect(g); g.connect(s.master);
const f = state.rot8dSpeed * 0.06;
const cosWave = audioCtx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
const ox = audioCtx.createOscillator(); ox.setPeriodicWave(cosWave); ox.frequency.value = f;
const oz = audioCtx.createOscillator(); oz.type = 'sine'; oz.frequency.value = f;
const gx = audioCtx.createGain(); gx.gain.value = 2;
const gz = audioCtx.createGain(); gz.gain.value = 2;
ox.connect(gx); oz.connect(gz);
let ok = false;
if (p.positionX) { try { gx.connect(p.positionX); gz.connect(p.positionZ); ok = true; } catch (e) { ok = false; } }
src.start(); ox.start(); oz.start();
s.src.add(src); s.src.add(ox); s.src.add(oz);
[p, g, gx, gz].forEach(function (n) { s.nodes.add(n); });
s.oscX = ox; s.oscZ = oz;
if (!ok) {
let ang = 0, last = performance.now();
const step = function () { if (labSession !== s) return; const now = performance.now(); ang += state.rot8dSpeed * 0.6 * Math.min(0.1, (now - last) / 1000); last = now; try { p.setPosition(Math.cos(ang) * 2, 0, Math.sin(ang) * 2); } catch (e) {} s.raf = requestAnimationFrame(step); };
s.raf = requestAnimationFrame(step);
}
labSession = s; showStop('rot8d');
$('stageMeta').textContent = '8D · скорость ' + state.rot8dSpeed;
mediaMeta();
});
$('rot8dStop').addEventListener('click', function () { stopLab(); resetLab(); $('stageMeta').textContent = '— · —'; });
$('testPlay').addEventListener('click', async function () {
stopLab(); liveStop(); ownAbort(); await ensureCtx();
const s = baseSess('test');
let cur = null;
function play(t) {
const src = audioCtx.createBufferSource(); src.buffer = loopBuf(t); src.loop = true;
const g = audioCtx.createGain(); g.gain.value = 0;
src.connect(g); g.connect(s.master); src.start();
const now = audioCtx.currentTime;
g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.15);
s.src.add(src); s.nodes.add(g);
if (cur) {
const o = cur;
try { o.g.gain.cancelScheduledValues(now); o.g.gain.setValueAtTime(o.g.gain.value, now); o.g.gain.linearRampToValueAtTime(0, now + 0.15); o.src.stop(now + 0.2); } catch (e) {}
setTimeout(function () { try { o.src.disconnect(); o.g.disconnect(); } catch (e) {} s.src.delete(o.src); s.nodes.delete(o.g); }, 420);
}
cur = { src: src, g: g };
}
play(state.testType); s.switchTo = play; labSession = s; showStop('test');
$('stageMeta').textContent = 'Тест · ' + LABELS[state.testType];
mediaMeta();
});
$('testStop').addEventListener('click', function () { stopLab(); resetLab(); $('stageMeta').textContent = '— · —'; });

function workletSource() {
return 'const clamp=' + DSP.clamp.toString() + ';const rng=' + DSP.rng.toString() + ';const gauss=' + DSP.gauss.toString() + ';const bqSet=' + DSP.bqSet.toString() + ';const bqNew=' + DSP.bqNew.toString() + ';const bqRun=' + DSP.bqRun.toString() + ';const noiseGen=' + DSP.noiseGen.toString() + ';const reverbNew=' + DSP.reverbNew.toString() + ';' +
'class WNLive extends AudioWorkletProcessor{' +
'constructor(){super();this.type="pink";this.tilt=0;this.drift=25;this.buf=new Float32Array(256);this.w=0;this.tgt=0;this.t=0;this.rev=null;this.mk();' +
'this.port.onmessage=(e)=>{const d=e.data||{};if(d.type!==undefined)this.type=d.type;if(d.tilt!==undefined)this.tilt=d.tilt;if(d.drift!==undefined)this.drift=d.drift;if(d.reverb!==undefined){this.rev=d.reverb?reverbNew(sampleRate,2,d.preset,d.wet/100):null;}this.mk();};}' +
'mk(){try{this.gen=noiseGen(this.type,sampleRate,(Math.random()*4294967295)>>>0,{tilt:this.tilt,dist:"uniform"});this.gen(this.buf,128);}catch(e){this.gen=noiseGen("white",sampleRate,1,{});}}' +
'process(inputs,outputs){const o=outputs[0];if(!o||!o.length)return true;const n=o[0].length;if(n>this.buf.length)this.buf=new Float32Array(n);' +
'try{this.gen(this.buf,n);}catch(e){for(let i=0;i<n;i++)this.buf[i]=Math.random()*2-1;}' +
'this.t+=n;const per=sampleRate*0.7;if(this.t>=per){this.t=0;this.tgt=(Math.random()*2-1)*(this.drift/100);}' +
'const k=1-Math.exp(-n/(sampleRate*2.2));this.w+=(this.tgt-this.w)*k;const g=1+this.w*0.55;' +
'for(let c=0;c<o.length;c++){const d=o[c];for(let i=0;i<n;i++)d[i]=this.buf[i]*g;}' +
'if(this.rev){try{this.rev.process(o,n);}catch(e){this.rev=null;}}' +
'return true;}}' +
"registerProcessor('wnl-live',WNLive);";
}
async function ensureWorklet() {
if (workletReady) return true;
const c = await ensureCtx();
if (!c.audioWorklet) return false;
if (workletTried) return false;
workletTried = true;
try {
await c.audioWorklet.addModule(URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' })));
workletReady = true;
return true;
} catch (e) { workletReady = false; return false; }
}
function liveTarget() { return Math.pow(10, state.liveLevel / 20) * (state.volume / 100); }
function liveApplyLevel() { if (live.gain) { try { live.gain.gain.setTargetAtTime(liveTarget(), audioCtx.currentTime, 0.08); } catch (e) {} } }
function liveParams() {
if (live.kind === 'worklet' && live.node) { try { live.node.port.postMessage({ type: state.liveType, tilt: state.liveTilt, drift: state.liveDrift, reverb: state.liveReverb, preset: state.liveReverbPreset, wet: state.liveReverbWet }); } catch (e) {} }
else if (live.kind === 'buffer' && live.lfoGain) { try { live.lfoGain.gain.setTargetAtTime(liveTarget() * 0.45 * (state.liveDrift / 100), audioCtx.currentTime, 0.2); } catch (e) {} }
liveApplyLevel();
}
function liveBuildBuffer() {
const sr = audioCtx.sampleRate, n = Math.floor(sr * 20), fade = Math.floor(sr * 0.3);
const b = audioCtx.createBuffer(2, n, sr);
const bufs = [];
for (let c = 0; c < 2; c++) {
const tmp = new Float32Array(n + fade);
DSP.noiseGen(state.liveType, sr, (Math.random() * 4294967295) >>> 0, { tilt: state.liveTilt })(tmp, n + fade);
let s = 0; for (let i = 0; i < n + fade; i++) s += tmp[i] * tmp[i];
const rms = Math.sqrt(s / (n + fade)), g = rms > 1e-9 ? 0.2 / rms : 1;
const d = b.getChannelData(c);
for (let i = 0; i < n; i++) d[i] = tmp[i] * g;
for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = tmp[i] * g * Math.sqrt(t) + tmp[n + i] * g * Math.sqrt(1 - t); }
bufs.push(d);
}
if (state.liveReverb) {
try {
const rev = DSP.reverbNew(sr, 2, state.liveReverbPreset, state.liveReverbWet / 100);
const CH = 16384;
for (let p = 0; p < n; p += CH) rev.process(bufs, Math.min(CH, n - p));
} catch (e) {}
}
return b;
}
function liveStartBuffer() {
const src = audioCtx.createBufferSource();
src.buffer = liveBuildBuffer();
src.loop = true;
const lfo = audioCtx.createOscillator();
lfo.type = 'sine'; lfo.frequency.value = 0.07;
const lg = audioCtx.createGain();
lg.gain.value = liveTarget() * 0.45 * (state.liveDrift / 100);
lfo.connect(lg); lg.connect(live.gain.gain);
src.connect(live.gain);
src.start(); lfo.start();
live.src = src; live.lfo = lfo; live.lfoGain = lg; live.kind = 'buffer';
}
function liveStartWorklet() {
const node = new AudioWorkletNode(audioCtx, 'wnl-live', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
node.port.postMessage({ type: state.liveType, tilt: state.liveTilt, drift: state.liveDrift, reverb: state.liveReverb, preset: state.liveReverbPreset, wet: state.liveReverbWet });
node.onprocessorerror = function () {
if (!live.on || live.kind !== 'worklet') return;
liveTeardownSource();
liveStartBuffer();
liveApplyLevel();
};
node.connect(live.gain);
live.node = node; live.kind = 'worklet';
}
function liveTeardownSource() {
if (live.watch) { clearTimeout(live.watch); live.watch = 0; }
const n = live.node, s = live.src, l = live.lfo, lg = live.lfoGain;
live.node = null; live.src = null; live.lfo = null; live.lfoGain = null; live.kind = 'none';
try { if (n) n.disconnect(); } catch (e) {}
try { if (s) { s.stop(); s.disconnect(); } } catch (e) {}
try { if (l) { l.stop(); l.disconnect(); } } catch (e) {}
try { if (lg) lg.disconnect(); } catch (e) {}
}
function liveRms() {
if (!live.an) return 0;
live.an.getFloatTimeDomainData(live.data);
let s = 0;
for (let i = 0; i < live.data.length; i++) s += live.data[i] * live.data[i];
return Math.sqrt(s / live.data.length);
}
function liveMeterLoop() {
if (!live.on) { live.raf = 0; return; }
const d = 20 * Math.log10(Math.max(liveRms(), 1e-9));
$('liveMeterFill').style.transform = 'scaleX(' + clamp((d + 60) / 60, 0, 1).toFixed(3) + ')';
$('liveMeterVal').textContent = d > -89 ? db(d, 1) + ' dBFS' : '—';
live.raf = requestAnimationFrame(liveMeterLoop);
}
async function liveStart() {
if (live.on) return;
try {
await ensureCtx();
live.gain = audioCtx.createGain();
live.gain.gain.value = 0;
live.an = audioCtx.createAnalyser();
live.an.fftSize = 1024;
live.data = new Float32Array(live.an.fftSize);
live.gain.connect(live.an);
live.an.connect(audioCtx.destination);
live.on = true;
let useWorklet = await ensureWorklet();
if (useWorklet) { try { liveStartWorklet(); } catch (e) { useWorklet = false; } }
if (!useWorklet) liveStartBuffer();
liveApplyLevel();
showStop('live');
$('stageMeta').textContent = 'Живой шум · ' + LABELS[state.liveType] + ' · ' + db(state.liveLevel, 0) + ' dBFS · бесконечно';
if (!live.raf) live.raf = requestAnimationFrame(liveMeterLoop);
mediaMeta();
if (live.kind === 'worklet') {
live.watch = setTimeout(function () {
if (!live.on || live.kind !== 'worklet') return;
if (liveRms() < 1e-6) { liveTeardownSource(); liveStartBuffer(); liveApplyLevel(); }
}, 900);
}
} catch (e) {
live.on = false;
liveTeardownSource();
try { if (live.gain) live.gain.disconnect(); } catch (x) {}
try { if (live.an) live.an.disconnect(); } catch (x) {}
live.gain = null; live.an = null;
resetLab();
pFail('Живой шум не запустился: ' + friendly(e));
}
}
function liveStop() {
if (!live.on) { liveTeardownSource(); return; }
live.on = false;
if (live.raf) { cancelAnimationFrame(live.raf); live.raf = 0; }
const g = live.gain, an = live.an;
live.gain = null; live.an = null;
try { if (g) g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.06); } catch (e) {}
liveTeardownSource();
setTimeout(function () { try { if (g) g.disconnect(); } catch (e) {} try { if (an) an.disconnect(); } catch (e) {} }, 300);
$('liveMeterFill').style.transform = 'scaleX(0)';
$('liveMeterVal').textContent = '—';
resetLab();
mediaMeta();
}
function liveRebuild() {
if (!live.on) return;
if (live.kind === 'worklet') { liveParams(); return; }
const old = { src: live.src, lfo: live.lfo, lg: live.lfoGain };
live.src = null; live.lfo = null; live.lfoGain = null;
liveStartBuffer();
liveApplyLevel();
setTimeout(function () {
try { if (old.src) { old.src.stop(); old.src.disconnect(); } } catch (e) {}
try { if (old.lfo) { old.lfo.stop(); old.lfo.disconnect(); } } catch (e) {}
try { if (old.lg) old.lg.disconnect(); } catch (e) {}
}, 250);
}
$('livePlay').addEventListener('click', function () { stopLab(); liveStop(); ownAbort(); setTimeout(liveStart, 60); });
$('liveStop').addEventListener('click', function () { liveStop(); $('stageMeta').textContent = '— · —'; });

const cc = $('curveCanvas');
function curveAt(x, y) {
const r = cc.getBoundingClientRect();
if (!(r.width > 0)) return;
const pl = 44, pr = 12, pt = 12, pb = 22;
const pw = r.width - pl - pr, ph = r.height - pt - pb;
const nx = clamp((x - r.left - pl) / pw, 0, 1), ny = clamp((y - r.top - pt) / ph, 0, 1);
const i = clamp(Math.floor(nx * curveData.length), 0, curveData.length - 1);
const v = 1 - ny;
if (curveLastIdx >= 0 && curveLastIdx !== i) {
const span = i - curveLastIdx;
for (let k = Math.min(curveLastIdx, i); k <= Math.max(curveLastIdx, i); k++) curveData[k] = clamp(curveLastVal + (v - curveLastVal) * ((k - curveLastIdx) / span), 0, 1);
} else curveData[i] = v;
curveLastIdx = i; curveLastVal = v;
drawCurve();
}
cc.addEventListener('pointerdown', function (e) { curveDrawing = true; curveLastIdx = -1; try { cc.setPointerCapture(e.pointerId); } catch (x) {} curveAt(e.clientX, e.clientY); });
cc.addEventListener('pointermove', function (e) { if (curveDrawing) curveAt(e.clientX, e.clientY); });
cc.addEventListener('pointerup', function () { curveDrawing = false; curveLastIdx = -1; save(); });
cc.addEventListener('pointercancel', function () { curveDrawing = false; curveLastIdx = -1; save(); });
$('curveReset').addEventListener('click', function () { curveData.fill(0.5); curveLastIdx = -1; drawCurve(); save(); });
$('curveGen').addEventListener('click', function () {
nextSeed();
const spec = baseSpec();
spec.source = 'gen'; spec.kind = 'curve'; spec.type = 'curve';
spec.curve = Array.from(curveData); spec.taps = state.curveTaps;
spec.bodyFrames = Math.round(state.curveDur * spec.sr);
spec.channels = 1; spec.padA = 0; spec.padB = 0; spec.fadeIn = 0; spec.fadeOut = 0; spec.loop = false;
job($('curveGen'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'curve', { label: 'Кривая · ' + state.curveTaps + ' отводов' });
});
});
$('signalGen').addEventListener('click', function () {
nextSeed();
const kind = state.signalKind;
const spec = baseSpec();
spec.source = 'signal'; spec.kind = kind;
spec.channels = kind === 'sur51' ? 6 : ((kind === 'sur71' || kind === 'surid') ? 8 : 2);
spec.dur = state.signalDur; spec.level = state.signalLevel; spec.chan = state.signalChan;
spec.padA = 0; spec.padB = 0; spec.fadeIn = 0; spec.fadeOut = 0; spec.loop = false; spec.norm = 'none';
spec.reverb = false;
job($('signalGen'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'sig-' + kind, { label: 'Сигнал · ' + $('signalKind').options[$('signalKind').selectedIndex].text });
});
});
function ditherRun(on) {
const spec = baseSpec();
spec.source = 'dither'; spec.tpdf = on; spec.sr = 44100; spec.channels = 1; spec.bits = 16; spec.dither = false;
spec.padA = 0; spec.padB = 0; spec.fadeIn = 0; spec.fadeOut = 0; spec.loop = false; spec.norm = 'none';
spec.reverb = false;
spec.seed = on ? 424242 : 171717;
job(on ? $('ditherYes') : $('ditherNo'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, on ? 'dither-tpdf' : 'dither-none', { label: 'Тон −90 dBFS · 16 бит · ' + (on ? 'с дизерингом' : 'без дизеринга') });
});
}
$('ditherNo').addEventListener('click', function () { ditherRun(false); });
$('ditherYes').addEventListener('click', function () { ditherRun(true); });
$('calibBtn').addEventListener('click', function () {
nextSeed();
const spec = baseSpec();
spec.source = 'calib'; spec.channels = 2; spec.bits = 16; spec.dither = true;
spec.dur = state.calibDur; spec.band = state.calibBand; spec.chan = state.calibChan;
spec.padA = 0; spec.padB = 0; spec.fadeIn = 0; spec.fadeOut = 0; spec.loop = false; spec.norm = 'none';
spec.reverb = false;
job($('calibBtn'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'calib', { label: 'Калибровка −20 dBFS RMS · ' + (state.calibBand === 'speech' ? '500–2k' : 'полная') + ' · ' + state.calibChan.toUpperCase() });
});
});
$('synthBtn').addEventListener('click', function () {
nextSeed();
const spec = baseSpec();
spec.source = 'gen'; spec.kind = 'synth'; spec.synthType = state.synthType;
spec.drift = state.synthDrift; spec.alpha = state.synthAlpha;
spec.bodyFrames = Math.round(state.synthDur * spec.sr);
spec.channels = 2; spec.padA = 0; spec.padB = 0;
spec.fadeIn = Math.round(0.3 * spec.sr); spec.fadeOut = Math.round(0.5 * spec.sr);
spec.loop = false; spec.exact = false;
const names = { wind: 'Ветер', rain: 'Дождь', surf: 'Прибой' };
job($('synthBtn'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'synth-' + state.synthType, { label: names[state.synthType] + ' · дрейф ' + state.synthDrift + '%' });
});
});
$('percBtn').addEventListener('click', function () {
nextSeed();
const spec = baseSpec();
spec.source = 'perc'; spec.percType = state.percType; spec.channels = 1;
spec.padA = 0; spec.padB = 0; spec.fadeIn = 0; spec.fadeOut = 0; spec.loop = false; spec.norm = 'none';
const names = { snare: 'Барабан', hat: 'Тарелка', kick: 'Бочка' };
job($('percBtn'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'perc-' + state.percType, { label: names[state.percType] });
});
});

function ownSyncUI() {
const m = state.ownMode;
$('ownModeNote').textContent = OWN_NOTE[m];
$('ownSynthDurSection').classList.toggle('hidden', m === 'asis');
$('ownGrainSection').classList.toggle('hidden', m !== 'granular');
$('ownTapsSection').classList.toggle('hidden', m !== 'match');
const loopOk = m !== 'asis';
$('ownLoop').disabled = !loopOk;
$('ownLoop').closest('.switch-row').classList.toggle('dimmed', !loopOk);
$('ownTarget').disabled = state.ownNorm === 'none';
$('ownTargetNum').disabled = state.ownNorm === 'none';
$('ownTargetUnit').textContent = NORM_UNIT[state.ownNorm];
syncReverbUI();
}
function ownInfoUpdate() {
const el = $('ownInfo');
if (!own.arrays) { el.textContent = 'Источник не выбран'; return; }
const n = own.arrays[0].length;
el.textContent = own.name + ' · ' + fmtTimeMs(n / own.sr) + ' · ' + own.sr + ' Гц · ' + (own.ch === 2 ? 'стерео' : 'моно') + ' · ' + fmtSize(n * own.ch * 4) + ' в памяти';
}
function ownAbort() {
if (!own.rec) return;
own.rec = false;
if (own.timer) { clearInterval(own.timer); own.timer = 0; }
try { if (own.node) { own.node.port.postMessage({ stop: true }); own.node.disconnect(); } } catch (e) {}
try { if (own.sp) { own.sp.onaudioprocess = null; own.sp.disconnect(); } } catch (e) {}
try { if (own.sink) own.sink.disconnect(); } catch (e) {}
try { if (own.stream) own.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
own.node = null; own.sp = null; own.sink = null; own.stream = null;
$('ownRec').classList.remove('on');
$('ownRecLabel').textContent = 'Записать';
$('ownMeterFill').style.transform = 'scaleX(0)';
$('ownMeterVal').textContent = '—';
}
function ownCollect(chunks) {
if (!own.rec || !own.chunks) return;
const n = chunks[0].length;
const limit = own.sr * 600;
if (own.frames >= limit) { ownFinish(); return; }
const take = Math.min(n, limit - own.frames);
for (let c = 0; c < own.chunks.length; c++) {
const src = chunks[Math.min(c, chunks.length - 1)];
own.chunks[c].push(take === n ? src.slice(0) : src.slice(0, take));
}
own.frames += take;
const now = Date.now();
if (now - own.meterT > 70) {
own.meterT = now;
let s = 0;
for (let i = 0; i < n; i++) s += chunks[0][i] * chunks[0][i];
const d = 20 * Math.log10(Math.max(Math.sqrt(s / n), 1e-9));
$('ownMeterFill').style.transform = 'scaleX(' + clamp((d + 60) / 60, 0, 1).toFixed(3) + ')';
$('ownMeterVal').textContent = d > -89 ? db(d, 1) + ' dBFS' : '—';
}
if (own.frames >= limit) ownFinish();
}
function ownFinish() {
if (!own.rec) return;
const chunks = own.chunks, frames = own.frames, sr = own.sr;
ownAbort();
if (!chunks || frames < sr * 0.2) { pFail('Запись слишком короткая'); return; }
const arr = [];
for (let c = 0; c < chunks.length; c++) {
const d = new Float32Array(frames);
let p = 0;
for (let i = 0; i < chunks[c].length && p < frames; i++) { const b = chunks[c][i]; const n = Math.min(b.length, frames - p); d.set(b.subarray(0, n), p); p += n; }
arr.push(d);
}
own.chunks = null;
own.arrays = arr; own.sr = sr; own.ch = arr.length; own.name = 'Запись с микрофона';
ownInfoUpdate(); refresh();
ownGenerate();
}
async function ownEnsureRecWorklet() {
if (own.workletTried) return own.workletOk;
own.workletTried = true;
const c = await ensureCtx();
if (!c.audioWorklet) { own.workletOk = false; return false; }
try {
const src = "class WNRec extends AudioWorkletProcessor{constructor(){super();this.on=true;this.port.onmessage=(e)=>{if(e.data&&e.data.stop)this.on=false;};}process(inputs){if(!this.on)return false;const inp=inputs[0];if(inp&&inp.length&&inp[0].length){const n=inp[0].length;const out=[];const tr=[];for(let c=0;c<inp.length;c++){const b=inp[c].slice(0,n);out.push(b);tr.push(b.buffer);}this.port.postMessage(out,tr);}return true;}}registerProcessor('wnl-rec',WNRec);";
await c.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
own.workletOk = true;
} catch (e) { own.workletOk = false; }
return own.workletOk;
}
async function ownStart() {
if (own.rec || state.busy) return;
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { pFail('Браузер не даёт доступ к микрофону. Загрузите файл вместо записи'); return; }
let stream;
try {
stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } } });
} catch (e) {
const n = e && e.name ? e.name : '';
if (n === 'NotAllowedError' || n === 'SecurityError') pFail('Доступ к микрофону запрещён. Разрешите его в настройках сайта или загрузите файл');
else if (n === 'NotFoundError' || n === 'OverconstrainedError') pFail('Микрофон не найден. Загрузите файл вместо записи');
else if (n === 'NotReadableError') pFail('Микрофон занят другим приложением');
else pFail('Не удалось открыть микрофон: ' + friendly(e));
return;
}
try {
const c = await ensureCtx();
own.stream = stream;
own.sr = c.sampleRate;
const track = stream.getAudioTracks()[0];
const settings = track && track.getSettings ? track.getSettings() : {};
const ch = Math.max(1, Math.min(2, settings.channelCount || 1));
own.chunks = []; for (let i = 0; i < ch; i++) own.chunks.push([]);
own.frames = 0; own.rec = true; own.t0 = Date.now(); own.meterT = 0;
const srcNode = c.createMediaStreamSource(stream);
own.sink = c.createGain(); own.sink.gain.value = 0;
own.sink.connect(c.destination);
const useWl = await ownEnsureRecWorklet();
if (useWl) {
const node = new AudioWorkletNode(c, 'wnl-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [ch] });
node.port.onmessage = function (e) { ownCollect(e.data); };
srcNode.connect(node);
node.connect(own.sink);
own.node = node;
} else {
const sp = c.createScriptProcessor(4096, ch, ch);
sp.onaudioprocess = function (e) {
const b = e.inputBuffer;
const out = [];
for (let i = 0; i < b.numberOfChannels; i++) out.push(b.getChannelData(i).slice(0));
ownCollect(out);
};
srcNode.connect(sp); sp.connect(own.sink);
own.sp = sp;
}
own.srcNode = srcNode;
$('ownRec').classList.add('on');
$('ownRecLabel').textContent = 'Остановить';
own.timer = setInterval(function () {
const el = Math.min(600, (Date.now() - own.t0) / 1000);
$('ownTime').textContent = fmtTime(el) + ' / 10:00';
if (el >= 600) ownFinish();
}, 250);
$('ownTime').textContent = '0:00 / 10:00';
} catch (e) {
ownAbort();
pFail('Запись не запустилась: ' + friendly(e));
}
}
function ownSpec() {
const m = state.ownMode;
const sr = own.sr;
const spec = {
sr: sr, channels: own.ch, bits: state.bitDepth, dither: state.dither,
norm: state.ownNorm, target: state.ownTarget, seed: state.seed,
fftSize: state.fftSize, window: state.window, dist: 'uniform', tilt: state.ownTilt,
reverb: state.ownReverb, reverbPreset: state.ownPreset, reverbWet: state.ownWet,
padA: Math.round(state.ownPadA * sr), padB: Math.round(state.ownPadB * sr),
fadeIn: Math.round(state.ownFadeIn * sr), fadeOut: Math.round(state.ownFadeOut * sr),
loop: m !== 'asis' && state.ownLoop
};
if (m === 'asis') {
spec.source = 'arrays';
spec.kind = 'own';
spec.arrays = own.arrays.map(function (a) { return a.slice(); });
spec.bodyFrames = own.arrays[0].length;
spec.loop = false;
} else {
spec.source = 'arrays';
spec.kind = m;
spec.arrays = own.arrays.map(function (a) { return a.slice(); });
spec.bodyFrames = Math.max(1, Math.round(state.ownDur * sr));
spec.taps = state.ownTaps;
spec.grain = state.ownGrain;
}
return spec;
}
function ownGenerate() {
if (!own.arrays || state.busy) return;
nextSeed();
const spec = ownSpec();
const names = { asis: 'Свой звук', match: 'Спектральный двойник', granular: 'Гранулярная текстура' };
job($('ownGen'), 'Генерация…', async function (hooks) {
const r = await runDsp('run', spec, hooks);
applyResult(r, 'own-' + state.ownMode, { label: names[state.ownMode] + (state.ownReverb ? ' · пространство' : '') });
});
}
$('ownRec').addEventListener('click', function () { if (own.rec) ownFinish(); else ownStart(); });
$('ownFile').addEventListener('change', function () {
const f = $('ownFile').files[0]; if (!f) return;
ownAbort();
job($('ownGen'), 'Генерация…', async function (hooks) {
hooks.progress(0.05, 'Чтение файла'); await tick();
const ab = await readBuf(f);
pBusy('Декодирование'); await tick();
const c = await ensureCtx();
let dec;
try { dec = await c.decodeAudioData(ab); } catch (e) { throw new Error('Не удалось прочитать аудио — WAV, MP3, OGG, M4A, FLAC'); }
const sr = dec.sampleRate, len = dec.length, ch = Math.min(2, dec.numberOfChannels);
if (len / sr > 600) throw new Error('Файл длиннее 10 минут');
if (len * ch * 4 > 300 * 1048576) throw new Error('Файл слишком большой для обработки в памяти');
const arr = [];
for (let k = 0; k < ch; k++) arr.push(dec.getChannelData(k).slice());
dec = null;
own.arrays = arr; own.sr = sr; own.ch = ch; own.name = f.name;
$('ownFileName').textContent = f.name;
ownInfoUpdate();
const spec = ownSpec();
const names = { asis: 'Свой звук', match: 'Спектральный двойник', granular: 'Гранулярная текстура' };
const r = await runDsp('run', spec, hooks);
applyResult(r, 'own-' + state.ownMode, { label: names[state.ownMode] + (state.ownReverb ? ' · пространство' : '') });
});
});
$('ownMode').addEventListener('change', function () { state.ownMode = $('ownMode').value; ownSyncUI(); save(); });
$('ownTaps').addEventListener('change', function () { state.ownTaps = parseInt($('ownTaps').value, 10); save(); });
$('ownNorm').addEventListener('change', function () { state.ownNorm = $('ownNorm').value; state.ownTarget = NORM_DEF[state.ownNorm]; $('ownTarget').value = state.ownTarget; $('ownTargetNum').value = state.ownTarget; ownSyncUI(); save(); });
$('ownReverb').addEventListener('change', function () { state.ownReverb = $('ownReverb').checked; syncReverbUI(); save(); });
$('ownReverbPreset').addEventListener('change', function () { state.ownPreset = $('ownReverbPreset').value; save(); });
$('ownLoop').addEventListener('change', function () { state.ownLoop = $('ownLoop').checked; save(); });
$('ownGen').addEventListener('click', ownGenerate);
$('ownWav').addEventListener('click', function () { $('dlWavBtn').click(); });
$('ownMp3').addEventListener('click', function () { $('dlMp3Btn').click(); });

const wf = $('waveform');
let wDrag = null;
function waveFrac(e) {
const r = wf.getBoundingClientRect();
return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
}
function waveZoom(factor, anchor) {
if (!state.analysis) return;
const span = waveView.b - waveView.a;
const ns = clamp(span * factor, 0.0005, 1);
const a = waveView.a + (span - ns) * anchor;
waveView.a = clamp(a, 0, 1 - ns);
waveView.b = waveView.a + ns;
drawWave();
}
wf.addEventListener('pointerdown', function (e) {
if (!state.analysis || !(audioEl.duration > 0)) return;
try { wf.setPointerCapture(e.pointerId); } catch (x) {}
const f = waveFrac(e);
wDrag = { f: f, x: e.clientX, pan: e.shiftKey, a: waveView.a, b: waveView.b, moved: false };
});
wf.addEventListener('pointermove', function (e) {
if (!wDrag) return;
if (Math.abs(e.clientX - wDrag.x) > 3) wDrag.moved = true;
if (!wDrag.moved) return;
const f = waveFrac(e);
if (wDrag.pan) {
const span = wDrag.b - wDrag.a;
const d = (wDrag.f - f) * span;
const a = clamp(wDrag.a + d, 0, 1 - span);
waveView.a = a; waveView.b = a + span;
} else {
const t0 = waveView.a + (waveView.b - waveView.a) * wDrag.f;
const t1 = waveView.a + (waveView.b - waveView.a) * f;
waveView.sa = Math.min(t0, t1); waveView.sb = Math.max(t0, t1);
}
drawWave();
});
function waveEnd(e) {
if (!wDrag) return;
const d = wDrag; wDrag = null;
if (!d.moved && audioEl.duration > 0) {
const t = waveView.a + (waveView.b - waveView.a) * d.f;
audioEl.currentTime = clamp(t, 0, 0.999) * audioEl.duration;
seekBar.value = Math.floor(audioEl.currentTime / audioEl.duration * 1000);
timeText(); updateMeters(); drawWave();
} else if (!d.pan && waveView.sb - waveView.sa < 0.0008) {
waveView.sa = -1; waveView.sb = -1; drawWave();
}
}
wf.addEventListener('pointerup', waveEnd);
wf.addEventListener('pointercancel', function () { wDrag = null; });
wf.addEventListener('wheel', function (e) {
if (!state.analysis) return;
e.preventDefault();
waveZoom(e.deltaY < 0 ? 0.8 : 1.25, waveFrac(e));
}, { passive: false });
wf.addEventListener('dblclick', function () {
waveView.a = 0; waveView.b = 1; waveView.sa = -1; waveView.sb = -1; drawWave();
});
$('waveZoomIn').addEventListener('click', function () { waveZoom(0.6, 0.5); });
$('waveZoomOut').addEventListener('click', function () { waveZoom(1.6, 0.5); });
$('waveFit').addEventListener('click', function () { waveView.a = 0; waveView.b = 1; drawWave(); });
$('waveSelClear').addEventListener('click', function () { waveView.sa = -1; waveView.sb = -1; drawWave(); });

$('viewToggle').addEventListener('click', function (e) { const b = e.target.closest('.view-btn'); if (!b || b.disabled) return; setView(b.dataset.view); });
function cursor(e) {
const a = state.analysis; if (!a) return;
const r = e.currentTarget.getBoundingClientRect();
const pw = r.width - PAD.l - PAD.r, ph = r.height - PAD.t - PAD.b;
const x = e.clientX - r.left - PAD.l, y = e.clientY - r.top - PAD.t;
if (x < 0 || y < 0 || x > pw || y > ph) { $('cursorRead').innerHTML = ''; return; }
const lg = gainDb();
let txt;
if (e.currentTarget === $('spectroCanvas')) {
const fq = normFreq(1 - y / ph);
const k = clamp(Math.round(fq * a.fftSize / state.sr), 1, a.half - 1);
const col = clamp(Math.floor(x / pw * a.cols), 0, a.cols - 1);
const d = 10 * Math.log10(Math.max(a.spectra[col * a.half + k], 1e-20)) + lg;
txt = '<span>t ' + fmtTime(col * a.hop / state.sr) + '</span><span>f ' + (fq >= 1000 ? num(fq / 1000, 2) + ' кГц' : num(fq, 0) + ' Гц') + '</span><span>' + db(d, 1) + ' dBFS</span>';
} else {
const fq = normFreq(x / pw);
const k = clamp(Math.round(fq * a.fftSize / state.sr), 1, a.half - 1);
const d = 10 * Math.log10(Math.max(a.avg[k], 1e-20)) + lg;
txt = '<span>f ' + (fq >= 1000 ? num(fq / 1000, 2) + ' кГц' : num(fq, 0) + ' Гц') + '</span><span>' + db(d, 1) + ' dBFS</span><span>усреднение по ' + a.cols + ' окнам</span>';
}
$('cursorRead').innerHTML = txt;
}
$('spectroCanvas').addEventListener('pointermove', cursor);
$('welchCanvas').addEventListener('pointermove', cursor);
$('spectroCanvas').addEventListener('pointerleave', function () { $('cursorRead').innerHTML = ''; });
$('welchCanvas').addEventListener('pointerleave', function () { $('cursorRead').innerHTML = ''; });

$('tabs').addEventListener('click', function (e) {
const t = e.target.closest('.tab'); if (!t) return;
if (state.mode === 'lab' && t.dataset.tab !== 'lab') { stopLab(); liveStop(); ownAbort(); resetLab(); }
$('tabs').querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
t.classList.add('active'); t.setAttribute('aria-selected', 'true');
state.mode = t.dataset.tab;
$('generatorSidebar').classList.toggle('hidden', state.mode !== 'generate');
$('mixSidebar').classList.toggle('hidden', state.mode !== 'mix');
$('labSidebar').classList.toggle('hidden', state.mode !== 'lab');
$('stageLabel').textContent = state.mode === 'mix' ? 'Наложение' : (state.mode === 'lab' ? 'Лаборатория' : 'Визуализация');
syncView(); save();
});
$('labTools').addEventListener('click', function (e) {
const b = e.target.closest('.lab-tool'); if (!b) return;
stopLab(); liveStop(); ownAbort(); resetLab();
$('labTools').querySelectorAll('.lab-tool').forEach(function (x) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
b.classList.add('active'); b.setAttribute('aria-checked', 'true');
state.labTool = b.dataset.tool;
document.querySelectorAll('.lab-panel').forEach(function (p) { p.classList.toggle('hidden', p.dataset.panel !== state.labTool); });
syncView(); save();
});
document.addEventListener('keydown', function (e) {
const t = e.target, tag = t && t.tagName ? t.tagName : '';
const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
const knob = t && t.classList && t.classList.contains('knob');
if (e.code === 'Space') { if (typing || tag === 'BUTTON' || knob) return; e.preventDefault(); togglePlay(); }
else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { if (typing || knob) return; e.preventDefault(); seekBy((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 5)); }
else if (e.code === 'Home') { if (typing || knob) return; e.preventDefault(); seekBy(-1e9); }
else if (e.code === 'Escape') { if (state.busy) cancelJob(); else if (own.rec) ownFinish(); }
});
if (typeof ResizeObserver === 'function') {
new ResizeObserver(function () { if (resizeRaf) cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; renderView(); }); }).observe($('visualizer'));
new ResizeObserver(measureRail).observe($('progressTrack'));
} else window.addEventListener('resize', function () { renderView(); measureRail(); });
window.addEventListener('beforeunload', function () { ownAbort(); if (state.url) URL.revokeObjectURL(state.url); save(); });

initWorker();
initMedia();
$('tabs').querySelectorAll('.tab').forEach(function (x) { const on = x.dataset.tab === state.mode; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
$('generatorSidebar').classList.toggle('hidden', state.mode !== 'generate');
$('mixSidebar').classList.toggle('hidden', state.mode !== 'mix');
$('labSidebar').classList.toggle('hidden', state.mode !== 'lab');
$('labTools').querySelectorAll('.lab-tool').forEach(function (x) { const on = x.dataset.tool === state.labTool; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
document.querySelectorAll('.lab-panel').forEach(function (p) { p.classList.toggle('hidden', p.dataset.panel !== state.labTool); });
$('sampleRateSelect').value = String(state.sampleRate);
$('bitDepthSelect').value = String(state.bitDepth);
$('dlBitDepth').value = String(state.dlBits);
$('mp3Rate').value = String(state.mp3Rate);
$('ditherToggle').checked = state.dither;
$('keepLevelToggle').checked = state.keepLevel;
$('exactToggle').checked = state.exact;
$('reverbToggle').checked = state.reverb;
$('reverbPreset').value = state.reverbPreset;
$('liveReverbToggle').checked = state.liveReverb;
$('liveReverbPreset').value = state.liveReverbPreset;
$('curveTaps').value = String(state.curveTaps);
$('signalKind').value = state.signalKind;
$('ownMode').value = state.ownMode;
$('ownTaps').value = String(state.ownTaps);
$('ownNorm').value = state.ownNorm;
$('ownReverb').checked = state.ownReverb;
$('ownReverbPreset').value = state.ownPreset;
$('ownLoop').checked = state.ownLoop;
$('seedNum').value = state.seed;
$('seedLock').classList.toggle('active', state.seedAuto);
$('seedLock').textContent = state.seedAuto ? 'Авто' : 'Фикс';
$('fftSize').value = String(state.fftSize);
$('fftWindow').value = state.window;
$('freqScale').value = state.freqScale;
$('specTop').value = state.specTop; $('specTopVal').textContent = db(state.specTop, 0);
$('specRange').value = state.specRange; $('specRangeVal').textContent = state.specRange;
$('volume').value = state.volume; $('volNum').textContent = state.volume + '%';
audioEl.volume = state.volume / 100;
[['channelSegmented', 'channels', String(state.channels)], ['distSegmented', 'dist', state.dist], ['signalChannel', 'schan', state.signalChan], ['calibBand', 'band', state.calibBand], ['calibChannel', 'cchan', state.calibChan], ['synthType', 'synth', state.synthType], ['percType', 'perc', state.percType], ['notchTimer', 'min', String(state.notchTimer)], ['binTimer', 'min', String(state.binTimer)]].forEach(function (g) {
$(g[0]).querySelectorAll('.seg').forEach(function (x) { const on = x.dataset[g[1]] === g[2]; x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
});
syncNormUI();
syncDitherUI();
syncSignalUI();
syncCurveRange();
ownSyncUI();
ownInfoUpdate();
setLoop(state.loop);
$('tiltNote').textContent = 'Добавляет ' + db(-3.0103 * state.tilt, 2) + ' дБ/окт к выбранному виду шума';
estimate();
measureRail();
syncView();
refresh();
showVisual(curveMode() ? 'curve' : 'empty');
if (curveMode()) drawCurve();
})();
