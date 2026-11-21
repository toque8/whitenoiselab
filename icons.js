(function () {
'use strict';
function render(size) {
const canvas = document.createElement('canvas');
canvas.width = size;
canvas.height = size;
const ctx = canvas.getContext('2d');
if (!ctx) return null;
const s = size / 32;
const r = 7 * s;
const grad = ctx.createLinearGradient(0, 0, 0, size);
grad.addColorStop(0, '#241f1a');
grad.addColorStop(1, '#141210');
ctx.beginPath();
ctx.moveTo(r, 0);
ctx.lineTo(size - r, 0);
ctx.quadraticCurveTo(size, 0, size, r);
ctx.lineTo(size, size - r);
ctx.quadraticCurveTo(size, size, size - r, size);
ctx.lineTo(r, size);
ctx.quadraticCurveTo(0, size, 0, size - r);
ctx.lineTo(0, r);
ctx.quadraticCurveTo(0, 0, r, 0);
ctx.closePath();
ctx.fillStyle = grad;
ctx.fill();
ctx.strokeStyle = '#3d352e';
ctx.lineWidth = Math.max(1, s);
ctx.stroke();
ctx.lineCap = 'round';
ctx.lineWidth = 3 * s;
const bars = [
[7, 10, 22, '#c19a6b'],
[13, 6, 26, '#d4ad7d'],
[19, 11, 21, '#c19a6b'],
[25, 7, 25, '#c19a6b']
];
for (let i = 0; i < bars.length; i++) {
const b = bars[i];
ctx.strokeStyle = b[3];
ctx.beginPath();
ctx.moveTo(b[0] * s, b[1] * s);
ctx.lineTo(b[0] * s, b[2] * s);
ctx.stroke();
}
return canvas.toDataURL('image/png');
}
try {
const png = render(180);
if (png) {
const link = document.createElement('link');
link.rel = 'apple-touch-icon';
link.sizes = '180x180';
link.type = 'image/png';
link.href = png;
document.head.appendChild(link);
}
} catch (e) {}
})();
