(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const ALL_TYPES = ['white', 'pink', 'brown', 'blue', 'violet', 'green', 'grey'];
const TYPE_LABELS = { white: 'Белый', pink: 'Розовый', brown: 'Коричневый', blue: 'Синий', violet: 'Фиолетовый', green: 'Зелёный', grey: 'Серый' };
const TYPE_COLORS = { white: '#e8e2da', pink: '#dba9a3', brown: '#8f6b47', blue: '#7d8fa8', violet: '#9b7fa8', green: '#88a383', grey: '#8a8278' };
const SIZE_LIMIT = 320 * 1024 * 1024;
const DECODE_LIMIT = 340 * 1024 * 1024;
const FILE_LIMIT = 180 * 1024 * 1024;
const BUCKETS = 1600;
const CHUNK = 32768;
const MP3_CHUNK = 4608;
const SLICE_MS = 20;
const CEILING = Math.pow(10, -0.3 / 20);
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const NORM_DEFAULT = { peak: -1, rms: -20, lufs: -16 };
const NORM_NOTE = {
peak: 'Пик выравнивает самый громкий отсчёт, из-за этого коричневый шум звучит тише белого',
rms: 'RMS выравнивает среднюю мощность — все виды шума звучат одинаково громко',
lufs: 'LUFS считает громкость так, как её слышит человек, с фильтром K-weighting и отсечением тихих участков'
};

const state = {
mode: 'generate',
type: 'white',
mixType: 'pink',
testType: 'white',
duration: 60,
sampleRate: 44100,
bitDepth: 24,
channels: 2,
format: 'wav',
mp3Bitrate: 192,
normMode: 'peak',
normTarget: -1,
fadeIn: 0,
fadeOut: 0,
padStart: 0,
padEnd: 0,
loop: false,
snrDb: -20,
notchFreq: 1000,
notchQ: 12,
binBase: 200,
binBeat: 6,
rot8dSpeed: 3,
curveDur: 20,
calibDur: 30,
synthDur: 30,
notchTimer: 0,
binTimer: 0,
labTool: 'notch',
synthType: 'wind',
percType: 'snare',
mixFile: null,
peaks: null,
resultDuration: 0,
resultSr: 44100,
resultKey: 'noise',
resultExt: 'wav',
allowMp3: true,
blob: null,
blobUrl: null,
busy: false,
seeking: false,
tooBig: false
};

let audioCtx = null;
let labSession = null;
let stageView = 'wave';
let spectroData = null;
let spectroImg = null;
let lamePromise = null;
let progressTimer = null;
let progressP = 0;
let railW = 0;
let resizeRaf = 0;
let curveLastIdx = -1;
let curveLastVal = 0.5;
let curveDrawing = false;
const loopCache = new Map();
const curveData = new Float32Array(400);
curveData.fill(0.5);

const yieldToUI = (function () {
if (typeof MessageChannel === 'function') {
const ch = new MessageChannel();
const queue = [];
ch.port1.onmessage = function () { const r = queue.shift(); if (r) r(); };
return function () { return new Promise(function (res) { queue.push(res); ch.port2.postMessage(0); }); };
}
return function () { return new Promise(function (res) { setTimeout(res, 0); }); };
})();

function makeRng(seed) {
let a = (seed >>> 0) || 1;
return function () {
a = (a + 0x6D2B79F5) >>> 0;
let t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
function randomSeed() { return (Math.random() * 4294967295) >>> 0; }

function updateBiquad(f, kind, fc, q, gainDb, sr) {
const nyq = sr * 0.5;
fc = clamp(fc, 8, nyq * 0.94);
q = Math.max(0.05, q);
const w0 = 2 * Math.PI * fc / sr;
const cw = Math.cos(w0), sw = Math.sin(w0);
let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
if (kind === 'lowpass') {
const al = sw / (2 * q);
b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
} else if (kind === 'highpass') {
const al = sw / (2 * q);
b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
} else if (kind === 'bandpass') {
const al = sw / (2 * q);
b0 = al; b1 = 0; b2 = -al;
a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
} else if (kind === 'peaking') {
const A = Math.pow(10, gainDb / 40), al = sw / (2 * q);
b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A;
a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
} else if (kind === 'lowshelf') {
const A = Math.pow(10, gainDb / 40), al = sw / 2 * Math.SQRT2, t = 2 * Math.sqrt(A) * al;
b0 = A * ((A + 1) - (A - 1) * cw + t);
b1 = 2 * A * ((A - 1) - (A + 1) * cw);
b2 = A * ((A + 1) - (A - 1) * cw - t);
a0 = (A + 1) + (A - 1) * cw + t;
a1 = -2 * ((A - 1) + (A + 1) * cw);
a2 = (A + 1) + (A - 1) * cw - t;
} else {
const A = Math.pow(10, gainDb / 40), al = sw / 2 * Math.SQRT2, t = 2 * Math.sqrt(A) * al;
b0 = A * ((A + 1) + (A - 1) * cw + t);
b1 = -2 * A * ((A - 1) + (A + 1) * cw);
b2 = A * ((A + 1) + (A - 1) * cw - t);
a0 = (A + 1) - (A - 1) * cw + t;
a1 = 2 * ((A - 1) - (A + 1) * cw);
a2 = (A + 1) - (A - 1) * cw - t;
}
f.b0 = b0 / a0; f.b1 = b1 / a0; f.b2 = b2 / a0; f.a1 = a1 / a0; f.a2 = a2 / a0;
return f;
}
function biquad(kind, fc, q, gainDb, sr) {
return updateBiquad({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }, kind, fc, q, gainDb, sr);
}
function bq(f, x) {
const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
return y;
}
function rawBiquad(b0, b1, b2, a0, a1, a2) {
return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function filteredGen(filters, rnd) {
const nf = filters.length;
return function (out, n) {
for (let i = 0; i < n; i++) {
let v = rnd() * 2 - 1;
for (let k = 0; k < nf; k++) v = bq(filters[k], v);
out[i] = v;
}
};
}
function createNoiseGen(type, sr, seed) {
const rnd = makeRng(seed);
if (type === 'pink') {
let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
return function (out, n) {
for (let i = 0; i < n; i++) {
const w = rnd() * 2 - 1;
b0 = 0.99886 * b0 + w * 0.0555179;
b1 = 0.99332 * b1 + w * 0.0750759;
b2 = 0.96900 * b2 + w * 0.1538520;
b3 = 0.86650 * b3 + w * 0.3104856;
b4 = 0.55000 * b4 + w * 0.5329522;
b5 = -0.7616 * b5 - w * 0.0168980;
out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
b6 = w * 0.115926;
}
};
}
if (type === 'brown') {
let last = 0;
return function (out, n) {
for (let i = 0; i < n; i++) {
last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
out[i] = last * 3.5;
}
};
}
if (type === 'blue') {
let prev = 0;
return function (out, n) {
for (let i = 0; i < n; i++) {
const w = rnd() * 2 - 1;
out[i] = (w - prev) * 0.5;
prev = w;
}
};
}
if (type === 'violet') {
let prev = 0, prev2 = 0;
return function (out, n) {
for (let i = 0; i < n; i++) {
const w = rnd() * 2 - 1;
out[i] = (w - 2 * prev + prev2) * 0.25;
prev2 = prev; prev = w;
}
};
}
if (type === 'green') {
return filteredGen([biquad('bandpass', 500, 0.8, 0, sr), biquad('bandpass', 500, 0.8, 0, sr)], rnd);
}
if (type === 'grey') {
return filteredGen([
biquad('lowshelf', 250, 1, 12, sr),
biquad('lowshelf', 70, 1, 24, sr),
biquad('lowshelf', 25, 1, 14, sr),
biquad('peaking', 3200, 1.4, -5, sr),
biquad('highshelf', 7000, 1, 14, sr),
biquad('lowpass', 16000, 0.707, 0, sr)
], rnd);
}
return function (out, n) { for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1; };
}
function buildCurveFilters(curve, sr) {
const fMin = 20, fMax = Math.min(20000, sr * 0.47);
const bands = 24;
const filters = [biquad('highpass', 18, 0.707, 0, sr)];
for (let b = 0; b < bands; b++) {
const t = (b + 0.5) / bands;
const f = fMin * Math.pow(fMax / fMin, t);
const idx = clamp(Math.floor(t * curve.length), 0, curve.length - 1);
const v = curve[idx];
let db = (v - 0.5) * 26;
if (v <= 0.02) db = -55;
if (Math.abs(db) < 0.2) continue;
filters.push(biquad('peaking', f, 2.4, db, sr));
}
filters.push(biquad('lowpass', fMax, 0.707, 0, sr));
return filters;
}
function createSynthGen(kind, sr, seed) {
const rnd = makeRng(seed);
const f = kind === 'rain'
? biquad('highpass', 2000, 0.5, 0, sr)
: (kind === 'surf' ? biquad('lowpass', 1200, 1.2, 0, sr) : biquad('lowpass', 600, 3, 0, sr));
const twoPi = 2 * Math.PI;
let ctl = 0, index = 0, amp = kind === 'rain' ? 0.35 : 0.4;
return function (out, n) {
for (let i = 0; i < n; i++) {
if (ctl === 0) {
const t = index / sr;
if (kind === 'wind') {
updateBiquad(f, 'lowpass', 600 + 350 * Math.sin(twoPi * 0.15 * t) + 120 * Math.sin(twoPi * 0.037 * t), 3, 0, sr);
amp = 0.4;
} else if (kind === 'surf') {
amp = 0.4 + 0.3 * Math.sin(twoPi * 0.08 * t);
}
ctl = 64;
}
ctl--; index++;
out[i] = bq(f, rnd() * 2 - 1) * amp;
}
};
}

function makeFFT(n) {
const levels = Math.round(Math.log2(n));
const rev = new Uint32Array(n);
for (let i = 0; i < n; i++) {
let x = i, r = 0;
for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
rev[i] = r;
}
const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2);
for (let i = 0; i < n / 2; i++) {
cosT[i] = Math.cos(2 * Math.PI * i / n);
sinT[i] = Math.sin(2 * Math.PI * i / n);
}
return function (re, im) {
for (let i = 0; i < n; i++) {
const j = rev[i];
if (j > i) {
let t = re[i]; re[i] = re[j]; re[j] = t;
t = im[i]; im[i] = im[j]; im[j] = t;
}
}
for (let size = 2; size <= n; size *= 2) {
const half = size / 2, step = n / size;
for (let i = 0; i < n; i += size) {
for (let j = i, k = 0; j < i + half; j++, k += step) {
const c = cosT[k], s = -sinT[k];
const tre = re[j + half] * c - im[j + half] * s;
const tim = re[j + half] * s + im[j + half] * c;
re[j + half] = re[j] - tre; im[j + half] = im[j] - tim;
re[j] += tre; im[j] += tim;
}
}
}
};
}
function createSpectro(sr, totalFrames) {
const N = 2048;
const cols = clamp(Math.floor(totalFrames / 220), 24, 560);
const rows = 192;
const hop = Math.max(1, Math.floor(totalFrames / cols));
const fft = makeFFT(N);
const re = new Float64Array(N), im = new Float64Array(N);
const ring = new Float32Array(N);
const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
const grid = new Float32Array(cols * rows);
const fMin = 20, fMax = Math.min(20000, sr / 2);
const binStart = new Int32Array(rows), binEnd = new Int32Array(rows);
for (let r = 0; r < rows; r++) {
const f0 = fMin * Math.pow(fMax / fMin, r / rows);
const f1 = fMin * Math.pow(fMax / fMin, (r + 1) / rows);
const k0 = clamp(Math.floor(f0 * N / sr), 1, N / 2 - 1);
const k1 = clamp(Math.ceil(f1 * N / sr), k0 + 1, N / 2);
binStart[r] = k0; binEnd[r] = k1;
}
let ringPos = 0, col = 0, nextAt = hop;
function column() {
for (let i = 0; i < N; i++) {
re[i] = ring[(ringPos + i) & (N - 1)] * win[i];
im[i] = 0;
}
fft(re, im);
const base = col * rows;
for (let r = 0; r < rows; r++) {
let sum = 0;
const a = binStart[r], b = binEnd[r];
for (let k = a; k < b; k++) sum += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
const mag = sum / (b - a) / (N / 4);
grid[base + r] = 20 * Math.log10(mag + 1e-12);
}
col++;
}
return {
feed: function (bufs, n, startIdx) {
for (let i = 0; i < n; i++) {
ring[ringPos] = bufs[0][i];
ringPos = (ringPos + 1) & (N - 1);
if (startIdx + i === nextAt && col < cols) { column(); nextAt += hop; }
}
},
result: function () {
while (col < cols) { column(); nextAt += hop; }
return { grid: grid, cols: cols, rows: rows, fMin: fMin, fMax: fMax };
}
};
}
function createLufsMeter(sr, ch) {
const sub = Math.max(1, Math.round(sr * 0.1));
const shelf = [], hp = [], sums = [];
for (let c = 0; c < ch; c++) {
let K = Math.tan(Math.PI * 1681.974450955533 / sr);
const Vh = Math.pow(10, 3.99984385397334 / 20);
const Vb = Math.pow(Vh, 0.4996667741545416);
let a0 = 1 + K / 0.7071752369554196 + K * K;
shelf.push(rawBiquad(
Vh + Vb * K / 0.7071752369554196 + K * K,
2 * (K * K - Vh),
Vh - Vb * K / 0.7071752369554196 + K * K,
a0, 2 * (K * K - 1), 1 - K / 0.7071752369554196 + K * K
));
K = Math.tan(Math.PI * 38.13547087602444 / sr);
a0 = 1 + K / 0.5003270373238773 + K * K;
hp.push(rawBiquad(1, -2, 1, a0, 2 * (K * K - 1), 1 - K / 0.5003270373238773 + K * K));
sums.push([]);
}
const acc = new Float64Array(ch);
let idx = 0, flushed = false;
return {
feed: function (bufs, n) {
for (let i = 0; i < n; i++) {
for (let c = 0; c < ch; c++) {
const v = bq(hp[c], bq(shelf[c], bufs[c][i]));
acc[c] += v * v;
}
idx++;
if (idx === sub) {
for (let c = 0; c < ch; c++) { sums[c].push(acc[c]); acc[c] = 0; }
idx = 0;
}
}
},
value: function () {
if (!flushed) {
if (idx > 0) for (let c = 0; c < ch; c++) sums[c].push(acc[c] * sub / idx);
flushed = true;
}
const nSub = sums[0].length;
if (!nSub) return -Infinity;
const per = Math.min(4, nSub);
const denom = per === 4 ? per * sub : nSub * sub;
const powers = [];
for (let j = 0; j + per <= nSub; j++) {
let p = 0;
for (let c = 0; c < ch; c++) {
let s = 0;
for (let k = j; k < j + per; k++) s += sums[c][k];
p += s / denom;
}
powers.push(p);
}
if (!powers.length) return -Infinity;
const loud = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
const abs = powers.filter((p) => loud(p) > -70);
if (!abs.length) return -Infinity;
const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
const rel = loud(mean) - 10;
const gated = abs.filter((p) => loud(p) > rel);
if (!gated.length) return loud(mean);
return loud(gated.reduce((a, b) => a + b, 0) / gated.length);
}
};
}

function bytesPerSample(bitDepth) { return bitDepth === 16 ? 2 : (bitDepth === 24 ? 3 : 4); }
function toInt16(v) {
const s = v > 1 ? 1 : (v < -1 ? -1 : v);
return Math.round(s * 32767);
}
function makeWriter(bitDepth) {
if (bitDepth === 16) return function (dv, p, v) { dv.setInt16(p, toInt16(v), true); };
if (bitDepth === 24) {
return function (dv, p, v) {
const s = v > 1 ? 1 : (v < -1 ? -1 : v);
let q = Math.round(s * 8388607);
if (q > 8388607) q = 8388607; else if (q < -8388608) q = -8388608;
dv.setUint8(p, q & 255);
dv.setUint8(p + 1, (q >> 8) & 255);
dv.setUint8(p + 2, (q >> 16) & 255);
};
}
return function (dv, p, v) { dv.setFloat32(p, v > 1 ? 1 : (v < -1 ? -1 : v), true); };
}
function wavHeader(sr, ch, bitDepth, dataSize) {
const bps = bytesPerSample(bitDepth);
const ab = new ArrayBuffer(44);
const dv = new DataView(ab);
let p = 0;
const ws = function (s) { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
ws('RIFF'); dv.setUint32(p, 36 + dataSize, true); p += 4;
ws('WAVE'); ws('fmt '); dv.setUint32(p, 16, true); p += 4;
dv.setUint16(p, bitDepth === 32 ? 3 : 1, true); p += 2;
dv.setUint16(p, ch, true); p += 2;
dv.setUint32(p, sr, true); p += 4;
dv.setUint32(p, sr * ch * bps, true); p += 4;
dv.setUint16(p, ch * bps, true); p += 2;
dv.setUint16(p, bitDepth, true); p += 2;
ws('data'); dv.setUint32(p, dataSize, true);
return new Uint8Array(ab);
}
function createWavSink(sr, ch, bitDepth, totalFrames) {
const bps = bytesPerSample(bitDepth);
const parts = [wavHeader(sr, ch, bitDepth, totalFrames * ch * bps)];
const writer = makeWriter(bitDepth);
return {
ext: 'wav',
write: function (bufs, n) {
const ab = new ArrayBuffer(n * ch * bps);
const dv = new DataView(ab);
let p = 0;
for (let i = 0; i < n; i++) {
for (let c = 0; c < ch; c++) { writer(dv, p, bufs[c][i]); p += bps; }
}
parts.push(new Uint8Array(ab));
},
finish: function () {
const b = new Blob(parts, { type: 'audio/wav' });
parts.length = 0;
return b;
}
};
}
function createMp3Sink(sr, ch, kbps) {
const enc = new window.lamejs.Mp3Encoder(ch, sr, kbps);
const parts = [];
const l = new Int16Array(CHUNK), r = new Int16Array(CHUNK);
return {
ext: 'mp3',
write: function (bufs, n) {
for (let i = 0; i < n; i++) {
l[i] = toInt16(bufs[0][i]);
if (ch > 1) r[i] = toInt16(bufs[1][i]);
}
const d = ch > 1 ? enc.encodeBuffer(l.subarray(0, n), r.subarray(0, n)) : enc.encodeBuffer(l.subarray(0, n));
if (d.length) parts.push(new Int8Array(d));
},
finish: function () {
const d = enc.flush();
if (d.length) parts.push(new Int8Array(d));
const b = new Blob(parts, { type: 'audio/mpeg' });
parts.length = 0;
return b;
}
};
}
function loadScript(src) {
return new Promise(function (res, rej) {
const s = document.createElement('script');
s.src = src;
s.async = true;
s.onload = function () { res(); };
s.onerror = function () { s.remove(); rej(new Error('load')); };
document.head.appendChild(s);
});
}
async function ensureLame() {
if (window.lamejs && window.lamejs.Mp3Encoder) return window.lamejs;
if (!lamePromise) {
lamePromise = (async function () {
const urls = [
'lame.min.js',
'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
'https://unpkg.com/lamejs@1.2.1/lame.min.js'
];
for (let i = 0; i < urls.length; i++) {
try {
await loadScript(urls[i]);
if (window.lamejs && window.lamejs.Mp3Encoder) return window.lamejs;
} catch (e) {}
}
lamePromise = null;
throw new Error('MP3-кодировщик не загрузился. Положите файл lame.min.js рядом с index.html или включите интернет. WAV работает всегда');
})();
}
return lamePromise;
}
function mp3TargetRate(sr) {
return MP3_RATES.indexOf(sr) >= 0 ? sr : 44100;
}
function readBuffer(file) {
if (file.arrayBuffer) return file.arrayBuffer();
return new Promise(function (res, rej) {
const fr = new FileReader();
fr.onload = function () { res(fr.result); };
fr.onerror = function () { rej(new Error('Не удалось прочитать файл')); };
fr.readAsArrayBuffer(file);
});
}

function estimateSize(seconds, sr, channels, bitDepth, format, kbps) {
if (format === 'mp3') return Math.round(seconds * kbps * 1000 / 8);
return 44 + Math.round(seconds * sr) * channels * bytesPerSample(bitDepth);
}
function fmtTime(sec) {
sec = Math.max(0, Math.floor(sec || 0));
const m = Math.floor(sec / 60), s = sec % 60;
return m + ':' + (s < 10 ? '0' : '') + s;
}
function fmtSize(bytes) {
if (bytes < 1024) return bytes + ' Б';
if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' КБ';
return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
}
function fmtDb(v) {
if (!isFinite(v)) return '—';
return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',');
}
function fmtDc(v) {
return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(5).replace('.', ',');
}
function stamp() {
const d = new Date();
const p = (v) => (v < 10 ? '0' : '') + v;
return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes());
}
function friendlyError(e) {
const m = e && e.message ? e.message : String(e || '');
if (/allocat|out of memory|Array buffer|RangeError/i.test(m)) {
return 'Не хватило памяти. Уменьшите длительность или частоту, выберите 16 бит, моно или формат MP3';
}
return m || 'Неизвестная ошибка';
}

const progressDock = $('progressDock');
const progressSquare = $('progressSquare');
function applyProgressTransform() {
progressSquare.style.setProperty('--x', (railW * progressP).toFixed(1) + 'px');
progressSquare.style.setProperty('--drift', railW.toFixed(1) + 'px');
progressDock.style.setProperty('--p', progressP.toFixed(4));
}
function measureRail() {
railW = Math.max(0, $('progressTrack').clientWidth - 16);
applyProgressTransform();
}
function progressSet(p, label) {
if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
progressDock.dataset.state = 'work';
progressP = clamp(p, 0, 1);
applyProgressTransform();
$('progressLabel').textContent = label;
$('progressPercent').textContent = Math.round(progressP * 100) + '%';
}
function progressBusy(label) {
if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
progressDock.dataset.state = 'busy';
$('progressLabel').textContent = label;
$('progressPercent').textContent = '';
}
function progressIdle() {
progressDock.dataset.state = 'idle';
progressP = 0;
applyProgressTransform();
$('progressLabel').textContent = 'Готов к работе';
$('progressPercent').textContent = '0%';
progressTimer = null;
}
function progressDone(label) {
if (progressTimer) clearTimeout(progressTimer);
progressDock.dataset.state = 'done';
progressP = 1;
applyProgressTransform();
$('progressLabel').textContent = label;
$('progressPercent').textContent = '100%';
progressTimer = setTimeout(progressIdle, 2200);
}
function progressFail(message) {
if (progressTimer) clearTimeout(progressTimer);
progressDock.dataset.state = 'error';
$('progressLabel').textContent = message;
$('progressPercent').textContent = '';
progressTimer = setTimeout(progressIdle, 9000);
}

function showVisual(kind) {
$('waveform').style.display = kind === 'wave' ? 'block' : 'none';
$('spectroCanvas').classList.toggle('hidden', kind !== 'spectro');
$('curveCanvas').classList.toggle('hidden', kind !== 'curve');
$('emptyState').classList.toggle('hidden', kind !== 'empty');
$('spectroLegend').classList.toggle('hidden', kind !== 'spectro');
}
function fitCanvas(canvas) {
const rect = $('visualizer').getBoundingClientRect();
const dpr = Math.min(2, window.devicePixelRatio || 1);
const w = Math.max(1, Math.floor(rect.width));
const h = Math.max(1, Math.floor(rect.height));
canvas.width = Math.max(1, Math.floor(w * dpr));
canvas.height = Math.max(1, Math.floor(h * dpr));
const ctx = canvas.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
return { ctx: ctx, w: w, h: h };
}
function drawWaveform() {
if (!state.peaks) { showVisual('empty'); return; }
showVisual('wave');
const c = fitCanvas($('waveform'));
const ctx = c.ctx, w = c.w, h = c.h;
ctx.clearRect(0, 0, w, h);
const mn = state.peaks.min, mx = state.peaks.max, B = mn.length;
ctx.strokeStyle = 'rgba(193,154,107,0.85)';
ctx.lineWidth = 1;
ctx.beginPath();
for (let x = 0; x < w; x++) {
const a = Math.floor(x * B / w);
const b = Math.max(a + 1, Math.floor((x + 1) * B / w));
let lo = 0, hi = 0;
for (let i = a; i < b && i < B; i++) {
if (mn[i] < lo) lo = mn[i];
if (mx[i] > hi) hi = mx[i];
}
const yTop = h / 2 - hi * h / 2 * 0.92;
const yBot = h / 2 - lo * h / 2 * 0.92;
ctx.moveTo(x + 0.5, yTop);
ctx.lineTo(x + 0.5, Math.max(yBot, yTop + 0.6));
}
ctx.stroke();
}
const HEAT = [
[0.00, 18, 16, 14],
[0.22, 58, 34, 22],
[0.45, 140, 74, 32],
[0.68, 193, 154, 107],
[0.86, 232, 200, 140],
[1.00, 250, 240, 220]
];
function heat(v, out) {
v = clamp(v, 0, 1);
for (let i = 1; i < HEAT.length; i++) {
if (v <= HEAT[i][0]) {
const a = HEAT[i - 1], b = HEAT[i];
const t = (v - a[0]) / (b[0] - a[0]);
out[0] = a[1] + (b[1] - a[1]) * t;
out[1] = a[2] + (b[2] - a[2]) * t;
out[2] = a[3] + (b[3] - a[3]) * t;
return;
}
}
out[0] = 250; out[1] = 240; out[2] = 220;
}
function buildSpectroImage() {
if (!spectroData) { spectroImg = null; return; }
const g = spectroData.grid, cols = spectroData.cols, rows = spectroData.rows;
let maxDb = -Infinity;
for (let i = 0; i < g.length; i++) if (g[i] > maxDb) maxDb = g[i];
const floorDb = maxDb - 68;
const cv = document.createElement('canvas');
cv.width = cols;
cv.height = rows;
const octx = cv.getContext('2d');
const img = octx.createImageData(cols, rows);
const rgb = [0, 0, 0];
for (let y = 0; y < rows; y++) {
const r = rows - 1 - y;
for (let x = 0; x < cols; x++) {
heat((g[x * rows + r] - floorDb) / 68, rgb);
const o = (y * cols + x) * 4;
img.data[o] = rgb[0];
img.data[o + 1] = rgb[1];
img.data[o + 2] = rgb[2];
img.data[o + 3] = 255;
}
}
octx.putImageData(img, 0, 0);
spectroImg = cv;
}
function drawSpectro() {
if (!spectroData || !spectroImg) { showVisual('empty'); return; }
showVisual('spectro');
const c = fitCanvas($('spectroCanvas'));
const ctx = c.ctx, w = c.w, h = c.h;
ctx.clearRect(0, 0, w, h);
const padL = 46, padR = 12, padT = 10, padB = 22;
const pw = Math.max(1, w - padL - padR), ph = Math.max(1, h - padT - padB);
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
ctx.drawImage(spectroImg, padL, padT, pw, ph);
ctx.strokeStyle = 'rgba(61,53,46,0.9)';
ctx.lineWidth = 1;
ctx.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1);
ctx.font = '10px system-ui, sans-serif';
ctx.textAlign = 'right';
ctx.textBaseline = 'middle';
const marks = [50, 100, 500, 1000, 5000, 10000, 20000];
const lf0 = Math.log(spectroData.fMin), lf1 = Math.log(spectroData.fMax);
for (let i = 0; i < marks.length; i++) {
const f = marks[i];
if (f < spectroData.fMin || f > spectroData.fMax) continue;
const t = (Math.log(f) - lf0) / (lf1 - lf0);
const y = padT + ph * (1 - t);
ctx.strokeStyle = 'rgba(20,18,16,0.4)';
ctx.beginPath();
ctx.moveTo(padL, y + 0.5);
ctx.lineTo(padL + pw, y + 0.5);
ctx.stroke();
ctx.fillStyle = 'rgba(168,155,140,0.85)';
ctx.fillText(f >= 1000 ? (f / 1000) + 'к' : String(f), padL - 7, y);
}
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
ctx.fillStyle = 'rgba(168,155,140,0.85)';
const dur = state.resultDuration;
for (let i = 0; i <= 4; i++) {
const x = padL + pw * i / 4;
ctx.fillText(fmtTime(dur * i / 4), clamp(x, padL + 14, padL + pw - 14), padT + ph + 6);
}
ctx.textAlign = 'left';
ctx.fillStyle = 'rgba(107,97,86,0.9)';
ctx.fillText('Гц', 6, padT - 1);
}
function curveModeActive() {
return state.mode === 'lab' && state.labTool === 'curve';
}
function renderCurrentView() {
if (curveModeActive() && (stageView === 'curve' || !state.peaks)) { showVisual('curve'); drawCurve(); return; }
if (!state.peaks) { showVisual('empty'); return; }
if (stageView === 'spectro' && spectroData) { drawSpectro(); return; }
drawWaveform();
}
function setStageView(v) {
stageView = v;
$('viewToggle').querySelectorAll('.view-btn').forEach(function (b) {
b.classList.toggle('active', b.dataset.view === v);
});
renderCurrentView();
}
function syncViewToggle() {
const isCurve = curveModeActive();
$('viewCurveBtn').classList.toggle('hidden', !isCurve);
if (isCurve) { if (stageView !== 'curve' && stageView !== 'spectro' && stageView !== 'wave') stageView = 'curve'; }
else if (stageView === 'curve') stageView = 'wave';
$('viewToggle').querySelectorAll('.view-btn').forEach(function (b) {
b.classList.toggle('active', b.dataset.view === stageView);
});
}
function renderAnalysis(a) {
const el = $('analysis');
if (!a) { el.classList.add('hidden'); el.innerHTML = ''; return; }
const chips = [];
chips.push('<span class="chip"><span>Пик</span><b>' + fmtDb(a.peakDb) + ' dBFS</b></span>');
chips.push('<span class="chip"><span>RMS</span><b>' + fmtDb(a.rmsDb) + ' dBFS</b></span>');
if (isFinite(a.lufs)) chips.push('<span class="chip"><span>LUFS</span><b>' + fmtDb(a.lufs) + '</b></span>');
chips.push('<span class="chip' + (Math.abs(a.dc) > 0.001 ? ' warn' : '') + '"><span>DC</span><b>' + fmtDc(a.dc) + '</b></span>');
if (a.clipped > 0) chips.push('<span class="chip bad"><span>Клиппинг</span><b>' + a.clipped + ' отсч.</b></span>');
else chips.push('<span class="chip ok"><b>Клиппинга нет</b></span>');
if (a.limited) chips.push('<span class="chip warn"><b>Уровень ограничен по пику</b></span>');
el.innerHTML = chips.join('');
el.classList.remove('hidden');
}

async function renderStream(spec, job) {
const sr = spec.sr, ch = spec.channels, body = spec.bodyFrames;
const loop = !!spec.loop;
const padA = loop ? 0 : spec.padA;
const padB = loop ? 0 : spec.padB;
const fi = loop ? 0 : Math.min(body, spec.fadeInFrames);
const fo = loop ? 0 : Math.min(body, spec.fadeOutFrames);
const loopFade = loop ? Math.max(1, Math.min(Math.floor(sr * 0.25), Math.floor(body / 4))) : 0;
const genTotal = body + loopFade;
const total = padA + body + padB;
const seed = spec.seed;
const isMp3 = spec.format === 'mp3';
const outSr = isMp3 ? mp3TargetRate(sr) : sr;
const bufs = [];
for (let c = 0; c < ch; c++) bufs.push(new Float32Array(CHUNK));
const mkGens = function () {
const g = [];
for (let c = 0; c < ch; c++) g.push(spec.makeGen(c, (seed + c * 1013904223) >>> 0));
return g;
};
let gens = mkGens();
const head = [], tail = [];
if (loop) for (let c = 0; c < ch; c++) { head.push(new Float32Array(loopFade)); tail.push(new Float32Array(loopFade)); }
const lufs = spec.normMode === 'lufs' ? createLufsMeter(sr, ch) : null;
let peak = 0, sumSq = 0, pos = 0;
let t0 = performance.now();
job.progress(0.01, 'Анализ уровня');
while (pos < genTotal) {
const n = Math.min(CHUNK, genTotal - pos);
for (let c = 0; c < ch; c++) gens[c](bufs[c], n);
for (let i = 0; i < n; i++) {
const idx = pos + i;
let g = 1;
if (fi > 0 && idx < fi) g *= idx / fi;
if (fo > 0 && idx < body && idx >= body - fo) g *= (body - 1 - idx) / fo;
for (let c = 0; c < ch; c++) {
const v = bufs[c][i] * g;
bufs[c][i] = v;
if (loop && idx >= body) { tail[c][idx - body] = v; continue; }
if (loop && idx < loopFade) head[c][idx] = v;
const a = v < 0 ? -v : v;
if (a > peak) peak = a;
sumSq += v * v;
}
}
if (lufs && pos < body) lufs.feed(bufs, Math.min(n, body - pos));
pos += n;
if (performance.now() - t0 > SLICE_MS) {
job.progress(0.42 * pos / genTotal, 'Анализ уровня');
await yieldToUI();
t0 = performance.now();
}
}
if (loop) {
for (let c = 0; c < ch; c++) {
for (let i = 0; i < loopFade; i++) {
const t = i / loopFade;
const v = head[c][i] * Math.sqrt(t) + tail[c][i] * Math.sqrt(1 - t);
const a = v < 0 ? -v : v;
if (a > peak) peak = a;
}
}
}
const rms = Math.sqrt(sumSq / Math.max(1, body * ch));
const measuredLufs = lufs ? lufs.value() : NaN;
let gain = 1, limited = false;
if (spec.normMode === 'rms') {
if (rms > 1e-9) gain = Math.pow(10, spec.normTarget / 20) / rms;
} else if (spec.normMode === 'lufs') {
if (isFinite(measuredLufs)) gain = Math.pow(10, (spec.normTarget - measuredLufs) / 20);
else if (rms > 1e-9) gain = Math.pow(10, spec.normTarget / 20) / rms;
} else if (peak > 1e-9) gain = Math.pow(10, spec.normTarget / 20) / peak;
if (peak * gain > CEILING && peak > 1e-9) { gain = CEILING / peak; limited = true; }

gens = mkGens();
const sink = isMp3 ? createMp3Sink(outSr, ch, spec.mp3Bitrate) : createWavSink(sr, ch, spec.bitDepth, total);
const ratio = outSr / sr;
const spectro = createSpectro(outSr, ratio === 1 ? total : Math.round(total * ratio));
const mn = new Float32Array(BUCKETS), mx = new Float32Array(BUCKETS);
const outTotal = ratio === 1 ? total : Math.max(1, Math.round(total * ratio));
const bucketStep = BUCKETS / outTotal;
const step = isMp3 ? MP3_CHUNK : CHUNK;
let fPeak = 0, fSum = 0, fSumSq = 0, clipped = 0, frame = 0, written = 0;
t0 = performance.now();
while (frame < total) {
let limit = total;
if (frame < padA) limit = padA;
else if (frame < padA + body) limit = padA + body;
const n = Math.min(step, limit - frame);
const inBody = frame >= padA && frame < padA + body;
if (inBody) {
for (let c = 0; c < ch; c++) gens[c](bufs[c], n);
for (let i = 0; i < n; i++) {
const idx = frame - padA + i;
let g = gain;
if (fi > 0 && idx < fi) g *= idx / fi;
if (fo > 0 && idx >= body - fo) g *= (body - 1 - idx) / fo;
for (let c = 0; c < ch; c++) {
let v = bufs[c][i];
if (loop && idx < loopFade) {
const t = idx / loopFade;
v = v * Math.sqrt(t) + tail[c][idx] * Math.sqrt(1 - t);
}
bufs[c][i] = v * g;
}
}
} else {
for (let c = 0; c < ch; c++) bufs[c].fill(0, 0, n);
}
for (let i = 0; i < n; i++) {
const bucket = Math.min(BUCKETS - 1, ((frame + i) * bucketStep) | 0);
for (let c = 0; c < ch; c++) {
const v = bufs[c][i];
if (v < mn[bucket]) mn[bucket] = v;
if (v > mx[bucket]) mx[bucket] = v;
const a = v < 0 ? -v : v;
if (a > fPeak) fPeak = a;
if (a > 1) clipped++;
fSum += v;
fSumSq += v * v;
}
}
spectro.feed(bufs, n, frame);
sink.write(bufs, n);
frame += n;
written += n;
if (performance.now() - t0 > SLICE_MS) {
job.progress(0.42 + 0.56 * frame / total, isMp3 ? 'Кодирование MP3' : 'Кодирование WAV');
await yieldToUI();
t0 = performance.now();
}
}
const blob = sink.finish();
const count = total * ch;
return {
blob: blob,
ext: sink.ext,
peaks: { min: mn, max: mx },
spectro: spectro.result(),
duration: total / sr,
sr: outSr,
analysis: {
peakDb: 20 * Math.log10(Math.max(fPeak, 1e-12)),
rmsDb: 20 * Math.log10(Math.max(Math.sqrt(fSumSq / count), 1e-12)),
lufs: isFinite(measuredLufs) ? measuredLufs + 20 * Math.log10(Math.max(gain, 1e-12)) : NaN,
dc: fSum / count,
clipped: clipped,
limited: limited
}
};
}

async function encodeArrays(arrays, sr, opts, gain, job, from, to, extra) {
const ch = arrays.length;
const srcLen = arrays[0].length;
const isMp3 = opts.format === 'mp3';
const outSr = isMp3 ? mp3TargetRate(sr) : sr;
const ratio = outSr / sr;
const total = ratio === 1 ? srcLen : Math.max(1, Math.round(srcLen * ratio));
const sink = isMp3 ? createMp3Sink(outSr, ch, opts.mp3Bitrate) : createWavSink(sr, ch, opts.bitDepth, total);
const spectro = createSpectro(outSr, total);
const bufs = [];
for (let c = 0; c < ch; c++) bufs.push(new Float32Array(CHUNK));
const mn = new Float32Array(BUCKETS), mx = new Float32Array(BUCKETS);
const bucketStep = BUCKETS / total;
const step = isMp3 ? MP3_CHUNK : CHUNK;
let fPeak = 0, fSum = 0, fSumSq = 0, clipped = 0, frame = 0;
let t0 = performance.now();
while (frame < total) {
const n = Math.min(step, total - frame);
for (let c = 0; c < ch; c++) {
const src = arrays[c], dst = bufs[c];
if (ratio === 1) {
for (let i = 0; i < n; i++) dst[i] = src[frame + i] * gain;
} else {
for (let i = 0; i < n; i++) {
const p = (frame + i) / ratio;
const i0 = Math.floor(p);
const t = p - i0;
const a = src[i0 < srcLen ? i0 : srcLen - 1];
const b = src[i0 + 1 < srcLen ? i0 + 1 : srcLen - 1];
dst[i] = (a + (b - a) * t) * gain;
}
}
}
for (let i = 0; i < n; i++) {
const bucket = Math.min(BUCKETS - 1, ((frame + i) * bucketStep) | 0);
for (let c = 0; c < ch; c++) {
const v = bufs[c][i];
if (v < mn[bucket]) mn[bucket] = v;
if (v > mx[bucket]) mx[bucket] = v;
const a = v < 0 ? -v : v;
if (a > fPeak) fPeak = a;
if (a > 1) clipped++;
fSum += v;
fSumSq += v * v;
}
}
spectro.feed(bufs, n, frame);
sink.write(bufs, n);
frame += n;
if (performance.now() - t0 > SLICE_MS) {
job.progress(from + (to - from) * frame / total, isMp3 ? 'Кодирование MP3' : 'Кодирование WAV');
await yieldToUI();
t0 = performance.now();
}
}
const blob = sink.finish();
const count = total * ch;
const lufsIn = extra && isFinite(extra.lufs) ? extra.lufs : NaN;
return {
blob: blob,
ext: sink.ext,
peaks: { min: mn, max: mx },
spectro: spectro.result(),
duration: total / outSr,
sr: outSr,
analysis: {
peakDb: 20 * Math.log10(Math.max(fPeak, 1e-12)),
rmsDb: 20 * Math.log10(Math.max(Math.sqrt(fSumSq / count), 1e-12)),
lufs: isFinite(lufsIn) ? lufsIn + 20 * Math.log10(Math.max(gain, 1e-12)) : NaN,
dc: fSum / count,
clipped: clipped,
limited: false
}
};
}

const audioEl = new Audio();
audioEl.preload = 'auto';
const seekBar = $('seekBar');
function setPlayIcon(playing) {
$('playIcon').innerHTML = playing
? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
: '<path d="M8 5v14l11-7z"/>';
}
audioEl.addEventListener('timeupdate', function () {
$('timeDisplay').textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration || state.resultDuration);
if (!state.seeking && audioEl.duration > 0) seekBar.value = Math.floor((audioEl.currentTime / audioEl.duration) * 1000);
});
audioEl.addEventListener('loadedmetadata', function () {
$('timeDisplay').textContent = '0:00 / ' + fmtTime(audioEl.duration || state.resultDuration);
seekBar.disabled = false;
});
audioEl.addEventListener('ended', function () { setPlayIcon(false); });
audioEl.addEventListener('pause', function () { setPlayIcon(false); });
audioEl.addEventListener('play', function () { setPlayIcon(true); });
audioEl.addEventListener('error', function () {
if (state.blobUrl) progressFail('Браузер не смог воспроизвести этот файл, но скачать его можно');
});
function togglePlay() {
if (!state.blobUrl) return;
if (audioEl.paused) {
const p = audioEl.play();
if (p && p.catch) p.catch(function () { progressFail('Нажмите ещё раз — браузер заблокировал автозапуск звука'); });
} else audioEl.pause();
}
function seekBy(delta) {
if (!state.blobUrl || !(audioEl.duration > 0)) return;
audioEl.currentTime = clamp(audioEl.currentTime + delta, 0, Math.max(0, audioEl.duration - 0.05));
seekBar.value = Math.floor((audioEl.currentTime / audioEl.duration) * 1000);
$('timeDisplay').textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration);
}
$('playBtn').addEventListener('click', togglePlay);
seekBar.addEventListener('pointerdown', function () { state.seeking = true; });
seekBar.addEventListener('input', function () {
if (audioEl.duration > 0) audioEl.currentTime = (seekBar.value / 1000) * audioEl.duration;
});
function endSeek() { state.seeking = false; }
seekBar.addEventListener('pointerup', endSeek);
seekBar.addEventListener('pointercancel', endSeek);
seekBar.addEventListener('change', endSeek);
window.addEventListener('pointerup', endSeek);
window.addEventListener('blur', endSeek);

