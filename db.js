const fs = require('fs');
const path = require('path');

// Use /data volume (Railway persistent storage) in production, local file otherwise
const DB_FILE = fs.existsSync('/data')
  ? '/data/users.json'
  : path.join(__dirname, 'users.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(userId) {
  const db = loadDB();
  const user = db[userId];
  if (!user) return null;

  // Auto-expire check
  if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
    user.isActive = false;
    db[userId] = user;
    saveDB(db);
  }
  return user;
}

function activateUser(userId, plan) {
  const db = loadDB();
  const now = new Date();
  let expiresAt;

  if (plan === 'trailer') {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 1 month
  } else if (plan === 'vip') {
    expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
  }

  db[userId] = {
    userId,
    plan,
    isActive: true,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };

  saveDB(db);
  return db[userId];
}

function getAllUsers() {
  return loadDB();
}

module.exports = { getUser, activateUser, getAllUsers };
