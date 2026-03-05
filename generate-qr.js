require('dotenv').config();
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const PROXY = process.env.PROMPTPAY_ID;

if (!PROXY) {
  console.error('❌ PROMPTPAY_ID not set in .env');
  console.error('   Add your PromptPay phone number or national ID, e.g.:');
  console.error('   PROMPTPAY_ID=0812345678');
  process.exit(1);
}

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

async function generateQR(amount, filename) {
  const payload = generatePayload(PROXY, { amount });

  const opts = {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 600,
    color: { dark: '#000000', light: '#ffffff' },
  };

  const filePath = path.join(publicDir, filename);
  await QRCode.toFile(filePath, payload, opts);
  console.log(`  ✅ ${filename}  →  PromptPay ${amount} บาท`);
}

async function main() {
  console.log(`\n💳 Generating PromptPay QR codes`);
  console.log(`   Proxy ID: ${PROXY}`);
  console.log('─'.repeat(40));

  await generateQR(199, 'qr-trailer.png');
  await generateQR(1999, 'qr-vip.png');

  console.log('\n🎉 Done! Files saved to:');
  console.log('   public/qr-trailer.png  (199 บาท)');
  console.log('   public/qr-vip.png      (1,999 บาท)');
}

main().catch(console.error);
