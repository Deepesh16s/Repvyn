const ALLOWED_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

const ALLOWED_HOST_SUFFIXES = [
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 128;
const BASE64URL_KEY = /^[A-Za-z0-9_-]+={0,2}$/;

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) return false;

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isValidPushKey(value) {
  return typeof value === "string" && value.length <= MAX_KEY_LENGTH && BASE64URL_KEY.test(value);
}

module.exports = { isAllowedPushEndpoint, isValidPushKey };