function triggerDownload(blob, ext, duration, sr) {
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'wnl-' + state.resultKey + '-' + Math.round(duration) + 's-' + sr + 'hz-' + stamp() + '.' + ext;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
}
async function downloadAs(format, btn) {
if (!state.blob) return;
if (state.resultExt === format) {
triggerDownload(state.blob, format, state.resultDuration, state.resultSr);
return;
}
runJob(btn, 'Готовим…', async function (job) {
if (format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
progressBusy('Чтение результата');
await yieldToUI();
const ab = await readBuffer(state.blob);
progressBusy('Декодирование');
await yieldToUI();
const ctx = await ensureCtx();
let decoded;
try { decoded = await ctx.decodeAudioData(ab); }
catch (e) { throw new Error('Не удалось разобрать текущий результат'); }
const sr = decoded.sampleRate;
const len = decoded.length;
const ch = Math.min(2, decoded.numberOfChannels);
if (len * ch * 4 > DECODE_LIMIT) throw new Error('Результат слишком длинный для конвертации — сгенерируйте файл короче');
const outSr = format === 'mp3' ? mp3TargetRate(sr) : sr;
const size = estimateSize(len / sr, outSr, ch, state.bitDepth, format, state.mp3Bitrate);
if (size > SIZE_LIMIT) throw new Error('Файл получится ' + fmtSize(size) + ' — уменьшите длительность или разрядность');
const arrays = [];
for (let c = 0; c < ch; c++) arrays.push(decoded.getChannelData(c));
const res = await encodeArrays(arrays, sr, {
format: format, bitDepth: state.bitDepth, mp3Bitrate: state.mp3Bitrate
}, 1, job, 0.15, 1);
triggerDownload(res.blob, res.ext, res.duration, res.sr);
arrays.length = 0;
decoded = null;
});
}
$('dlWavBtn').addEventListener('click', function () { downloadAs('wav', $('dlWavBtn')); });
$('dlMp3Btn').addEventListener('click', function () { downloadAs('mp3', $('dlMp3Btn')); });

function setLoop(on) {
state.loop = on;
audioEl.loop = on;
$('loopToggle').checked = on;
$('loopBtn').classList.toggle('active', on);
$('loopBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
['fadeIn', 'fadeOut', 'padStart', 'padEnd'].forEach(function (k) {
$(k + 'Section').classList.toggle('dimmed', on);
$(k + 'Slider').disabled = on;
$(k + 'Num').disabled = on;
});
$('loopHint').classList.toggle('hidden', !on);
$('loopMp3Hint').classList.toggle('hidden', !(on && state.format === 'mp3'));
updateEstimate();
}
$('loopToggle').addEventListener('change', function () { setLoop($('loopToggle').checked); });
$('loopBtn').addEventListener('click', function () { setLoop(!state.loop); });
$('viewToggle').addEventListener('click', function (e) {
const btn = e.target.closest('.view-btn');
if (!btn || btn.disabled) return;
setStageView(btn.dataset.view);
});

function applyResult(res, meta, key, allowMp3) {
audioEl.pause();
const old = state.blobUrl;
state.blob = res.blob;
state.blobUrl = URL.createObjectURL(res.blob);
state.peaks = res.peaks;
state.resultDuration = res.duration;
state.resultSr = res.sr;
state.resultExt = res.ext;
state.resultKey = key;
state.allowMp3 = allowMp3 !== false;
spectroData = res.spectro;
buildSpectroImage();
audioEl.src = state.blobUrl;
audioEl.loop = state.loop;
if (old) URL.revokeObjectURL(old);
seekBar.disabled = false;
seekBar.value = 0;
$('stageMeta').textContent = meta + ' · ' + fmtSize(res.blob.size);
$('timeDisplay').textContent = '0:00 / ' + fmtTime(res.duration);
renderAnalysis(res.analysis);
syncViewToggle();
refreshButtons();
renderCurrentView();
}

function refreshButtons() {
const b = state.busy;
$('generateBtn').disabled = b || state.tooBig;
$('mixBtn').disabled = b || !state.mixFile;
$('curveGen').disabled = b;
$('calibBtn').disabled = b;
$('synthBtn').disabled = b;
$('percBtn').disabled = b;
$('ditherNo').disabled = b;
$('ditherYes').disabled = b;
$('playBtn').disabled = !state.blobUrl;
$('dlWavBtn').disabled = b || !state.blob;
$('dlMp3Btn').disabled = b || !state.blob;
$('dlMp3Btn').classList.toggle('hidden', !state.allowMp3);
$('mp3RateSelect').classList.toggle('hidden', !state.allowMp3);
$('viewToggle').querySelectorAll('.view-btn').forEach(function (btn) {
if (btn.dataset.view === 'curve') btn.disabled = false;
else btn.disabled = !state.peaks;
});
}
async function runJob(btn, busyText, fn) {
if (state.busy) return;
state.busy = true;
const original = btn.innerHTML;
btn.innerHTML = busyText;
refreshButtons();
progressBusy(busyText);
try {
await yieldToUI();
await fn({ progress: progressSet });
progressDone('Готово');
} catch (e) {
console.error(e);
progressFail(friendlyError(e));
} finally {
btn.innerHTML = original;
state.busy = false;
refreshButtons();
}
}
function renderSwatches(containerId, activeType, onClick) {
const el = $(containerId);
el.innerHTML = '';
ALL_TYPES.forEach(function (t) {
const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'swatch' + (t === activeType ? ' active' : '');
btn.dataset.type = t;
btn.innerHTML = '<span class="swatch-dot" style="background:' + TYPE_COLORS[t] + '"></span><span class="swatch-name">' + TYPE_LABELS[t] + '</span>';
btn.addEventListener('click', function () {
el.querySelectorAll('.swatch').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
onClick(t);
});
el.appendChild(btn);
});
}
function bindSlider(sliderId, numId, key, min, max, onChange) {
const s = $(sliderId), n = $(numId);
if (!s || !n) return;
function commit(v) {
v = clamp(Math.round(isNaN(v) ? min : v), min, max);
state[key] = v;
s.value = v;
n.value = v;
if (onChange) onChange(v);
}
s.addEventListener('input', function () {
const v = clamp(Math.round(parseFloat(s.value)), min, max);
state[key] = v;
n.value = v;
if (onChange) onChange(v);
});
n.addEventListener('input', function () {
const v = parseFloat(n.value);
if (isNaN(v) || v < min || v > max) return;
state[key] = Math.round(v);
s.value = state[key];
if (onChange) onChange(state[key]);
});
n.addEventListener('change', function () { commit(parseFloat(n.value)); });
n.addEventListener('blur', function () { commit(parseFloat(n.value)); });
commit(parseFloat(s.value));
}
function updateEstimate() {
const loop = state.loop;
const total = state.duration + (loop ? 0 : state.padStart + state.padEnd);
const size = estimateSize(total, state.sampleRate, state.channels, state.bitDepth, state.format, state.mp3Bitrate);
const el = $('estimate');
state.tooBig = size > SIZE_LIMIT;
if (state.tooBig) {
el.classList.add('warn');
el.textContent = 'Слишком большой файл: ' + fmtSize(size) + '. Уменьшите длительность, частоту, битрейт или выберите моно';
} else {
el.classList.remove('warn');
el.textContent = 'Примерный размер: ' + fmtSize(size) + ' · ' + fmtTime(total) + ' · ' + (state.channels === 2 ? 'стерео' : 'моно') + (loop ? ' · по кругу' : '');
}
refreshButtons();
}
function setMp3Bitrate(v) {
state.mp3Bitrate = v;
$('mp3BitrateSelect').value = String(v);
$('mp3RateSelect').value = String(v);
syncFormatUI();
}
function syncFormatUI() {
const mp3 = state.format === 'mp3';
$('mp3BitrateSection').classList.toggle('hidden', !mp3);
$('bitDepthSection').classList.toggle('dimmed', mp3);
$('bitDepthSelect').disabled = mp3;
const sel = $('sampleRateSelect');
Array.prototype.forEach.call(sel.options, function (o) {
const v = parseInt(o.value, 10);
o.disabled = mp3 && v !== 44100 && v !== 48000;
});
if (mp3 && state.sampleRate !== 44100 && state.sampleRate !== 48000) {
state.sampleRate = 44100;
sel.value = '44100';
}
$('loopMp3Hint').classList.toggle('hidden', !(state.loop && mp3));
$('mixFormatNote').textContent = 'Из генератора берутся: ' + (mp3 ? 'MP3 ' + state.mp3Bitrate + ' кбит/с' : 'WAV ' + state.bitDepth + ' бит') + ' · нормализация ' + (state.normMode === 'peak' ? 'по пику' : state.normMode === 'rms' ? 'по RMS' : 'по LUFS') + ' ' + state.normTarget + (state.normMode === 'lufs' ? ' LUFS' : ' dBFS');
updateEstimate();
}
function setNormMode(mode) {
state.normMode = mode;
state.normTarget = NORM_DEFAULT[mode];
$('normTargetSlider').value = state.normTarget;
$('normTargetNum').value = state.normTarget;
$('normTargetUnit').textContent = mode === 'lufs' ? 'LUFS' : 'dBFS';
$('normNote').textContent = NORM_NOTE[mode];
syncFormatUI();
}

renderSwatches('swatches', state.type, function (t) { state.type = t; });
renderSwatches('mixSwatches', state.mixType, function (t) { state.mixType = t; });
renderSwatches('testSwatches', state.testType, function (t) {
state.testType = t;
if (labSession && labSession.kind === 'test') {
labSession.switchTo(t);
$('stageMeta').textContent = 'Тест · ' + TYPE_LABELS[t];
}
});

bindSlider('durationSlider', 'durationNum', 'duration', 1, 600, updateEstimate);
bindSlider('normTargetSlider', 'normTargetNum', 'normTarget', -40, 0, syncFormatUI);
bindSlider('fadeInSlider', 'fadeInNum', 'fadeIn', 0, 30);
bindSlider('fadeOutSlider', 'fadeOutNum', 'fadeOut', 0, 30);
bindSlider('padStartSlider', 'padStartNum', 'padStart', 0, 60, updateEstimate);
bindSlider('padEndSlider', 'padEndNum', 'padEnd', 0, 60, updateEstimate);
bindSlider('snrSlider', 'snrNum', 'snrDb', -40, 0);
bindSlider('notchFreq', 'notchFreqNum', 'notchFreq', 100, 12000, function (v) {
if (labSession && labSession.notch && audioCtx) labSession.notch.frequency.setTargetAtTime(v, audioCtx.currentTime, 0.02);
});
bindSlider('notchQ', 'notchQNum', 'notchQ', 3, 50, function (v) {
if (labSession && labSession.notch && audioCtx) labSession.notch.Q.setTargetAtTime(v, audioCtx.currentTime, 0.02);
});
bindSlider('binBase', 'binBaseNum', 'binBase', 100, 500, function (v) {
if (labSession && labSession.oscL && audioCtx) {
const t = audioCtx.currentTime;
labSession.oscL.frequency.setTargetAtTime(v, t, 0.03);
labSession.oscR.frequency.setTargetAtTime(v + state.binBeat, t, 0.03);
}
});
bindSlider('binBeat', 'binBeatNum', 'binBeat', 2, 15, function (v) {
if (labSession && labSession.oscR && audioCtx) labSession.oscR.frequency.setTargetAtTime(state.binBase + v, audioCtx.currentTime, 0.03);
});
bindSlider('rot8dSpeed', 'rot8dSpeedNum', 'rot8dSpeed', 1, 10, function (v) {
if (labSession && labSession.kind === 'rot8d') labSession.speed = v;
});
bindSlider('curveDur', 'curveDurNum', 'curveDur', 5, 120);
bindSlider('calibDur', 'calibDurNum', 'calibDur', 10, 120);
bindSlider('synthDur', 'synthDurNum', 'synthDur', 5, 600);

$('sampleRateSelect').addEventListener('change', function () { state.sampleRate = parseInt($('sampleRateSelect').value, 10); updateEstimate(); });
$('bitDepthSelect').addEventListener('change', function () { state.bitDepth = parseInt($('bitDepthSelect').value, 10); syncFormatUI(); });
$('mp3BitrateSelect').addEventListener('change', function () { setMp3Bitrate(parseInt($('mp3BitrateSelect').value, 10)); });
$('mp3RateSelect').addEventListener('change', function () { setMp3Bitrate(parseInt($('mp3RateSelect').value, 10)); });
$('normModeSelect').addEventListener('change', function () { setNormMode($('normModeSelect').value); });
$('formatSegmented').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('formatSegmented').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.format = btn.dataset.format;
syncFormatUI();
});
$('channelSegmented').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('channelSegmented').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.channels = parseInt(btn.dataset.channels, 10);
updateEstimate();
});

