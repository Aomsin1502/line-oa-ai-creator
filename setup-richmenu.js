require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

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

async function createRichMenu() {
  const body = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Main Menu',
    chatBarText: '☰ เมนู',
    areas: [
      // สร้างรูป (left third)
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'message', label: 'สร้างรูป', text: 'สร้างรูป' },
      },
      // สร้างวิดีโอ (middle third)
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'message', label: 'สร้างวิดีโอ', text: 'สร้างวิดีโอ' },
      },
      // สมัครสมาชิก (right third)
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', label: 'สมัครสมาชิก', text: 'สมัครสมาชิก' },
      },
    ],
  };

  const res = await axios.post('https://api.line.me/v2/bot/richmenu', body, { headers: HEADERS });
  return res.data.richMenuId;
}

async function uploadRichMenuImage(richMenuId) {
  const imagePath = path.join(__dirname, 'public', 'richmenu.png');

  if (!fs.existsSync(imagePath)) {
    console.log('\n⚠️  Rich menu image not found at: public/richmenu.png');
    return false;
  }

  const imageBuffer = fs.readFileSync(imagePath);

  await axios.post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    imageBuffer,
    {
      headers: {
        ...HEADERS,
        'Content-Type': 'image/png',
        'Content-Length': imageBuffer.length,
      },
      maxBodyLength: Infinity,
    }
  );
  return true;
}

async function setDefaultRichMenu(richMenuId) {
  await axios.post(
    `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
    {},
    { headers: HEADERS }
  );
}

async function main() {
  if (!TOKEN) {
    console.error('❌ LINE_CHANNEL_ACCESS_TOKEN not set in .env');
    process.exit(1);
  }

  console.log('🔧 Setting up rich menu...\n');

  console.log('1. Deleting existing rich menus...');
  await deleteAllRichMenus();

  console.log('2. Creating rich menu structure...');
  const richMenuId = await createRichMenu();
  console.log(`   Created ID: ${richMenuId}`);

  console.log('3. Uploading rich menu image...');
  const uploaded = await uploadRichMenuImage(richMenuId);

  if (uploaded) {
    console.log('4. Setting as default rich menu...');
    await setDefaultRichMenu(richMenuId);
    console.log('\n✅ Rich menu setup complete!');
    console.log(`   Rich Menu ID: ${richMenuId}`);
  } else {
    console.log('⏸  Rich menu created but image not uploaded yet.');
    console.log(`   Run again after adding public/richmenu.png\n`);
    console.log(`   Rich Menu ID (save this): ${richMenuId}`);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.response?.data || err.message);
});
