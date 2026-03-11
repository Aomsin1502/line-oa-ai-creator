require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const line = require('@line/bot-sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const db = require('./db');

// ffmpeg path configured for execFile calls

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

// ─────────────────────────────────────────────
//  Rich Menu helpers
// ─────────────────────────────────────────────
async function setRichMenu(userId, menuId) {
  if (!menuId) return;
  try {
    await axios.post(
      `https://api.line.me/v2/bot/user/${userId}/richmenu/${menuId}`,
      {},
      { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    console.log(`🎛  Rich menu set for ${userId}: ${menuId}`);
  } catch (e) {
    console.error('Rich menu set error:', e.response?.data || e.message);
  }
}

async function resetRichMenu(userId) {
  try {
    await axios.delete(
      `https://api.line.me/v2/bot/user/${userId}/richmenu`,
      { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    console.log(`🎛  Rich menu reset for ${userId} (back to default)`);
  } catch (e) {
    console.error('Rich menu reset error:', e.response?.data || e.message);
  }
}

const app = express();

// In-memory recent request log (last 20 entries)
const recentRequests = [];

// Serve public HTML pages (accessible to everyone)
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('🤖 AI Image And Video Creator Bot is running!');
});

// ─────────────────────────────────────────────
//  Network diagnostic
// ─────────────────────────────────────────────
app.get('/api/test-network', async (req, res) => {
  const results = {};
  const BH = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': 'https://pollinations.ai/',
  };
  const base = 'https://image.pollinations.ai/prompt/cat?width=64&height=64&nologo=true&seed=';
  for (const [label, opts] of [
    ['plain', { responseType: 'arraybuffer', timeout: 30000 }],
    ['withHeaders', { responseType: 'arraybuffer', timeout: 30000, headers: BH }],
  ]) {
    try {
      const r = await axios.get(base + (label === 'plain' ? '1' : '2'), opts);
      const ct = r.headers['content-type'] || '';
      results[label] = { ok: true, status: r.status, ct, bytes: r.data?.byteLength };
    } catch (e) {
      results[label] = { ok: false, status: e.response?.status, msg: e.message.slice(0, 100) };
    }
  }
  res.json(results);
});

// Browser-like headers for Pollinations
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'th,en;q=0.9',
  'Referer': 'https://pollinations.ai/',
};

// ── Translate to English via Google Translate (unofficial, no key) ──
async function translateToEnglish(text) {
  // Skip if already mostly ASCII (likely already English)
  const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  if (thaiChars === 0) return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const r = await axios.get(url, { timeout: 4000 });
    const translated = r.data?.[0]?.map(s => s?.[0]).filter(Boolean).join('') || text;
    console.log(`🌐 Translated: "${text.slice(0,40)}" → "${translated.slice(0,60)}"`);
    return translated;
  } catch (e) {
    console.log(`⚠️ Translate failed: ${e.message}, using original`);
    return text;
  }
}

// ── Stable Horde: free distributed SD network ──────────────────
async function generateWithStableHorde(prompt) {
  const HORDE_KEY = process.env.STABLE_HORDE_KEY || '0000000000';
  const headers = { 'Content-Type': 'application/json', 'apikey': HORDE_KEY };

  // Prepend quality booster tags
  const enhancedPrompt = `${prompt}, highly detailed, sharp focus, masterpiece, best quality`;

  // Submit job — prefer models with most workers
  const sub = await axios.post('https://stablehorde.net/api/v2/generate/async', {
    prompt: enhancedPrompt,
    params: { width: 512, height: 512, steps: 15, n: 1, sampler_name: 'k_dpmpp_2m',
              cfg_scale: 7, karras: true },
    nsfw: false, censor_nsfw: true,
    models: ['Deliberate', 'Dreamshaper', 'AbsoluteReality', 'stable_diffusion'],
    r2: true,
  }, { headers, timeout: 15000 });

  const jobId = sub.data.id;
  if (!jobId) throw new Error('No job ID from Stable Horde');
  console.log(`🐴 Stable Horde job: ${jobId}`);

  // Poll until done (max 4 min)
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 6000));
    const check = await axios.get(`https://stablehorde.net/api/v2/generate/check/${jobId}`,
      { headers, timeout: 10000 });
    console.log(`🐴 Horde status: done=${check.data.done} wait=${check.data.wait_time}s`);
    if (check.data.faulted) throw new Error('Stable Horde job faulted');
    if (check.data.done) break;
  }

  // Retrieve image
  const result = await axios.get(`https://stablehorde.net/api/v2/generate/status/${jobId}`,
    { headers, timeout: 15000 });
  const gen = result.data?.generations?.[0];
  if (!gen || gen.state !== 'ok') throw new Error('No result from Stable Horde');

  // gen.img is a URL (Cloudflare R2), fetch it
  const imgResp = await axios.get(gen.img, { responseType: 'arraybuffer', timeout: 30000 });
  const imgBuf = Buffer.from(imgResp.data);
  if (imgBuf.length < 500) throw new Error(`Stable Horde image too small: ${imgBuf.length}b`);
  return imgBuf;
}