function currentOutput() {
return { format: state.format, bitDepth: state.bitDepth, mp3Bitrate: state.mp3Bitrate };
}
$('generateBtn').addEventListener('click', function () {
const sr = state.sampleRate;
const ch = state.channels;
const dur = state.duration;
const loop = state.loop;
const padA = loop ? 0 : Math.round(state.padStart * sr);
const padB = loop ? 0 : Math.round(state.padEnd * sr);
const body = Math.max(1, Math.round(dur * sr));
const total = padA + body + padB;
const type = state.type;
const out = currentOutput();
const fadeIn = state.fadeIn, fadeOut = state.fadeOut;
const normMode = state.normMode, normTarget = state.normTarget;
const size = estimateSize(total / sr, sr, ch, out.bitDepth, out.format, out.mp3Bitrate);
if (size > SIZE_LIMIT) { progressFail('Слишком большой файл: ' + fmtSize(size)); return; }
runJob($('generateBtn'), 'Генерация…', async function (job) {
if (out.format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
const res = await renderStream({
sr: sr, channels: ch, format: out.format, bitDepth: out.bitDepth, mp3Bitrate: out.mp3Bitrate,
bodyFrames: body, padA: padA, padB: padB,
fadeInFrames: Math.round(fadeIn * sr), fadeOutFrames: Math.round(fadeOut * sr),
loop: loop, seed: randomSeed(), normMode: normMode, normTarget: normTarget,
makeGen: function (c, s) { return createNoiseGen(type, sr, s); }
}, job);
applyResult(res, TYPE_LABELS[type] + ' · ' + fmtTime(res.duration) + ' · ' + res.sr + ' Гц · ' + (ch === 2 ? 'стерео' : 'моно') + (loop ? ' · по кругу' : ''), type, true);
});
});

function getCtx() {
if (!audioCtx) {
const AC = window.AudioContext || window.webkitAudioContext;
if (!AC) throw new Error('Браузер не поддерживает Web Audio');
audioCtx = new AC();
}
return audioCtx;
}
async function ensureCtx() {
const c = getCtx();
if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} }
return c;
}

