const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const W = 2500, H = 843;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const COL = Math.floor(W / 3);

// ── Backgrounds ─────────────────────────────
// Left: สร้างรูป (purple)
const g1 = ctx.createLinearGradient(0, 0, COL, H);
g1.addColorStop(0, '#6C63FF');
g1.addColorStop(1, '#4B45CC');
ctx.fillStyle = g1;
ctx.fillRect(0, 0, COL, H);

// Middle: สร้างวิดีโอ (dark, locked)
const g2 = ctx.createLinearGradient(COL, 0, COL * 2, H);
g2.addColorStop(0, '#2C3E50');
g2.addColorStop(1, '#1a252f');
ctx.fillStyle = g2;
ctx.fillRect(COL, 0, COL, H);

// Right: สมัครสมาชิก (red)
const g3 = ctx.createLinearGradient(COL * 2, 0, W, H);
g3.addColorStop(0, '#E74C3C');
g3.addColorStop(1, '#C0392B');
ctx.fillStyle = g3;
ctx.fillRect(COL * 2, 0, COL, H);

// ── Dividers ─────────────────────────────────
ctx.strokeStyle = 'rgba(255,255,255,0.3)';
ctx.lineWidth = 4;
[COL, COL * 2].forEach(x => {
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
});

// ── Helper functions ─────────────────────────
function fillRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function text(str, x, y, size, color, weight = 'bold', align = 'center') {
  ctx.font = `${weight} ${size}px "Segoe UI", "Tahoma", "Arial", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function circle(cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

const midY = H / 2;
const cx1 = Math.floor(COL / 2);
const cx2 = COL + Math.floor(COL / 2);
const cx3 = COL * 2 + Math.floor(COL / 2);

// ── SECTION 1: สร้างรูป ───────────────────────
circle(cx1, midY - 90, 115, 'rgba(255,255,255,0.15)');
text('🎨', cx1, midY - 90, 110, '#fff');
text('สร้างรูปภาพ', cx1, midY + 70, 78, '#ffffff');
text('AI Image Creator', cx1, midY + 165, 40, 'rgba(255,255,255,0.7)', 'normal');
ctx.fillStyle = 'rgba(255,255,255,0.2)';
fillRoundRect(cx1 - 170, H - 140, 340, 72, 36);
text('✅ พร้อมใช้งาน', cx1, H - 104, 38, '#ffffff');

// ── SECTION 2: สร้างวิดีโอ (locked) ──────────
circle(cx2, midY - 90, 115, 'rgba(255,255,255,0.08)');
// Camera icon (faded)
text('🎬', cx2, midY - 90, 110, 'rgba(255,255,255,0.3)');
// Lock overlay
circle(cx2, midY - 90, 60, 'rgba(0,0,0,0.35)');
text('🔒', cx2, midY - 90, 72, 'rgba(255,255,255,0.9)');
text('สร้างวิดีโอ', cx2, midY + 70, 78, 'rgba(255,255,255,0.45)');
text('AI Video Creator', cx2, midY + 165, 40, 'rgba(255,255,255,0.3)', 'normal');
ctx.fillStyle = 'rgba(255,255,255,0.08)';
fillRoundRect(cx2 - 200, H - 140, 400, 72, 36);
text('🔒 ต้องสมัครสมาชิก', cx2, H - 104, 36, 'rgba(255,255,255,0.5)');

// ── SECTION 3: สมัครสมาชิก ──────────────────
circle(cx3, midY - 90, 115, 'rgba(255,255,255,0.15)');
text('💎', cx3, midY - 90, 110, '#fff');
text('สมัครสมาชิก', cx3, midY + 70, 72, '#ffffff');
text('Trailer / VIP', cx3, midY + 165, 40, 'rgba(255,255,255,0.7)', 'normal');
ctx.fillStyle = 'rgba(255,255,255,0.2)';
fillRoundRect(cx3 - 230, H - 150, 460, 95, 14);
text('Trailer 199 ฿  |  VIP 1,999 ฿', cx3, H - 107, 38, '#ffffff');

// ── Save ─────────────────────────────────────
const outPath = path.join(__dirname, 'public', 'richmenu.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
console.log('✅ public/richmenu.png created! (' + Math.round(buffer.length / 1024) + ' KB)');
