const User = require("../models/User");

const MIN_LENGTH = 3;
const MAX_LENGTH = 20;
const GENERATED_BASE_LENGTH = 10;
const VALID_CHARS = /^[A-Za-z0-9_]+$/;

function normalize(raw) {
  return String(raw || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function stripInvalidChars(value) {
  return value.replace(/[^a-z0-9_]/g, "");
}

function validateFormat(username) {
  if (typeof username !== "string") return "Username is required";
  if (username.length < MIN_LENGTH) return `Username must be at least ${MIN_LENGTH} characters`;
  if (username.length > MAX_LENGTH) return `Username must be at most ${MAX_LENGTH} characters`;
  if (!VALID_CHARS.test(username)) return "Username can only contain lowercase letters, numbers, and underscores";
  return null;
}

async function isAvailable(username, { excludeUserId } = {}) {
  const value = normalize(username);
  const query = { username: value };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  const existing = await User.exists(query);
  return !existing;
}

function generateBaseUsername(email, fallbackSeed) {
  const localPart = String(email || "").split("@")[0] || "";
  const cleaned = stripInvalidChars(normalize(localPart));
  const base = cleaned.slice(0, GENERATED_BASE_LENGTH);

  if (base.length >= MIN_LENGTH) return base;

  const seed = String(fallbackSeed || "").slice(-6) || Date.now().toString().slice(-6);
  return `user${seed}`.slice(0, GENERATED_BASE_LENGTH);
}

async function resolveCollision(base) {
  if (await isAvailable(base)) return base;

  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${base}${suffix}`.slice(0, MAX_LENGTH);
    if (await isAvailable(candidate)) return candidate;
    suffix += 1;
  }
}

async function assignGeneratedUsername(user) {
  if (user.username) return user;

  const base = generateBaseUsername(user.email, user._id);
  let candidate = await resolveCollision(base);
  let attempts = 0;

  while (attempts < 10) {
    try {
      user.username = candidate;
      user.usernameChosenByUser = false;
      await user.save();
      return user;
    } catch (error) {
      if (error.code !== 11000 && error.code !== "E11000") throw error;
      attempts += 1;
      candidate = `${base}${Date.now().toString().slice(-4)}${attempts}`.slice(0, MAX_LENGTH);
    }
  }

  throw new Error("Could not assign a username after multiple attempts");
}

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  normalize,
  validateFormat,
  isAvailable,
  generateBaseUsername,
  resolveCollision,
  assignGeneratedUsername,
};