$('mixFileInput').addEventListener('change', function () {
const f = $('mixFileInput').files[0];
if (!f) return;
state.mixFile = f;
$('mixFileName').textContent = f.name;
const info = $('mixInfo');
if (f.size > FILE_LIMIT) {
info.classList.add('warn');
info.textContent = 'Файл ' + fmtSize(f.size) + ' — слишком большой, выберите трек поменьше';
} else {
info.classList.remove('warn');
info.textContent = 'Размер файла: ' + fmtSize(f.size);
}
refreshButtons();
});
$('mixBtn').addEventListener('click', function () {
if (!state.mixFile) return;
const file = state.mixFile;
const type = state.mixType;
const snr = state.snrDb;
const out = currentOutput();
const normMode = state.normMode;
const normTarget = state.normTarget;
runJob($('mixBtn'), 'Обработка…', async function (job) {
if (file.size > FILE_LIMIT) throw new Error('Файл больше ' + fmtSize(FILE_LIMIT) + ' — выберите трек поменьше');
if (out.format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
progressBusy('Чтение файла');
await yieldToUI();
const ab = await readBuffer(file);
progressBusy('Декодирование трека');
await yieldToUI();
const ctx = await ensureCtx();
let decoded;
try { decoded = await ctx.decodeAudioData(ab); }
catch (e) { throw new Error('Не удалось прочитать аудио — поддерживаются WAV, MP3, OGG, M4A, FLAC'); }
const sr = decoded.sampleRate;
const len = decoded.length;
const ch = Math.min(2, decoded.numberOfChannels);
if (len / sr > 600) throw new Error('Трек длиннее 10 минут — сначала обрежьте его');
if (len * ch * 4 > DECODE_LIMIT) throw new Error('Трек слишком длинный для частоты ' + sr + ' Гц — обрежьте его или выберите WAV 16 бит');
const outSr = out.format === 'mp3' ? mp3TargetRate(sr) : sr;
const outSize = estimateSize(len / sr, outSr, ch, out.bitDepth, out.format, out.mp3Bitrate);
if (outSize > SIZE_LIMIT) throw new Error('Результат получится ' + fmtSize(outSize) + ' — выберите 16 бит, моно или MP3');
const arrays = [];
for (let c = 0; c < ch; c++) arrays.push(decoded.getChannelData(c));
job.progress(0.1, 'Замер уровня трека');
let sumSq = 0, t0 = performance.now();
for (let c = 0; c < ch; c++) {
const d = arrays[c];
for (let i = 0; i < len; i++) {
sumSq += d[i] * d[i];
if ((i & 65535) === 65535 && performance.now() - t0 > SLICE_MS) {
job.progress(0.1 + 0.1 * (c + i / len) / ch, 'Замер уровня трека');
await yieldToUI();
t0 = performance.now();
}
}
}
const trackRms = Math.sqrt(sumSq / (len * ch));
if (trackRms < 1e-6) throw new Error('Трек пустой или слишком тихий');
const probeN = 131072;
const probe = new Float32Array(probeN);
createNoiseGen(type, sr, 987654321)(probe, probeN);
let ps = 0;
for (let i = 0; i < probeN; i++) ps += probe[i] * probe[i];
const noiseRms = Math.sqrt(ps / probeN);
if (noiseRms < 1e-9) throw new Error('Не удалось построить шум');
const noiseGain = trackRms / (Math.pow(10, -snr / 20) * noiseRms);
const bufs = [];
for (let c = 0; c < ch; c++) bufs.push(new Float32Array(CHUNK));
const gens = [];
const baseSeed = randomSeed();
for (let c = 0; c < ch; c++) gens.push(createNoiseGen(type, sr, (baseSeed + c * 7919) >>> 0));
const lufs = normMode === 'lufs' ? createLufsMeter(sr, ch) : null;
let peak = 0, mixSq = 0, pos = 0;
t0 = performance.now();
while (pos < len) {
const n = Math.min(CHUNK, len - pos);
for (let c = 0; c < ch; c++) {
gens[c](bufs[c], n);
const d = arrays[c], b = bufs[c];
for (let i = 0; i < n; i++) {
const v = d[pos + i] + b[i] * noiseGain;
d[pos + i] = v;
b[i] = v;
const a = v < 0 ? -v : v;
if (a > peak) peak = a;
mixSq += v * v;
}
}
if (lufs) lufs.feed(bufs, n);
pos += n;
if (performance.now() - t0 > SLICE_MS) {
job.progress(0.2 + 0.3 * pos / len, 'Наложение шума');
await yieldToUI();
t0 = performance.now();
}
}
const rms = Math.sqrt(mixSq / (len * ch));
const measuredLufs = lufs ? lufs.value() : NaN;
let gain = 1;
if (normMode === 'rms') { if (rms > 1e-9) gain = Math.pow(10, normTarget / 20) / rms; }
else if (normMode === 'lufs') {
if (isFinite(measuredLufs)) gain = Math.pow(10, (normTarget - measuredLufs) / 20);
else if (rms > 1e-9) gain = Math.pow(10, normTarget / 20) / rms;
} else if (peak > 1e-9) gain = Math.pow(10, normTarget / 20) / peak;
if (peak * gain > CEILING && peak > 1e-9) gain = CEILING / peak;
const res = await encodeArrays(arrays, sr, out, gain, job, 0.5, 1, { lufs: measuredLufs });
applyResult(res, 'Наложение · ' + TYPE_LABELS[type] + ' · ' + snr + ' дБ · ' + fmtTime(res.duration), 'mix-' + type, true);
arrays.length = 0;
decoded = null;
});
});

const LOOP_SECONDS = 8;
function getLoopBuffer(type) {
if (loopCache.has(type)) return loopCache.get(type);
const sr = audioCtx.sampleRate;
const n = Math.floor(sr * LOOP_SECONDS);
const fade = Math.floor(sr * 0.05);
const buf = audioCtx.createBuffer(2, n, sr);
for (let c = 0; c < 2; c++) {
const tmp = new Float32Array(n + fade);
createNoiseGen(type, sr, (1234567 + c * 7717) >>> 0)(tmp, n + fade);
let s = 0;
for (let i = 0; i < n + fade; i++) s += tmp[i] * tmp[i];
const rms = Math.sqrt(s / (n + fade));
const g = rms > 1e-9 ? 0.12 / rms : 1;
const d = buf.getChannelData(c);
for (let i = 0; i < n; i++) d[i] = tmp[i] * g;
for (let i = 0; i < fade; i++) {
const t = i / fade;
d[i] = tmp[i] * g * Math.sqrt(t) + tmp[n + i] * g * Math.sqrt(1 - t);
}
}
loopCache.set(type, buf);
return buf;
}
function resetLabButtons() {
['notch', 'bin', 'rot8d', 'test'].forEach(function (id) {
const play = $(id + 'Play'), stop = $(id + 'Stop');
if (play) play.classList.remove('hidden');
if (stop) stop.classList.add('hidden');
});
$('notchCountdown').classList.add('hidden');
$('binCountdown').classList.add('hidden');
}
function stopLab() {
if (!labSession) return;
const s = labSession;
labSession = null;
if (s.timerId) clearInterval(s.timerId);
if (s.endTimeout) clearTimeout(s.endTimeout);
if (s.raf) cancelAnimationFrame(s.raf);
const t = audioCtx.currentTime;
try {
s.master.gain.cancelScheduledValues(t);
s.master.gain.setValueAtTime(s.master.gain.value, t);
s.master.gain.linearRampToValueAtTime(0, t + 0.06);
} catch (e) {}
setTimeout(function () {
s.sources.forEach(function (x) { try { x.stop(); } catch (e) {} try { x.disconnect(); } catch (e) {} });
s.nodes.forEach(function (x) { try { x.disconnect(); } catch (e) {} });
}, 150);
}
function baseSession(kind) {
const master = audioCtx.createGain();
master.gain.value = 0;
master.connect(audioCtx.destination);
const s = { kind: kind, master: master, sources: new Set(), nodes: new Set([master]), timerId: null, endTimeout: null, raf: 0 };
master.gain.setValueAtTime(0, audioCtx.currentTime);
master.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.2);
return s;
}
function attachTimer(s, minutes, el) {
if (s.timerId) { clearInterval(s.timerId); s.timerId = null; }
if (s.endTimeout) { clearTimeout(s.endTimeout); s.endTimeout = null; }
if (!minutes) { el.classList.add('hidden'); return; }
const t = audioCtx.currentTime;
try {
s.master.gain.cancelScheduledValues(t);
s.master.gain.setValueAtTime(Math.max(0.0001, s.master.gain.value), t);
s.master.gain.linearRampToValueAtTime(1, t + 0.3);
} catch (e) {}
const end = Date.now() + minutes * 60000;
el.classList.remove('hidden');
function tick() {
const left = Math.max(0, end - Date.now());
el.textContent = 'Осталось ' + fmtTime(left / 1000);
if (left <= 0) finishByTimer(s, el);
}
tick();
s.timerId = setInterval(tick, 500);
}
function finishByTimer(s, el) {
if (labSession !== s) return;
if (s.timerId) { clearInterval(s.timerId); s.timerId = null; }
const t = audioCtx.currentTime;
try {
s.master.gain.cancelScheduledValues(t);
s.master.gain.setValueAtTime(s.master.gain.value, t);
s.master.gain.linearRampToValueAtTime(0.0001, t + 2);
} catch (e) {}
el.textContent = 'Таймер завершён';
s.endTimeout = setTimeout(function () {
if (labSession === s) {
stopLab();
resetLabButtons();
$('stageMeta').textContent = 'Таймер завершён';
}
}, 2200);
}
function showStop(id) {
$(id + 'Play').classList.add('hidden');
$(id + 'Stop').classList.remove('hidden');
}
$('notchPlay').addEventListener('click', async function () {
stopLab();
await ensureCtx();
const s = baseSession('notch');
const src = audioCtx.createBufferSource();
src.buffer = getLoopBuffer('pink');
src.loop = true;
const notch = audioCtx.createBiquadFilter();
notch.type = 'notch';
notch.frequency.value = state.notchFreq;
notch.Q.value = state.notchQ;
const gain = audioCtx.createGain();
gain.gain.value = 2.2;
src.connect(notch); notch.connect(gain); gain.connect(s.master);
src.start();
s.sources.add(src); s.nodes.add(notch); s.nodes.add(gain);
s.notch = notch;
labSession = s;
attachTimer(s, state.notchTimer, $('notchCountdown'));
showStop('notch');
$('stageMeta').textContent = 'Вырез · ' + state.notchFreq + ' Гц · Q ' + state.notchQ;
});
$('notchStop').addEventListener('click', function () { stopLab(); resetLabButtons(); $('stageMeta').textContent = '— · —'; });
$('notchTimer').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('notchTimer').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.notchTimer = parseInt(btn.dataset.min, 10);
if (labSession && labSession.kind === 'notch') attachTimer(labSession, state.notchTimer, $('notchCountdown'));
});
$('binPlay').addEventListener('click', async function () {
stopLab();
await ensureCtx();
const s = baseSession('bin');
const bed = audioCtx.createBufferSource();
bed.buffer = getLoopBuffer('pink');
bed.loop = true;
const bedGain = audioCtx.createGain();
bedGain.gain.value = 0.45;
bed.connect(bedGain); bedGain.connect(s.master);
const oscL = audioCtx.createOscillator();
oscL.frequency.value = state.binBase;
const oscR = audioCtx.createOscillator();
oscR.frequency.value = state.binBase + state.binBeat;
const panL = audioCtx.createStereoPanner(); panL.pan.value = -1;
const panR = audioCtx.createStereoPanner(); panR.pan.value = 1;
const oscGain = audioCtx.createGain(); oscGain.gain.value = 0.5;
oscL.connect(panL); panL.connect(oscGain);
oscR.connect(panR); panR.connect(oscGain);
oscGain.connect(s.master);
bed.start(); oscL.start(); oscR.start();
s.sources.add(bed); s.sources.add(oscL); s.sources.add(oscR);
[bedGain, panL, panR, oscGain].forEach(function (n) { s.nodes.add(n); });
s.oscL = oscL; s.oscR = oscR;
labSession = s;
attachTimer(s, state.binTimer, $('binCountdown'));
showStop('bin');
$('stageMeta').textContent = 'Бинаурал · ' + state.binBase + ' Гц · разница ' + state.binBeat + ' Гц';
});
$('binStop').addEventListener('click', function () { stopLab(); resetLabButtons(); $('stageMeta').textContent = '— · —'; });
$('binTimer').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('binTimer').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.binTimer = parseInt(btn.dataset.min, 10);
if (labSession && labSession.kind === 'bin') attachTimer(labSession, state.binTimer, $('binCountdown'));
});
$('rot8dPlay').addEventListener('click', async function () {
stopLab();
await ensureCtx();
const s = baseSession('rot8d');
s.speed = state.rot8dSpeed;
const src = audioCtx.createBufferSource();
src.buffer = getLoopBuffer('pink');
src.loop = true;
const panner = audioCtx.createPanner();
panner.panningModel = 'HRTF';
panner.distanceModel = 'linear';
panner.refDistance = 1;
panner.maxDistance = 10;
panner.rolloffFactor = 0;
const gain = audioCtx.createGain();
gain.gain.value = 2.2;
src.connect(panner); panner.connect(gain); gain.connect(s.master);
src.start();
s.sources.add(src); s.nodes.add(panner); s.nodes.add(gain);
let angle = 0, last = performance.now();
function animate() {
if (labSession !== s) return;
const now = performance.now();
const dt = Math.min(0.1, (now - last) / 1000);
last = now;
angle += s.speed * 0.6 * dt;
const x = Math.sin(angle) * 2, z = Math.cos(angle) * 2;
if (panner.positionX) {
panner.positionX.value = x;
panner.positionY.value = 0;
panner.positionZ.value = z;
} else if (panner.setPosition) panner.setPosition(x, 0, z);
s.raf = requestAnimationFrame(animate);
}
s.raf = requestAnimationFrame(animate);
labSession = s;
showStop('rot8d');
$('stageMeta').textContent = '8D · скорость ' + s.speed;
});
$('rot8dStop').addEventListener('click', function () { stopLab(); resetLabButtons(); $('stageMeta').textContent = '— · —'; });
$('testPlay').addEventListener('click', async function () {
stopLab();
await ensureCtx();
const s = baseSession('test');
let current = null;
function play(type) {
const src = audioCtx.createBufferSource();
src.buffer = getLoopBuffer(type);
src.loop = true;
const g = audioCtx.createGain();
g.gain.value = 0;
src.connect(g); g.connect(s.master);
src.start();
const t = audioCtx.currentTime;
g.gain.setValueAtTime(0, t);
g.gain.linearRampToValueAtTime(1, t + 0.15);
s.sources.add(src); s.nodes.add(g);
if (current) {
const old = current;
try {
old.g.gain.cancelScheduledValues(t);
old.g.gain.setValueAtTime(old.g.gain.value, t);
old.g.gain.linearRampToValueAtTime(0, t + 0.15);
old.src.stop(t + 0.2);
} catch (e) {}
setTimeout(function () {
try { old.src.disconnect(); } catch (e) {}
try { old.g.disconnect(); } catch (e) {}
s.sources.delete(old.src);
s.nodes.delete(old.g);
}, 420);
}
current = { src: src, g: g };
}
play(state.testType);
s.switchTo = play;
labSession = s;
showStop('test');
$('stageMeta').textContent = 'Тест · ' + TYPE_LABELS[state.testType];
});
$('testStop').addEventListener('click', function () { stopLab(); resetLabButtons(); $('stageMeta').textContent = '— · —'; });

