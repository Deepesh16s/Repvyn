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
  const trimmed = String(rawEmail).trim();
  const normalized = trimmed.toLowerCase();
  const exact = await User.findOne({ email: trimmed });
  if (exact || trimmed === normalized) return exact;
  return User.findOne({ email: normalized });
}

module.exports = { isString, normalizeEmail, escapeRegExp, findUserByEmail };