// ── CF Worker proxy → Pollinations (unlimited free, ~5s) ─────────
async function generateWithCFWorker(prompt, seed) {
  const workerUrl = process.env.CF_WORKER_URL;
  if (!workerUrl) throw new Error('No CF_WORKER_URL');
  const url = `${workerUrl}?prompt=${encodeURIComponent(prompt)}&seed=${seed}&width=1024&height=1024`;
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  const ct = resp.headers['content-type'] || '';
  if (!ct.includes('image') || resp.data?.byteLength < 500)
    throw new Error(`CF Worker bad response: ${ct} ${resp.data?.byteLength}b`);
  return { buffer: Buffer.from(resp.data), ct };
}

// ── Cloudflare Workers AI — FLUX Schnell (free tier, ~5-15s) ────
async function generateWithCloudflare(prompt) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error('No Cloudflare credentials');
  const resp = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    { prompt, steps: 4 },
    { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const b64 = resp.data?.result?.image;
  if (!b64) throw new Error(`No image from Cloudflare: ${JSON.stringify(resp.data).slice(0,100)}`);
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 500) throw new Error(`CF image too small: ${buf.length}b`);
  return { buffer: buf, ct: 'image/jpeg' };
}

// ── fal.ai FLUX Schnell (requires FAL_KEY env var — free signup) ──
async function generateWithFal(prompt) {
  const token = process.env.FAL_KEY;
  if (!token) throw new Error('No FAL_KEY');
  const resp = await axios.post(
    'https://fal.run/fal-ai/flux/schnell',
    { prompt, image_size: 'square', num_inference_steps: 4, output_format: 'jpeg', sync_mode: true },
    { headers: { 'Authorization': `Key ${token}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const imageData = resp.data?.images?.[0]?.url;
  if (!imageData) throw new Error('No image from fal');
  let buf;
  if (imageData.startsWith('data:')) {
    buf = Buffer.from(imageData.split(',')[1], 'base64');
  } else {
    const r = await axios.get(imageData, { responseType: 'arraybuffer', timeout: 30000 });
    buf = Buffer.from(r.data);
  }
  if (buf.length < 500) throw new Error(`fal image too small: ${buf.length}b`);
  return { buffer: buf, ct: 'image/jpeg' };
}

// ── HuggingFace (requires HUGGINGFACE_TOKEN env var) ────────────
async function generateWithHuggingFace(prompt) {
  const token = process.env.HUGGINGFACE_TOKEN;
  if (!token) throw new Error('No HUGGINGFACE_TOKEN');
  const hf = await axios.post(
    'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-2-1',
    { inputs: prompt },
    {
      responseType: 'arraybuffer', timeout: 120000,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  const ct = hf.headers['content-type'] || '';
  if (!ct.includes('image') || hf.data?.byteLength < 500) throw new Error('HF non-image response');
  return { buffer: Buffer.from(hf.data), ct };
}

// ─────────────────────────────────────────────
//  Image generation proxy
// ─────────────────────────────────────────────
app.get('/api/generate-image', async (req, res) => {
  const { prompt } = req.query;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const seed = Math.floor(Math.random() * 999999);
  const fullPrompt = await translateToEnglish(prompt);

  // ── 1. CF Worker → Pollinations (unlimited free, ~5s) ────────────
  if (process.env.CF_WORKER_URL) {
    try {
      console.log('🌐 CF Worker → Pollinations...');
      const { buffer, ct } = await generateWithCFWorker(fullPrompt, seed);
      console.log(`✅ CF Worker OK: ${buffer.length}b`);
      res.set('Content-Type', ct);
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (e) { console.log(`⚠️ CF Worker: ${e.message}`); }
  }

  // ── 2. Cloudflare Workers AI — FLUX Schnell (~10s) ───────────────
  if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) {
    try {
      console.log('☁️ Cloudflare AI FLUX...');
      const { buffer, ct } = await generateWithCloudflare(fullPrompt);
      console.log(`✅ Cloudflare AI OK: ${buffer.length}b`);
      res.set('Content-Type', ct);
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (e) { console.log(`⚠️ Cloudflare AI: ${e.message}`); }
  }

  // ── 3. Stable Horde (registered key = priority queue) ────────────
  try {
    console.log('🐴 Stable Horde...');
    const buf = await generateWithStableHorde(fullPrompt);
    console.log(`✅ Stable Horde OK: ${buf.length}b`);
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'no-store');
    return res.send(buf);
  } catch (e) { console.log(`⚠️ Stable Horde: ${e.message}`); }

  // ── 3. fal.ai fallback (if credit remains) ──────────────────────
  if (process.env.FAL_KEY) {
    try {
      console.log('⚡ fal.ai fallback...');
      const { buffer, ct } = await generateWithFal(fullPrompt);
      console.log(`✅ fal.ai OK: ${buffer.length}b`);
      res.set('Content-Type', ct);
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (e) { console.log(`⚠️ fal.ai: ${e.message}`); }
  }

  return res.status(500).json({ error: 'ไม่สามารถสร้างรูปภาพได้ กรุณาลองใหม่อีกครั้ง' });
});

// ─────────────────────────────────────────────
//  Video generation — images → MP4 via ffmpeg
// ─────────────────────────────────────────────
app.get('/api/generate-video', async (req, res) => {
  const { prompt, userId, duration } = req.query;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const user = db.getUser(userId);
  if (!user || !user.isActive) {
    return res.status(403).json({ error: 'กรุณาสมัครสมาชิกก่อนสร้างวิดีโอ' });
  }

  const maxSec = user.plan === 'vip' ? 60 : 30;
  const durationSec = Math.min(Math.max(parseInt(duration || 15), 10), maxSec);
  // 5 seconds per image clip (Ken Burns); max 8 images to cap generation time
  const numImages = Math.min(Math.max(Math.ceil(durationSec / 5), 2), 8);
  const secPerClip = durationSec / numImages;
  const FPS = 25;
  const seed = Math.floor(Math.random() * 999999);
  const fullPrompt = await translateToEnglish(decodeURIComponent(prompt));
  console.log(`🎬 ${numImages} images × ${secPerClip.toFixed(1)}s each = ${durationSec}s video`);

  // ── Generate images (same fallback chain as image proxy) ──
  async function getOneImage(scenePrompt) {
    if (process.env.CF_WORKER_URL) {
      try { const { buffer } = await generateWithCFWorker(scenePrompt, Math.floor(Math.random()*999999)); return buffer; }
      catch (e) { console.log(`⚠️ CF Worker img: ${e.message}`); }
    }
    if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) {
      try { const { buffer } = await generateWithCloudflare(scenePrompt); return buffer; }
      catch (e) { console.log(`⚠️ CF AI img: ${e.message}`); }
    }
    try { return await generateWithStableHorde(scenePrompt); }
    catch (e) { console.log(`⚠️ Stable Horde img: ${e.message}`); }
    if (process.env.FAL_KEY) {
      try { const { buffer } = await generateWithFal(scenePrompt); return buffer; }
      catch (e) { console.log(`⚠️ fal img: ${e.message}`); }
    }
    throw new Error('All image sources failed');
  }

  // Generate all images in parallel
  const imagePromises = Array.from({ length: numImages }, (_, i) => {
    const scenePrompt = i === 0 ? fullPrompt : `${fullPrompt}, scene ${i + 1}, different angle`;
    return getOneImage(scenePrompt)
      .then(buf => { console.log(`✅ Image ${i + 1}/${numImages} OK`); return buf; })
      .catch(e => { console.log(`⚠️ Image ${i + 1} failed: ${e.message}`); return null; });
  });

  const imageBuffers = (await Promise.all(imagePromises)).filter(Boolean);
  console.log(`📦 Got ${imageBuffers.length}/${numImages} images`);

  if (imageBuffers.length === 0) {
    return res.status(500).json({ error: 'ไม่สามารถสร้างรูปภาพได้ กรุณาลองใหม่อีกครั้ง' });
  }

  // ── Build MP4: xfade crossfade transitions (fast encode) ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivideo-'));
  const outputPath = path.join(tmpDir, 'output.mp4');

  try {
    const N = imageBuffers.length;
    const actualSecPerClip = durationSec / N;
    const fadeDur = Math.min(0.8, actualSecPerClip * 0.25);

    // Save images
    const imgPaths = imageBuffers.map((buf, i) => {
      const p = path.join(tmpDir, `img_${i}.jpg`);
      fs.writeFileSync(p, buf);
      return p;
    });

    // Build ffmpeg args: all images as looped inputs + xfade filter_complex
    const ffmpegArgs = [];
    imgPaths.forEach(p => {
      ffmpegArgs.push('-loop', '1', '-t', (actualSecPerClip + 1).toFixed(2), '-i', p);
    });

    const scaleFilter = (i) =>
      `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,` +
      `pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=25,setsar=1,format=yuv420p[v${i}]`;

    const scales = imgPaths.map((_, i) => scaleFilter(i)).join(';');

    let chain = '';
    let prevLabel = 'v0';
    for (let i = 1; i < N; i++) {
      const outLabel = i === N - 1 ? 'out' : `f${i}`;
      const xOffset = (i * (actualSecPerClip - fadeDur)).toFixed(3);
      chain += `${chain ? ';' : ''}[${prevLabel}][v${i}]xfade=transition=fade:duration=${fadeDur.toFixed(2)}:offset=${xOffset}[${outLabel}]`;
      prevLabel = outLabel;
    }

    const filterComplex = N === 1
      ? `${scales};[v0]copy[out]`
      : `${scales};${chain}`;

    ffmpegArgs.push(
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', 'faststart',
      '-t', durationSec.toFixed(2),
      outputPath
    );

    console.log(`🎬 ffmpeg xfade: ${N} images, ${actualSecPerClip.toFixed(1)}s each, fade=${fadeDur.toFixed(2)}s`);
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ffmpegArgs, { timeout: 180000 }, (err, _stdout, stderr) => {
        if (err) {
          console.error('❌ ffmpeg error:', stderr?.slice(-500));
          reject(new Error(err.message));
        } else {
          console.log('✅ ffmpeg xfade done');
          resolve();
        }
      });
    });

    const videoBuffer = fs.readFileSync(outputPath);
    console.log(`📹 MP4 ready: ${videoBuffer.length} bytes`);

    res.set('Content-Type', 'video/mp4');
    res.set('Cache-Control', 'no-store');
    res.send(videoBuffer);

  } catch (err) {
    console.error('❌ Video creation error:', err.message);
    res.status(500).json({ error: 'ไม่สามารถสร้างวิดีโอได้ กรุณาลองใหม่อีกครั้ง' });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

// ─────────────────────────────────────────────
//  Admin Panel (password protected)
// ─────────────────────────────────────────────
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin1234';

app.get('/admin', (req, res) => {
  const users = db.getAllUsers();
  const rows = Object.values(users).map(u => `
    <tr>
      <td style="font-size:11px;word-break:break-all">${u.userId}</td>
      <td>${u.plan}</td>
      <td>${u.isActive ? '✅ Active' : '❌ Expired'}</td>
      <td>${u.expiresAt ? u.expiresAt.slice(0,10) : '-'}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center">ยังไม่มีสมาชิก</td></tr>';

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin Panel</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:16px;background:#f5f5f5}
  h2{color:#6C63FF}
  .card{background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
  input,select{padding:8px;border:1px solid #ddd;border-radius:6px;width:100%;box-sizing:border-box;margin:4px 0 12px}
  button{background:#6C63FF;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:15px}
  button:hover{background:#5a52e0}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#6C63FF;color:#fff;padding:8px;text-align:left}
  td{padding:8px;border-bottom:1px solid #eee}
  .msg{padding:10px;border-radius:6px;margin-bottom:12px}
  .ok{background:#d4edda;color:#155724}
  .err{background:#f8d7da;color:#721c24}
</style></head>
<body>
<h2>🤖 Admin Panel — AI Image Creator</h2>
<div class="card">
  <h3>เปิดใช้งานสมาชิก</h3>
  <form method="POST" action="/admin/activate">
    <label>รหัสผ่าน Admin</label>
    <input type="password" name="pass" placeholder="รหัสผ่าน" required>
    <label>LINE User ID (รับจากแจ้งเตือนสลิป)</label>
    <input type="text" name="userId" placeholder="U36ff61ec26d76fbdbb4993ceb1d88f12" required>
    <label>แผน</label>
    <select name="plan">
      <option value="trailer">🎬 Trailer — 199 บาท / 1 เดือน</option>
      <option value="vip">⭐ VIP — 1,999 บาท / 1 ปี</option>
    </select>
    <button type="submit">✅ เปิดใช้งาน</button>
  </form>
</div>
<div class="card">
  <h3>สมาชิกทั้งหมด (${Object.keys(users).length} คน)</h3>
  <table>
    <tr><th>LINE User ID</th><th>แผน</th><th>สถานะ</th><th>หมดอายุ</th></tr>
    ${rows}
  </table>
</div>
</body></html>`);
});

app.post('/admin/activate', express.urlencoded({ extended: true }), async (req, res) => {
  const { pass, userId, plan } = req.body;
  if (pass !== ADMIN_PASS) {
    return res.send('<script>alert("รหัสผ่านผิด!");history.back();</script>');
  }
  if (!userId || !['trailer', 'vip'].includes(plan)) {
    return res.send('<script>alert("ข้อมูลไม่ถูกต้อง");history.back();</script>');
  }
  db.activateUser(userId, plan);
  await setRichMenu(userId, process.env.RICH_MENU_VIP_ID); // สลับเป็น VIP menu
  const planName = plan === 'trailer' ? 'Trailer (1 เดือน)' : 'VIP (1 ปี)';
  // Push notification to user
  try {
    await client.pushMessage({
      to: userId,
      messages: [{
        type: 'text',
        text: `🎉 ยืนยันการสมัครสมาชิกสำเร็จ!\n\nแผน: ${planName}\n✅ เปิดใช้งานแล้ว\n\nสามารถสร้างรูปและวิดีโอได้ทันที!`,
      }],
    });
  } catch (e) {
    console.error('Push error:', e.message);
  }
  res.send(`<script>alert("✅ เปิดใช้งาน ${planName} สำเร็จ!");location.href='/admin';</script>`);
});

// Debug endpoint — check env vars + recent webhook hits
app.get('/debug', (req, res) => {
  res.json({
    hasToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    tokenLength: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').length,
    hasSecret: !!process.env.LINE_CHANNEL_SECRET,
    secretLength: (process.env.LINE_CHANNEL_SECRET || '').length,
    secretPreview: (process.env.LINE_CHANNEL_SECRET || '').slice(0, 6) + '...',
    baseUrl: process.env.BASE_URL,
    adminUserId: process.env.ADMIN_USER_ID,
    nodeEnv: process.env.NODE_ENV,
    recentRequests,
  });
});

// Line Webhook — manual signature verification (more reliable than line.middleware)
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const entry = {
    time: new Date().toISOString(),
    signature: req.headers['x-line-signature'] ? 'present' : 'missing',
    contentType: req.headers['content-type'],
  };
  recentRequests.unshift(entry);
  if (recentRequests.length > 20) recentRequests.pop();
  console.log('📩 Webhook POST received at', entry.time);

  // Verify LINE signature manually
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    console.error('Missing x-line-signature header');
    entry.error = 'missing signature';
    return res.sendStatus(400);
  }

  const rawBody = req.body; // Buffer from express.raw()
  const hmac = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET);
  hmac.update(rawBody);
  const expectedSig = hmac.digest('base64');

  if (signature !== expectedSig) {
    console.error('Signature mismatch — received:', signature.slice(0, 20), 'expected:', expectedSig.slice(0, 20));
    entry.error = 'signature mismatch';
    return res.sendStatus(400);
  }

  res.sendStatus(200); // ตอบ LINE ทันที ไม่ให้ timeout

  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString());
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return;
  }

  const events = parsed.events || [];
  console.log('✅ Webhook validated, events:', events.length);
  events.forEach((event) => {
    const info = event.message?.text || event.postback?.data || event.type;
    const userId = event.source?.userId;
    console.log('  Event:', event.type, info, '| userId:', userId);
    if (recentRequests[0]) {
      recentRequests[0].events = (recentRequests[0].events || []).concat(info);
      recentRequests[0].userId = userId; // log userId for identification
    }
    handleEvent(event).catch((err) => {
      console.error('=== LINE API ERROR ===');
      console.error('message:', err.message);
      console.error('status:', err.status || err.statusCode);
      console.error('body:', JSON.stringify(err?.body || err?.response?.data || ''));
    });
  });
});

// ─────────────────────────────────────────────
//  Main event dispatcher
// ─────────────────────────────────────────────
async function handleEvent(event) {
  if (event.type === 'follow') return handleFollow(event);

  if (event.type === 'message') {
    if (event.message.type === 'text') return handleTextMessage(event);
    if (event.message.type === 'image') return handleSlipImage(event);
  }

  if (event.type === 'postback') return handlePostback(event);

  return null;
}

// ─────────────────────────────────────────────
//  Follow (new user)
// ─────────────────────────────────────────────
async function handleFollow(event) {
  const greetingImgUrl = `${process.env.BASE_URL}/public/richmessage-greeting.png`;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'ยินดีต้อนรับสู่ AI Image And Video Creator!',
        contents: {
          type: 'bubble',
          hero: {
            type: 'image',
            url: greetingImgUrl,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
              { type: 'text', text: 'ยินดีต้อนรับ! 🎉', weight: 'bold', size: 'lg' },
              { type: 'text', text: 'เลือกเมนูด้านล่างเพื่อเริ่มต้น:', size: 'sm', color: '#666666', wrap: true },
              { type: 'separator', margin: 'md' },
              {
                type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
                contents: [
                  { type: 'text', text: '🎨 สร้างรูป — สร้างรูปภาพด้วย AI', size: 'sm', wrap: true },
                  { type: 'text', text: '🎬 สร้างวิดีโอ — ต้องสมัครสมาชิก', size: 'sm', color: '#888888', wrap: true },
                  { type: 'text', text: '💎 สมัครสมาชิก — ดูแผนราคา', size: 'sm', wrap: true },
                ],
              },
            ],
          },
        },
      },
    ],
  });
}

// ─────────────────────────────────────────────
//  Text message router
// ─────────────────────────────────────────────
async function handleTextMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();

  // Admin commands
  if (userId === process.env.ADMIN_USER_ID) {
    if (text.startsWith('/activate ')) {
      const parts = text.split(' ');
      return handleAdminActivate(event, parts[1], parts[2] || 'trailer');
    }
    if (text === '/users') return handleAdminListUsers(event);
    if (text === '/quitmembers') {
      db.deactivateUser(userId);
      await resetRichMenu(userId); // สลับกลับ default (locked) menu
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '✅ ออกจากสมาชิกแล้ว' }],
      });
    }
  }

  switch (text) {
    case 'สร้างรูป':
    case 'create_image':
      return handleCreateImage(event, userId);

    case 'สร้างวิดีโอ':
    case 'create_video':
      return handleCreateVideo(event, userId);

    case 'สมัครสมาชิก':
    case 'subscribe':
      return handleSubscription(event, userId);

    default:
      return null;
  }
}

// ─────────────────────────────────────────────
//  Create Image
// ─────────────────────────────────────────────
async function handleCreateImage(event, userId) {
  const user = db.getUser(userId);
  const plan = (user && user.isActive) ? user.plan : 'visitor';
  const pageUrl = `${process.env.BASE_URL}/public/create-image.html?userId=${userId}&plan=${plan}`;
  const imgUrl = `${process.env.BASE_URL}/public/richmessage-image.jpg`;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'สร้างรูปภาพ AI — คลิกเพื่อเริ่มสร้าง',
        contents: {
          type: 'bubble',
          hero: {
            type: 'image',
            url: imgUrl,
            size: 'full',
            aspectRatio: '5:3',
            aspectMode: 'cover',
            action: { type: 'uri', uri: pageUrl },
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '12px',
            contents: [{
              type: 'button', style: 'primary',
              action: { type: 'uri', label: '🎨 เริ่มสร้างรูปภาพ', uri: pageUrl },
            }],
          },
        },
      },
    ],
  });
}

// ─────────────────────────────────────────────
//  Create Video
// ─────────────────────────────────────────────
async function handleCreateVideo(event, userId) {
  const user = db.getUser(userId);

  if (!user || !user.isActive) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [lockedMessage()],
    });
  }

  const maxDuration = user.plan === 'vip' ? 60 : 30; // seconds
  const pageUrl = `${process.env.BASE_URL}/public/create-video.html?userId=${userId}&plan=${user.plan}&maxDuration=${maxDuration}`;
  const imgUrl = user.plan === 'vip'
    ? `${process.env.BASE_URL}/public/richmessage-video-vip.jpg`
    : `${process.env.BASE_URL}/public/richmessage-video-trailer.jpg`;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'สร้างวิดีโอ AI — คลิกเพื่อเริ่มสร้าง',
        contents: {
          type: 'bubble',
          hero: {
            type: 'image',
            url: imgUrl,
            size: 'full',
            aspectRatio: '3:2',
            aspectMode: 'cover',
            action: { type: 'uri', uri: pageUrl },
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '12px',
            contents: [{
              type: 'button', style: 'primary',
              action: { type: 'uri', label: '🎬 เริ่มสร้างวิดีโอ', uri: pageUrl },
            }],
          },
        },
      },
    ],
  });
}

// ─────────────────────────────────────────────
//  Subscription menu
// ─────────────────────────────────────────────
async function handleSubscription(event, userId) {
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'เลือกแผนสมาชิก',
        contents: {
          type: 'carousel',
          contents: [trailerBubble(userId), vipBubble(userId)],
        },
      },
    ],
  });
}

function trailerBubble(userId) {
  const imgUrl = `${process.env.BASE_URL}/public/richmessage-trailer.jpg`;
  return {
    type: 'bubble', size: 'mega',
    hero: {
      type: 'image',
      url: imgUrl,
      size: 'full',
      aspectRatio: '4:5',
      aspectMode: 'cover',
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '12px',
      contents: [{
        type: 'button', style: 'primary',
        action: { type: 'postback', label: 'สมัคร Trailer 199 บาท', data: `action=pay&plan=trailer&userId=${userId}` },
      }],
    },
  };
}

function vipBubble(userId) {
  const imgUrl = `${process.env.BASE_URL}/public/richmessage-vip.jpg`;
  return {
    type: 'bubble', size: 'mega',
    hero: {
      type: 'image',
      url: imgUrl,
      size: 'full',
      aspectRatio: '4:5',
      aspectMode: 'cover',
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '12px',
      contents: [{
        type: 'button', style: 'primary',
        action: { type: 'postback', label: 'สมัคร VIP 1,999 บาท', data: `action=pay&plan=vip&userId=${userId}` },
      }],
    },
  };
}

// ─────────────────────────────────────────────
//  Postback — Pay
// ─────────────────────────────────────────────
async function handlePostback(event) {
  const params = new URLSearchParams(event.postback.data);
  const action = params.get('action');
  const plan = params.get('plan');
  const userId = event.source.userId;

  if (action === 'pay') {
    const planName = plan === 'trailer' ? 'Trailer (1 เดือน)' : 'VIP (1 ปี)';
    const qrUrl = plan === 'trailer'
      ? `${process.env.BASE_URL}/public/qr-trailer.png`
      : `${process.env.BASE_URL}/public/qr-vip.png`;
    const buyImgUrl = plan === 'trailer'
      ? `${process.env.BASE_URL}/public/richmessage-buy-trailer.jpg`
      : `${process.env.BASE_URL}/public/richmessage-buy-vip.jpg`;

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'flex',
          altText: `ข้อมูลการชำระเงิน ${planName}`,
          contents: {
            type: 'bubble',
            hero: {
              type: 'image',
              url: buyImgUrl,
              size: 'full',
              aspectRatio: '4:3',
              aspectMode: 'cover',
            },
          },
        },
        { type: 'image', originalContentUrl: qrUrl, previewImageUrl: qrUrl },
      ],
    });
  }
}

// ─────────────────────────────────────────────
//  Slip received → notify admin
// ─────────────────────────────────────────────
async function handleSlipImage(event) {
  const userId = event.source.userId;

  if (process.env.ADMIN_USER_ID) {
    await client.pushMessage({
      to: process.env.ADMIN_USER_ID,
      messages: [
        {
          type: 'text',
          text: `📨 สลิปชำระเงินจาก: ${userId}\n\nยืนยันสมาชิกด้วยคำสั่ง:\n/activate ${userId} trailer\nหรือ\n/activate ${userId} vip`,
        },
      ],
    });
  }

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: '✅ ได้รับสลิปแล้ว!\n\nทีมงานจะตรวจสอบและเปิดใช้งานภายใน 30 นาที\nขอบคุณที่ใช้บริการ 🙏',
    }],
  });
}

// ─────────────────────────────────────────────
//  Admin: activate user
// ─────────────────────────────────────────────
async function handleAdminActivate(event, targetUserId, plan) {
  if (!targetUserId || !['trailer', 'vip'].includes(plan)) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'Usage: /activate <userId> <trailer|vip>' }],
    });
  }

  db.activateUser(targetUserId, plan);
  await setRichMenu(targetUserId, process.env.RICH_MENU_VIP_ID); // สลับเป็น VIP menu
  const planName = planLabel(plan);

  await client.pushMessage({
    to: targetUserId,
    messages: [{
      type: 'flex',
      altText: 'สมัครสมาชิกสำเร็จ!',
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', spacing: 'md',
          contents: [
            { type: 'text', text: '🎉', size: 'xxl', align: 'center' },
            { type: 'text', text: 'ยืนยันการสมัครสมาชิกสำเร็จ!', weight: 'bold', size: 'lg', align: 'center', wrap: true },
            { type: 'separator' },
            { type: 'text', text: `แผน: ${planName}`, size: 'md', align: 'center', color: '#6C63FF', margin: 'md' },
            { type: 'text', text: '✅ เปิดใช้งานแล้ว', size: 'xl', align: 'center', color: '#27AE60', weight: 'bold' },
            { type: 'text', text: 'สามารถสร้างรูปและวิดีโอได้ทันที!', size: 'sm', align: 'center', color: '#666666', wrap: true },
          ],
        },
      },
    }],
  });

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `✅ เปิดใช้งาน ${targetUserId} แผน ${planName} สำเร็จ` }],
  });
}

// ─────────────────────────────────────────────
//  Admin: list users
// ─────────────────────────────────────────────
async function handleAdminListUsers(event) {
  const users = db.getAllUsers();
  const list = Object.values(users)
    .map((u) => `${u.userId.slice(0, 12)}... | ${u.plan} | ${u.isActive ? '✅' : '❌'} | exp: ${u.expiresAt ? u.expiresAt.slice(0, 10) : '-'}`)
    .join('\n');

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `👥 ผู้ใช้ทั้งหมด:\n\n${list || 'ยังไม่มีผู้ใช้'}` }],
  });
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function planLabel(plan) {
  return plan === 'vip' ? '⭐ VIP (1 ปี)' : '🎬 Trailer (1 เดือน)';
}

function lockedMessage() {
  const imgUrl = `${process.env.BASE_URL}/public/richmessage-locked.jpg`;
  return {
    type: 'flex',
    altText: 'สร้างวิดีโอถูกล็อก — กรุณาสมัครสมาชิก',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: imgUrl,
        size: 'full',
        aspectRatio: '3:2',
        aspectMode: 'cover',
        action: { type: 'message', text: 'สมัครสมาชิก' },
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary',
          action: { type: 'message', label: '💎 สมัครสมาชิก', text: 'สมัครสมาชิก' },
        }],
      },
    },
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Webhook: ${process.env.BASE_URL}/webhook`);
});
