const axios = require('axios');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCmd(...args) {
  const res = await axios.post(UPSTASH_URL, args, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    timeout: 5000,
  });
  return res.data.result;
}

async function getUser(userId) {
  const data = await redisCmd('GET', `user:${userId}`);
  if (!data) return null;
  const user = JSON.parse(data);

  // Auto-expire check
  if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
    user.isActive = false;
    await redisCmd('SET', `user:${userId}`, JSON.stringify(user));
  }
  return user;
}

async function activateUser(userId, plan) {
  const now = new Date();
  let expiresAt;

  if (plan === 'trailer') {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else if (plan === 'vip') {
    expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  const user = {
    userId,
    plan,
    isActive: true,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };

  await redisCmd('SET', `user:${userId}`, JSON.stringify(user));
  return user;
}

async function deactivateUser(userId) {
  const data = await redisCmd('GET', `user:${userId}`);
  if (data) {
    const user = JSON.parse(data);
    user.isActive = false;
    await redisCmd('SET', `user:${userId}`, JSON.stringify(user));
  }
}

async function getAllUsers() {
  const keys = await redisCmd('KEYS', 'user:*');
  if (!keys || keys.length === 0) return {};

  // Pipeline: get all users at once
  const res = await axios.post(`${UPSTASH_URL}/pipeline`, keys.map(k => ['GET', k]), {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    timeout: 5000,
  });

  const db = {};
  res.data.forEach((item) => {
    if (item.result) {
      const user = JSON.parse(item.result);
      db[user.userId] = user;
    }
  });
  return db;
}

module.exports = { getUser, activateUser, deactivateUser, getAllUsers };
