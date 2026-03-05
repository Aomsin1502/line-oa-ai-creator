require('dotenv').config();
const express = require('express');
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

const app = express();

// Serve public HTML pages (accessible to everyone)
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('🤖 AI Image And Video Creator Bot is running!');
});

// Line Webhook
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
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
              { type: 'text', text: 'เลือกเมนูด้านล่างเพื่อเริ่มต้น:', size: 'sm', color: '#666', wrap: true },
              { type: 'separator', margin: 'md' },
              {
                type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
                contents: [
                  { type: 'text', text: '🎨 สร้างรูป — สร้างรูปภาพด้วย AI', size: 'sm', wrap: true },
                  { type: 'text', text: '🎬 สร้างวิดีโอ — ต้องสมัครสมาชิก', size: 'sm', color: '#888', wrap: true },
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

  if (!user || !user.isActive) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [lockedMessage('สร้างรูปภาพ')],
    });
  }

  const pageUrl = `${process.env.BASE_URL}/public/create-image.html?userId=${userId}&plan=${user.plan}`;

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
              { type: 'text', text: `แผน: ${planLabel(user.plan)} ✅`, size: 'sm', color: '#27AE60' },
              { type: 'text', text: 'คลิกปุ่มด้านล่างเพื่อเริ่มสร้างรูปภาพ', size: 'sm', color: '#666', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{ type: 'button', style: 'primary', color: '#6C63FF', action: { type: 'uri', label: '🎨 เปิดหน้าสร้างรูป', uri: pageUrl } }],
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
              { type: 'text', text: 'คลิกปุ่มด้านล่างเพื่อเริ่มสร้างวิดีโอ', size: 'sm', color: '#666', wrap: true },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{ type: 'button', style: 'primary', color: '#E74C3C', action: { type: 'uri', label: '🎬 เปิดหน้าสร้างวิดีโอ', uri: pageUrl } }],
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
        { type: 'text', text: '🎬 Trailer', weight: 'bold', size: 'xl', color: '#fff' },
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
        type: 'button', style: 'primary', color: '#27AE60',
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
            { type: 'text', text: '⭐ VIP', weight: 'bold', size: 'xl', color: '#fff', flex: 1 },
            {
              type: 'box', layout: 'vertical', backgroundColor: '#FFD700',
              paddingAll: '4px', cornerRadius: '4px',
              contents: [{ type: 'text', text: 'BEST VALUE', size: 'xxs', color: '#6B3E00', weight: 'bold' }],
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
        type: 'button', style: 'primary', color: '#8E44AD',
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
                { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: 'แผน:', size: 'sm', color: '#666', flex: 2 }, { type: 'text', text: planName, size: 'sm', weight: 'bold', flex: 3 }] },
                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: 'ยอดชำระ:', size: 'sm', color: '#666', flex: 2 }, { type: 'text', text: `${price} บาท`, size: 'sm', weight: 'bold', color: '#E74C3C', flex: 3 }] },
                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: 'วิธีชำระ:', size: 'sm', color: '#666', flex: 2 }, { type: 'text', text: 'PromptPay / QR', size: 'sm', flex: 3 }] },
                { type: 'separator', margin: 'md' },
                { type: 'text', text: '📌 สแกน QR ด้านล่างเพื่อชำระเงิน', size: 'sm', color: '#666', wrap: true, margin: 'md' },
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
          text: `📨 สลิปชำระเงินจาก: ${userId}\n\nยืนยันด้วยคำสั่ง:\n/activate ${userId} trailer\nหรือ\n/activate ${userId} vip`,
        },
        event.message,
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
            { type: 'text', text: 'สามารถสร้างรูปและวิดีโอได้ทันที!', size: 'sm', align: 'center', color: '#666', wrap: true },
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
          { type: 'text', text: 'สมัครสมาชิกเพื่อปลดล็อกฟีเจอร์นี้', size: 'sm', color: '#666', align: 'center', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#6C63FF',
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
