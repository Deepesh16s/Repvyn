const User = require("../models/User");

function isString(value) {
  return typeof value === "string";
}

function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findUserByEmail(rawEmail) {
  const typed = String(rawEmail);
  const candidates = [...new Set([typed, typed.trim(), normalizeEmail(typed)])];
  const matches = await User.find({ email: { $in: candidates } }).limit(candidates.length);
  for (const email of candidates) {
    const match = matches.find((user) => user.email === email);
    if (match) return match;
  }
  return null;
}

module.exports = { isString, normalizeEmail, escapeRegExp, findUserByEmail };
