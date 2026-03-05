# 🤖 AI Image And Video Creator — Line OA

## โครงสร้างโปรเจค

```
line-oa-ai-creator/
├── server.js               ← Main webhook server
├── db.js                   ← User database (users.json)
├── setup-richmenu.js       ← สร้าง rich menu บน Line
├── generate-qr.js          ← สร้าง QR PromptPay 199 / 1,999 บาท
├── public/
│   ├── create-image.html   ← หน้าสร้างรูปภาพ
│   ├── create-video.html   ← หน้าสร้างวิดีโอ
│   ├── richmenu-template.html ← เทมเพลตสร้าง richmenu.png
│   ├── qr-trailer.png      ← QR 199 บาท (สร้างโดย generate-qr.js)
│   └── qr-vip.png          ← QR 1,999 บาท (สร้างโดย generate-qr.js)
├── users.json              ← สร้างอัตโนมัติ (ฐานข้อมูลผู้ใช้)
├── package.json
└── .env                    ← ใส่ credentials ตรงนี้
```

---

## ขั้นตอนติดตั้ง

### 1. Prerequisites
- Node.js 18+
- บัญชี Line Developers (developers.line.biz)
- Server ที่มี HTTPS (แนะนำ: Railway, Render, หรือ ngrok สำหรับ dev)

### 2. สร้าง Line Messaging API Channel
1. ไป https://developers.line.biz
2. สร้าง Provider → Create a Messaging API channel
3. คัดลอก **Channel Secret** และ **Channel Access Token**

### 3. ติดตั้งโปรเจค
```bash
cd line-oa-ai-creator
npm install
cp .env.example .env
```

### 4. แก้ไขไฟล์ `.env`
```
LINE_CHANNEL_ACCESS_TOKEN=xxxxxx   ← จาก Line Developers
LINE_CHANNEL_SECRET=xxxxxx          ← จาก Line Developers
BASE_URL=https://your-server.com   ← URL เซิร์ฟเวอร์คุณ (HTTPS)
PORT=3000
PROMPTPAY_ID=0812345678            ← เบอร์ PromptPay ของคุณ
ADMIN_USER_ID=Uxxxxxxxx            ← Line User ID ของคุณ (admin)
```

> **หา ADMIN_USER_ID:** รัน server ก่อน → ส่งข้อความหา bot → ดู log จะเห็น userId

### 5. สร้าง QR Code PromptPay
```bash
npm run generate-qr
```
จะสร้างไฟล์:
- `public/qr-trailer.png` — QR 199 บาท
- `public/qr-vip.png` — QR 1,999 บาท

### 6. สร้าง Rich Menu Image
1. เปิด `public/richmenu-template.html` ในเบราว์เซอร์
2. คลิก **ดาวน์โหลด richmenu.png**
3. บันทึกไฟล์เป็น `public/richmenu.png`

### 7. รัน Server
```bash
npm start
```

### 8. ตั้งค่า Webhook บน Line Developers
- Webhook URL: `https://your-server.com/webhook`
- เปิด **Use webhook: ON**
- ปิด **Auto-reply messages: OFF**
- ปิด **Greeting messages: OFF**

### 9. ตั้งค่า Rich Menu
```bash
npm run setup-richmenu
```

---

## Admin Commands

ส่งข้อความหา bot จาก LINE ของคุณ (ต้องตั้ง ADMIN_USER_ID):

| คำสั่ง | ความหมาย |
|--------|----------|
| `/activate <userId> trailer` | เปิดใช้งานแผน Trailer (1 เดือน) |
| `/activate <userId> vip` | เปิดใช้งานแผน VIP (1 ปี) |
| `/users` | ดูรายชื่อสมาชิกทั้งหมด |

---

## Flow การสมัครสมาชิก

1. ผู้ใช้กด **สมัครสมาชิก** → แสดงแผน Trailer / VIP
2. ผู้ใช้กดเลือกแผน → แสดง QR Code PromptPay พร้อมยอดเงิน
3. ผู้ใช้โอนเงินแล้วส่ง **สลิป** มาในแชท
4. Admin ได้รับแจ้งเตือน → พิมพ์ `/activate <userId> trailer` หรือ `vip`
5. ผู้ใช้ได้รับข้อความยืนยัน ✅

---

## Deploy ฟรี (แนะนำ)

### Railway
```bash
# ติดตั้ง Railway CLI แล้วรัน:
railway login
railway init
railway up
```
จากนั้นตั้ง Environment Variables ใน Railway Dashboard

### Render
1. Push code ขึ้น GitHub
2. สร้าง Web Service บน render.com
3. Build Command: `npm install`
4. Start Command: `npm start`
5. ตั้ง Environment Variables

---

## หมายเหตุ

- **ฟีเจอร์สร้างรูป** ใช้ Pollinations.ai (ฟรี ไม่ต้อง API Key)
- **ฟีเจอร์สร้างวิดีโอ** ตอนนี้เป็น demo — ต้องเพิ่ม API ของจริง (เช่น Runway ML, Pika)
- ฐานข้อมูล `users.json` เหมาะสำหรับขนาดเล็ก หากมีผู้ใช้เยอะ แนะนำเปลี่ยนเป็น MongoDB หรือ PostgreSQL
