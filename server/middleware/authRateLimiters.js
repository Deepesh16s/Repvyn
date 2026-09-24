const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { isString, normalizeEmail } = require("../utils/userInput");
const { EMAIL_MAX_LENGTH } = require("../constants/userLimits");

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const fromEnv = (name, fallback) => Number(process.env[name]) || fallback;

const limiter = (options) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again later." },
    ...options,
  });

const registerLimiter = limiter({
  windowMs: fromEnv("AUTH_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("AUTH_RATE_LIMIT_MAX", 30),
});

const loginLimiter = limiter({
  windowMs: fromEnv("LOGIN_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("LOGIN_RATE_LIMIT_MAX", 30),
  skipSuccessfulRequests: true,
});

const loginAccountLimiter = limiter({
  windowMs: fromEnv("LOGIN_ACCOUNT_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("LOGIN_ACCOUNT_RATE_LIMIT_MAX", 8),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = isString(req.body?.email) ? normalizeEmail(req.body.email).slice(0, EMAIL_MAX_LENGTH) : "";
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
});

const googleLoginLimiter = limiter({
  windowMs: fromEnv("GOOGLE_LOGIN_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("GOOGLE_LOGIN_RATE_LIMIT_MAX", 30),
  skipSuccessfulRequests: true,
});

const forgotPasswordLimiter = limiter({
  windowMs: fromEnv("AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX", 5),
});

const resetPasswordLimiter = limiter({
  windowMs: fromEnv("AUTH_RESET_PASSWORD_RATE_LIMIT_WINDOW_MS", FIFTEEN_MINUTES),
  limit: fromEnv("AUTH_RESET_PASSWORD_RATE_LIMIT_MAX", 10),
});

const usernameCheckLimiter = limiter({
  windowMs: fromEnv("USERNAME_CHECK_RATE_LIMIT_WINDOW_MS", 5 * 60 * 1000),
  limit: fromEnv("USERNAME_CHECK_RATE_LIMIT_MAX", 60),
});

module.exports = {
  registerLimiter,
  loginLimiter,
  loginAccountLimiter,
  googleLoginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  usernameCheckLimiter,
};
