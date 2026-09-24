const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const fromEnv = (name, fallback) => Number(process.env[name]) || fallback;

const limiter = (options) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again later." },
    ...options,
  });

function identify(req) {
  if (req.rateLimitIdentity) return req.rateLimitIdentity;

  let userId = null;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer")) {
    try {
      const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
      if (decoded.id) userId = String(decoded.id);
    } catch {
      userId = null;
    }
  }

  req.rateLimitIdentity = userId
    ? { key: `user:${userId}`, isUser: true }
    : { key: `ip:${ipKeyGenerator(req.ip)}`, isUser: false };
  return req.rateLimitIdentity;
}

const byUser = (req) => String(req.user._id);

const apiLimiter = limiter({
  windowMs: fromEnv("API_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: (req) =>
    identify(req).isUser
      ? fromEnv("API_USER_RATE_LIMIT_MAX", 1500)
      : fromEnv("API_ANON_RATE_LIMIT_MAX", 300),
  keyGenerator: (req) => identify(req).key,
});

const heavyReadLimiter = limiter({
  windowMs: fromEnv("HEAVY_READ_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("HEAVY_READ_RATE_LIMIT_MAX", 300),
  keyGenerator: byUser,
});

const healthSyncLimiter = limiter({
  windowMs: fromEnv("HEALTH_SYNC_RATE_LIMIT_WINDOW_MS", ONE_HOUR),
  limit: fromEnv("HEALTH_SYNC_RATE_LIMIT_MAX", 120),
  keyGenerator: byUser,
});

const notificationGenerateLimiter = limiter({
  windowMs: fromEnv("NOTIFICATION_GENERATE_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("NOTIFICATION_GENERATE_RATE_LIMIT_MAX", 60),
  keyGenerator: byUser,
});

const passwordChangeLimiter = limiter({
  windowMs: fromEnv("PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS", ONE_HOUR),
  limit: fromEnv("PASSWORD_CHANGE_RATE_LIMIT_MAX", 10),
  keyGenerator: byUser,
});

const accountDeletionLimiter = limiter({
  windowMs: fromEnv("ACCOUNT_DELETION_RATE_LIMIT_WINDOW_MS", ONE_HOUR),
  limit: fromEnv("ACCOUNT_DELETION_RATE_LIMIT_MAX", 5),
  keyGenerator: byUser,
});

module.exports = {
  apiLimiter,
  heavyReadLimiter,
  healthSyncLimiter,
  notificationGenerateLimiter,
  passwordChangeLimiter,
  accountDeletionLimiter,
};
