require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function deleteAllRichMenus() {
  const res = await axios.get('https://api.line.me/v2/bot/richmenu/list', { headers: HEADERS });
  const menus = res.data.richmenus || [];
  for (const m of menus) {
    await axios.delete(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { headers: HEADERS });
    console.log(`  Deleted: ${m.richMenuId}`);
  }
}

function menuStructure(name) {
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name,
    chatBarText: '☰ เมนู',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'message', label: 'สร้างรูป', text: 'สร้างรูป' },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'message', label: 'สร้างวิดีโอ', text: 'สร้างวิดีโอ' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', label: 'สมัครสมาชิก', text: 'สมัครสมาชิก' },
      },
    ],
  };
}

async function createMenu(name) {
  const res = await axios.post('https://api.line.me/v2/bot/richmenu', menuStructure(name), { headers: HEADERS });
  return res.data.richMenuId;
}

async function uploadImage(richMenuId, imagePath) {
  if (!fs.existsSync(imagePath)) {
    console.log(`  ⚠️  Image not found: ${imagePath}`);
    return false;
  }
  const buf = fs.readFileSync(imagePath);
  await axios.post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    buf,
    {
      headers: { ...HEADERS, 'Content-Type': imagePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Content-Length': buf.length },
      maxBodyLength: Infinity,
    }
  );
  return true;
}

async function setDefaultMenu(richMenuId) {
  await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {}, { headers: HEADERS });
}

async function main() {
  if (!TOKEN) { console.error('❌ LINE_CHANNEL_ACCESS_TOKEN not set'); process.exit(1); }

  console.log('🔧 Setting up 2 rich menus...\n');

  console.log('1. Deleting existing rich menus...');
  await deleteAllRichMenus();

  console.log('\n2. Creating DEFAULT menu (locked — for non-subscribers)...');
  const lockedId = await createMenu('Menu Default (Locked)');
  const lockedOk = await uploadImage(lockedId, path.join(__dirname, 'public', 'richmenu-locked.jpg'));
  console.log(`   ID: ${lockedId}  image: ${lockedOk ? '✅' : '⚠️  missing'}`);

  console.log('\n3. Creating VIP menu (unlocked — for subscribers)...');
  const vipId = await createMenu('Menu VIP (Unlocked)');
  const vipOk = await uploadImage(vipId, path.join(__dirname, 'public', 'richmenu-vip.jpg'));
  console.log(`   ID: ${vipId}  image: ${vipOk ? '✅' : '⚠️  missing'}`);

  console.log('\n4. Setting DEFAULT menu as global default...');
  await setDefaultMenu(lockedId);

  console.log('\n✅ Done!\n');
  console.log('════════════════════════════════════════');
  console.log('📋 Add these to Railway environment variables:');
  console.log(`   RICH_MENU_DEFAULT_ID = ${lockedId}`);
  console.log(`   RICH_MENU_VIP_ID     = ${vipId}`);
  console.log('════════════════════════════════════════');
}

main().catch((err) => {
  console.error('❌ Error:', err.response?.data || err.message);
});
