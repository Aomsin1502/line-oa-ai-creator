require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const line = require('@line/bot-sdk');
const path = require('path');
const db = require('./db');

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
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'ยินดีต้อนรับสู่ AI Image And Video Creator!',
        contents: {
          type: 'bubble',
          header: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '24px',
            backgroundColor: '#6C63FF',
            contents: [
              { type: 'text', text: '🤖 AI Image & Video Creator', weight: 'bold', size: 'xl', color: '#ffffff', align: 'center' },
              { type: 'text', text: 'สร้างรูปภาพและวิดีโอด้วย AI', size: 'sm', color: '#d4d0ff', align: 'center', margin: 'sm' },
            ],
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

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'สร้างรูปภาพ AI',
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', spacing: 'md',
            contents: [
              { type: 'text', text: '🎨 สร้างรูปภาพ AI', weight: 'bold', size: 'lg' },
              { type: 'text', text: 'ฟรี! สร้างรูปภาพด้วย AI ได้เลย', size: 'sm', color: '#27AE60' },
              { type: 'text', text: 'คลิกปุ่มด้านล่างเพื่อเริ่มสร้างรูปภาพ', size: 'sm', color: '#666666', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{ type: 'button', style: 'link', color: '#6C63FF', action: { type: 'uri', label: '🎨 เปิดหน้าสร้างรูป', uri: pageUrl } }],
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
      messages: [lockedMessage('สร้างวิดีโอ')],
    });
  }

  const maxDuration = user.plan === 'vip' ? 20 : 5;
  const pageUrl = `${process.env.BASE_URL}/public/create-video.html?userId=${userId}&plan=${user.plan}&maxDuration=${maxDuration}`;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'flex',
        altText: 'สร้างวิดีโอ AI',
        contents: {
          type: 'bubble',
          body: {
            type: 'box', layout: 'vertical', spacing: 'md',
            contents: [
              { type: 'text', text: '🎬 สร้างวิดีโอ AI', weight: 'bold', size: 'lg' },
              { type: 'text', text: `แผน: ${planLabel(user.plan)} ✅`, size: 'sm', color: '#27AE60' },
              { type: 'text', text: `ระยะเวลาสูงสุด: ${maxDuration} นาที`, size: 'sm', color: '#E74C3C', weight: 'bold' },
              { type: 'text', text: 'คลิกปุ่มด้านล่างเพื่อเริ่มสร้างวิดีโอ', size: 'sm', color: '#666666', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{ type: 'button', style: 'link', color: '#E74C3C', action: { type: 'uri', label: '🎬 เปิดหน้าสร้างวิดีโอ', uri: pageUrl } }],
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
  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#27AE60',
      contents: [
        { type: 'text', text: '🎬 Trailer', weight: 'bold', size: 'xl', color: '#ffffff' },
        { type: 'text', text: '1 เดือน', size: 'sm', color: '#c8f5d7' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: '199 บาท', weight: 'bold', size: 'xxl', color: '#27AE60' },
        { type: 'separator' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
          contents: [
            { type: 'text', text: '✅ สร้างรูปภาพ AI ไม่จำกัด', size: 'sm' },
            { type: 'text', text: '✅ สร้างวิดีโอสูงสุด 5 นาที', size: 'sm' },
            { type: 'text', text: '✅ ใช้งานได้ 1 เดือน', size: 'sm' },
          ],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{
        type: 'button', style: 'primary',
        action: { type: 'postback', label: 'สมัคร 199 บาท', data: `action=pay&plan=trailer&userId=${userId}` },
      }],
    },
  };
}

function vipBubble(userId) {
  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#8E44AD',
      contents: [
        {
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: '⭐ VIP', weight: 'bold', size: 'xl', color: '#ffffff', flex: 1 },
            {
              type: 'box', layout: 'vertical', backgroundColor: '#FFD700',
              paddingAll: '4px', cornerRadius: '4px',
              contents: [{ type: 'text', text: 'BEST VALUE', size: 'xs', color: '#6B3E00', weight: 'bold' }],
            },
          ],
        },
        { type: 'text', text: '1 ปี', size: 'sm', color: '#d4a8f0' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: '1,999 บาท', weight: 'bold', size: 'xxl', color: '#8E44AD' },
        { type: 'text', text: 'ประหยัด 62% เทียบรายเดือน', size: 'xs', color: '#E74C3C', weight: 'bold' },
        { type: 'separator' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
          contents: [
            { type: 'text', text: '✅ สร้างรูปภาพ AI ไม่จำกัด', size: 'sm' },
            { type: 'text', text: '✅ สร้างวิดีโอสูงสุด 20 นาที', size: 'sm' },
            { type: 'text', text: '✅ ใช้งานได้ 1 ปี', size: 'sm' },
            { type: 'text', text: '✅ สิทธิพิเศษ VIP ตลอดปี', size: 'sm', color: '#8E44AD' },
          ],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{
        type: 'button', style: 'primary',
        action: { type: 'postback', label: 'สมัคร 1,999 บาท', data: `action=pay&plan=vip&userId=${userId}` },
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
    const price = plan === 'trailer' ? '199' : '1,999';
    const planName = plan === 'trailer' ? 'Trailer (1 เดือน)' : 'VIP (1 ปี)';
    const qrUrl = plan === 'trailer'
      ? `${process.env.BASE_URL}/public/qr-trailer.png`
      : `${process.env.BASE_URL}/public/qr-vip.png`;

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'flex',
          altText: `ชำระเงิน ${planName}`,
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical', spacing: 'md',
              contents: [
                { type: 'text', text: '💳 ข้อมูลการชำระเงิน', weight: 'bold', size: 'lg' },
                { type: 'separator' },
                { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: 'แผน:', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: planName, size: 'sm', weight: 'bold', flex: 3 }] },
                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: 'ยอดชำระ:', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: `${price} บาท`, size: 'sm', weight: 'bold', color: '#E74C3C', flex: 3 }] },
                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: 'วิธีชำระ:', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: 'PromptPay / QR', size: 'sm', flex: 3 }] },
                { type: 'separator', margin: 'md' },
                { type: 'text', text: '📌 สแกน QR ด้านล่างเพื่อชำระเงิน', size: 'sm', color: '#666666', wrap: true, margin: 'md' },
                { type: 'text', text: 'หลังชำระกรุณาส่งสลิปมาในแชทนี้', size: 'sm', color: '#E74C3C', wrap: true },
              ],
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

function lockedMessage(feature) {
  return {
    type: 'flex',
    altText: `${feature}ถูกล็อก — กรุณาสมัครสมาชิก`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '🔒', size: 'xxl', align: 'center' },
          { type: 'text', text: `${feature}ถูกล็อก`, weight: 'bold', size: 'lg', align: 'center' },
          { type: 'text', text: 'สมัครสมาชิกเพื่อปลดล็อกฟีเจอร์นี้', size: 'sm', color: '#666666', align: 'center', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
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