const curveCanvas = $('curveCanvas');
function drawCurve() {
const c = fitCanvas(curveCanvas);
const ctx = c.ctx, w = c.w, h = c.h;
ctx.clearRect(0, 0, w, h);
ctx.strokeStyle = 'rgba(193,154,107,0.15)';
ctx.lineWidth = 1;
for (let i = 1; i < 4; i++) {
const y = h * i / 4;
ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
}
ctx.strokeStyle = 'rgba(193,154,107,0.9)';
ctx.lineWidth = 2;
ctx.beginPath();
for (let x = 0; x < w; x++) {
const idx = Math.min(curveData.length - 1, Math.floor(x / w * curveData.length));
const y = h - curveData[idx] * h * 0.9 - h * 0.05;
if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
}
ctx.stroke();
ctx.fillStyle = 'rgba(107,97,86,0.9)';
ctx.font = '10px system-ui, sans-serif';
ctx.fillText('низкие частоты', 10, h - 10);
ctx.textAlign = 'right';
ctx.fillText('высокие частоты', w - 10, h - 10);
ctx.textAlign = 'left';
}
function curveDrawAt(clientX, clientY) {
const rect = curveCanvas.getBoundingClientRect();
if (!(rect.width > 0) || !(rect.height > 0)) return;
const x = (clientX - rect.left) / rect.width;
const y = (clientY - rect.top) / rect.height;
const idx = clamp(Math.floor(x * curveData.length), 0, curveData.length - 1);
const v = clamp(1 - y, 0, 1);
if (curveLastIdx >= 0 && curveLastIdx !== idx) {
const span = idx - curveLastIdx;
for (let k = Math.min(curveLastIdx, idx); k <= Math.max(curveLastIdx, idx); k++) {
const t = (k - curveLastIdx) / span;
curveData[k] = clamp(curveLastVal + (v - curveLastVal) * t, 0, 1);
}
} else {
curveData[idx] = v;
}
curveLastIdx = idx;
curveLastVal = v;
drawCurve();
}
curveCanvas.addEventListener('pointerdown', function (e) {
curveDrawing = true;
curveLastIdx = -1;
try { curveCanvas.setPointerCapture(e.pointerId); } catch (err) {}
curveDrawAt(e.clientX, e.clientY);
});
curveCanvas.addEventListener('pointermove', function (e) { if (curveDrawing) curveDrawAt(e.clientX, e.clientY); });
curveCanvas.addEventListener('pointerup', function () { curveDrawing = false; curveLastIdx = -1; });
curveCanvas.addEventListener('pointercancel', function () { curveDrawing = false; curveLastIdx = -1; });
$('curveReset').addEventListener('click', function () {
curveData.fill(0.5);
curveLastIdx = -1;
drawCurve();
});
$('curveGen').addEventListener('click', function () {
const sr = state.sampleRate;
const dur = state.curveDur;
const snapshot = Float32Array.from(curveData);
const out = currentOutput();
const normMode = state.normMode, normTarget = state.normTarget;
const size = estimateSize(dur, sr, 1, out.bitDepth, out.format, out.mp3Bitrate);
if (size > SIZE_LIMIT) { progressFail('Слишком большой файл: ' + fmtSize(size)); return; }
runJob($('curveGen'), 'Генерация…', async function (job) {
if (out.format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
const res = await renderStream({
sr: sr, channels: 1, format: out.format, bitDepth: out.bitDepth, mp3Bitrate: out.mp3Bitrate,
bodyFrames: Math.round(dur * sr), padA: 0, padB: 0,
fadeInFrames: 0, fadeOutFrames: 0, loop: false,
seed: randomSeed(), normMode: normMode, normTarget: normTarget,
makeGen: function (c, s) { return filteredGen(buildCurveFilters(snapshot, sr), makeRng(s)); }
}, job);
applyResult(res, 'Кривая · ' + fmtTime(res.duration) + ' · ' + res.sr + ' Гц', 'curve', true);
});
});

function ditherResult(dither) {
const sr = 44100, len = sr * 5;
const ch = new Float32Array(len);
const amp = Math.pow(10, -60 / 20);
const lsb = 1 / 32768;
for (let i = 0; i < len; i++) {
let v = amp * Math.sin(2 * Math.PI * 440 * i / sr);
if (dither) v += (Math.random() - Math.random()) * lsb;
ch[i] = v;
}
const writer = makeWriter(16);
const ab = new ArrayBuffer(len * 2);
const dv = new DataView(ab);
let clipped = 0, peak = 0, sum = 0, sumSq = 0;
const mn = new Float32Array(BUCKETS), mx = new Float32Array(BUCKETS);
const step = BUCKETS / len;
const spectro = createSpectro(sr, len);
for (let i = 0; i < len; i++) {
const v = ch[i];
writer(dv, i * 2, v);
const b = Math.min(BUCKETS - 1, (i * step) | 0);
if (v < mn[b]) mn[b] = v;
if (v > mx[b]) mx[b] = v;
const a = Math.abs(v);
if (a > peak) peak = a;
if (a > 1) clipped++;
sum += v; sumSq += v * v;
}
let f = 0;
while (f < len) {
const n = Math.min(CHUNK, len - f);
spectro.feed([ch.subarray(f, f + n)], n, f);
f += n;
}
const blob = new Blob([wavHeader(sr, 1, 16, len * 2), new Uint8Array(ab)], { type: 'audio/wav' });
applyResult({
blob: blob, ext: 'wav', peaks: { min: mn, max: mx }, spectro: spectro.result(),
duration: len / sr, sr: sr,
analysis: {
peakDb: 20 * Math.log10(Math.max(peak, 1e-12)),
rmsDb: 20 * Math.log10(Math.max(Math.sqrt(sumSq / len), 1e-12)),
lufs: NaN, dc: sum / len, clipped: clipped, limited: false
}
}, 'Тихий тон −60 dBFS · ' + (dither ? 'с дизерингом' : 'без дизеринга'), dither ? 'sine-dither' : 'sine-nodither', false);
}
$('ditherNo').addEventListener('click', function () { ditherResult(false); });
$('ditherYes').addEventListener('click', function () { ditherResult(true); });

$('calibBtn').addEventListener('click', function () {
const sr = state.sampleRate;
const dur = state.calibDur;
runJob($('calibBtn'), 'Генерация…', async function (job) {
const res = await renderStream({
sr: sr, channels: 1, format: 'wav', bitDepth: 16, mp3Bitrate: 192,
bodyFrames: Math.round(dur * sr), padA: 0, padB: 0,
fadeInFrames: 0, fadeOutFrames: 0, loop: false,
seed: randomSeed(), normMode: 'rms', normTarget: -20,
makeGen: function (c, s) { return createNoiseGen('pink', sr, s); }
}, job);
applyResult(res, 'Калибровка · розовый −20 dBFS RMS · ' + fmtTime(res.duration), 'calib', false);
});
});

$('synthType').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('synthType').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.synthType = btn.dataset.synth;
});
const SYNTH_LABELS = { wind: 'Ветер', rain: 'Дождь', surf: 'Прибой' };
$('synthBtn').addEventListener('click', function () {
const sr = state.sampleRate;
const dur = state.synthDur;
const kind = state.synthType;
const out = currentOutput();
const normMode = state.normMode, normTarget = state.normTarget;
const size = estimateSize(dur, sr, 2, out.bitDepth, out.format, out.mp3Bitrate);
if (size > SIZE_LIMIT) { progressFail('Слишком большой файл: ' + fmtSize(size)); return; }
runJob($('synthBtn'), 'Генерация…', async function (job) {
if (out.format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
const res = await renderStream({
sr: sr, channels: 2, format: out.format, bitDepth: out.bitDepth, mp3Bitrate: out.mp3Bitrate,
bodyFrames: Math.round(dur * sr), padA: 0, padB: 0,
fadeInFrames: Math.round(0.3 * sr), fadeOutFrames: Math.round(0.5 * sr), loop: false,
seed: randomSeed(), normMode: normMode, normTarget: normTarget,
makeGen: function (c, s) { return createSynthGen(kind, sr, s); }
}, job);
applyResult(res, SYNTH_LABELS[kind] + ' · ' + fmtTime(res.duration) + ' · ' + res.sr + ' Гц', 'synth-' + kind, true);
});
});

function makePercussion(kind, sr, seed) {
const rnd = makeRng(seed);
if (kind === 'kick') {
const n = Math.max(1, Math.floor(sr * 0.45));
const out = new Float32Array(n);
const f0 = 130 + rnd() * 40, fEnd = 44 + rnd() * 8;
let phase = 0;
for (let i = 0; i < n; i++) {
const t = i / n;
const f = fEnd + (f0 - fEnd) * Math.exp(-t * 26);
phase += 2 * Math.PI * f / sr;
if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
const env = Math.exp(-t * 6.5) * (1 - Math.exp(-t * 400));
const click = (rnd() * 2 - 1) * Math.exp(-t * 220) * 0.25;
out[i] = Math.tanh((Math.sin(phase) * env + click) * 1.4) * 0.9;
}
return out;
}
if (kind === 'snare') {
const n = Math.max(1, Math.floor(sr * 0.3));
const out = new Float32Array(n);
const bp = biquad('bandpass', 1900 + rnd() * 300, 0.8, 0, sr);
const hp = biquad('highpass', 500, 0.7, 0, sr);
const f1 = 175 + rnd() * 20, f2 = 330 + rnd() * 30;
let p1 = 0, p2 = 0;
for (let i = 0; i < n; i++) {
const t = i / n;
const nz = bq(hp, bq(bp, rnd() * 2 - 1)) * Math.exp(-t * 17);
p1 += 2 * Math.PI * f1 / sr;
p2 += 2 * Math.PI * f2 / sr;
const tone = (Math.sin(p1) * 0.6 + Math.sin(p2) * 0.35) * Math.exp(-t * 30);
out[i] = (nz * 0.85 + tone * 0.5) * (1 - Math.exp(-t * 600));
}
return out;
}
const n = Math.max(1, Math.floor(sr * 0.11));
const out = new Float32Array(n);
const hp = biquad('highpass', 7000 + rnd() * 1500, 0.7, 0, sr);
const bp = biquad('bandpass', 10000 + rnd() * 2000, 1.1, 0, sr);
const decay = 42 + rnd() * 16;
for (let i = 0; i < n; i++) {
const t = i / n;
out[i] = bq(bp, bq(hp, rnd() * 2 - 1)) * Math.exp(-t * decay) * (1 - Math.exp(-t * 900));
}
return out;
}
const PERC_LABELS = { snare: 'Барабан', hat: 'Тарелка', kick: 'Бочка' };
$('percType').addEventListener('click', function (e) {
const btn = e.target.closest('.seg'); if (!btn) return;
$('percType').querySelectorAll('.seg').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.percType = btn.dataset.perc;
});
$('percBtn').addEventListener('click', function () {
const sr = state.sampleRate;
const kind = state.percType;
const out = currentOutput();
runJob($('percBtn'), 'Генерация…', async function (job) {
if (out.format === 'mp3') { progressBusy('Загрузка MP3-кодировщика'); await ensureLame(); }
job.progress(0.25, 'Сборка удара');
await yieldToUI();
const arr = makePercussion(kind, sr, randomSeed());
let peak = 0;
for (let i = 0; i < arr.length; i++) { const a = Math.abs(arr[i]); if (a > peak) peak = a; }
const gain = peak > 1e-9 ? Math.pow(10, -1 / 20) / peak : 1;
const res = await encodeArrays([arr], sr, out, gain, job, 0.45, 1);
applyResult(res, PERC_LABELS[kind] + ' · ' + (arr.length / sr).toFixed(2) + ' сек', 'perc-' + kind, true);
});
});

$('tabs').addEventListener('click', function (e) {
const tab = e.target.closest('.tab');
if (!tab || tab.disabled) return;
if (state.mode === 'lab' && tab.dataset.tab !== 'lab') { stopLab(); resetLabButtons(); }
$('tabs').querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
tab.classList.add('active');
state.mode = tab.dataset.tab;
$('generatorSidebar').classList.toggle('hidden', state.mode !== 'generate');
$('mixSidebar').classList.toggle('hidden', state.mode !== 'mix');
$('labSidebar').classList.toggle('hidden', state.mode !== 'lab');
$('stageLabel').textContent = state.mode === 'mix' ? 'Наложение' : (state.mode === 'lab' ? 'Лаборатория' : 'Визуализация');
if (curveModeActive()) stageView = 'curve';
syncViewToggle();
renderCurrentView();
});
$('labTools').addEventListener('click', function (e) {
const btn = e.target.closest('.lab-tool');
if (!btn) return;
stopLab();
resetLabButtons();
$('labTools').querySelectorAll('.lab-tool').forEach(function (b) { b.classList.remove('active'); });
btn.classList.add('active');
state.labTool = btn.dataset.tool;
document.querySelectorAll('.lab-panel').forEach(function (p) {
p.classList.toggle('hidden', p.dataset.panel !== state.labTool);
});
if (curveModeActive()) stageView = 'curve';
syncViewToggle();
renderCurrentView();
});

document.addEventListener('keydown', function (e) {
const t = e.target;
const tag = t && t.tagName ? t.tagName : '';
const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
if (e.code === 'Space') {
if (typing || tag === 'BUTTON') return;
e.preventDefault();
togglePlay();
} else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
if (typing) return;
e.preventDefault();
const step = e.shiftKey ? 30 : 5;
seekBy(e.code === 'ArrowLeft' ? -step : step);
} else if (e.code === 'Home') {
if (typing) return;
e.preventDefault();
seekBy(-1e9);
}
});

if (typeof ResizeObserver === 'function') {
new ResizeObserver(function () {
if (resizeRaf) cancelAnimationFrame(resizeRaf);
resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; renderCurrentView(); });
}).observe($('visualizer'));
new ResizeObserver(measureRail).observe($('progressTrack'));
} else {
window.addEventListener('resize', function () { renderCurrentView(); measureRail(); });
}
window.addEventListener('beforeunload', function () {
if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
});

setNormMode('peak');
setMp3Bitrate(192);
setLoop(false);
syncFormatUI();
syncViewToggle();
refreshButtons();
measureRail();
showVisual('empty');
})();
