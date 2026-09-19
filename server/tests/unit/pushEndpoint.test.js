const { isAllowedPushEndpoint, isValidPushKey } = require("../../utils/pushEndpoint");

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc123",
    "https://web.push.apple.com/QAbc123",
    "https://wns2-par02p.notify.windows.com/w/?token=abc123",
  ])("accepts a real push service endpoint: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["private network address", "https://10.0.0.5:8443/internal"],
    ["arbitrary attacker host", "https://attacker.example/collect"],
    ["allowlisted name used as a subdomain of another host", "https://fcm.googleapis.com.attacker.example/x"],
    ["lookalike suffix without the dot boundary", "https://evilnotify.windows.com/x"],
    ["plain http", "http://fcm.googleapis.com/fcm/send/abc"],
    ["embedded credentials", "https://user:pass@fcm.googleapis.com/fcm/send/abc"],
    ["non-default port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["not a URL", "not a url"],
    ["empty string", ""],
    ["overlong URL", `https://fcm.googleapis.com/${"a".repeat(3000)}`],
  ])("rejects %s", (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it.each([
    ["an operator object", { $ne: null }],
    ["an array", ["https://fcm.googleapis.com/x"]],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("isValidPushKey", () => {
  it("accepts base64url keys with optional padding", () => {
    expect(isValidPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM")).toBe(true);
    expect(isValidPushKey("tBHItJI5svbpez7KI4CCXg==")).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["an operator object", { $ne: null }],
    ["a string with spaces", "abc def"],
    ["a string with markup", "<script>"],
    ["an overlong key", "a".repeat(200)],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isValidPushKey(value)).toBe(false);
  });
});
