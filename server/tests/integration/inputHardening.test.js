process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX = "1000";

const request = require("supertest");
const app = require("../../app");
const User = require("../../models/User");
const PushSubscription = require("../../models/PushSubscription");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

const validRegistration = (overrides = {}) => ({
  name: "Test Person",
  email: "person@test.local",
  password: "Test1234!",
  username: "test_person",
  ...overrides,
});

describe("operator-injection guard", () => {
  it("rejects a login whose email is a query operator instead of a string", async () => {
    await createUser({ email: "victim@test.local" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: { $gt: "" }, password: "Test1234!" });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects a forgot-password request whose email is a query operator, and touches no account", async () => {
    const victim = await createUser({ email: "victim@test.local" });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: { $ne: null } });
    expect(res.status).toBe(400);
    const stored = await User.findById(victim._id).select("resetPasswordToken");
    expect(stored.resetPasswordToken).toBeFalsy();
  });

  it("rejects an operator key hidden deep inside an otherwise ordinary body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@test.local", password: "x", extra: [{ nested: { $where: "1" } }] });
    expect(res.status).toBe(400);
  });

  it("still accepts normal nested payloads on authenticated routes", async () => {
    const user = await createUser();
    const res = await authed(user)("put", "/api/push/preferences").send({
      pushEnabled: true,
      quietHours: { enabled: true, start: "22:00", end: "07:00", mode: "criticalOnly" },
    });
    expect(res.status).toBe(200);
  });
});

describe("auth input types", () => {
  it("returns 400, not 500, for a non-string registration field", async () => {
    const res = await request(app).post("/api/auth/register").send(validRegistration({ name: { a: 1 } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a login with a non-string password", async () => {
    await createUser({ email: "types@test.local" });
    const res = await request(app).post("/api/auth/login").send({ email: "types@test.local", password: 12345 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a login with a missing password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "types@test.local" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a forgot-password request with a non-string email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: ["a@test.local"] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a reset-password request with a non-string password", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password/sometoken")
      .send({ newPassword: { value: "abcdefgh" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a change-password request with non-string passwords", async () => {
    const user = await createUser();
    const res = await authed(user)("put", "/api/auth/change-password").send({
      oldPassword: { a: 1 },
      newPassword: ["abcdefgh"],
    });
    expect(res.status).toBe(400);
  });
});

describe("email normalization", () => {
  it("stores emails lowercased and trimmed", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ email: "  Mixed.Case@Test.LOCAL " }));
    expect(res.status).toBe(201);
    const stored = await User.findOne({ username: "test_person" });
    expect(stored.email).toBe("mixed.case@test.local");
  });

  it("refuses a second account that differs from an existing email only by case", async () => {
    const first = await request(app).post("/api/auth/register").send(validRegistration({ email: "Case@Test.com" }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ email: "case@test.com", username: "second_person" }));
    expect(second.status).toBe(400);

    const third = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ email: "CASE@TEST.COM", username: "third_person" }));
    expect(third.status).toBe(400);

    expect(await User.countDocuments({})).toBe(1);
  });

  it("lets a user log in regardless of the case they type", async () => {
    await request(app).post("/api/auth/register").send(validRegistration({ email: "Login.Case@Test.com" }));
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "LOGIN.CASE@test.com", password: "Test1234!" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });

  it("keeps an existing mixed-case account working when its owner types the exact stored email", async () => {
    await createUser({ email: "Legacy.User@Test.com" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "Legacy.User@Test.com", password: "Test1234!" });
    expect(res.status).toBe(200);
  });

  it("finds the account for forgot-password regardless of the case typed", async () => {
    const user = await createUser({ email: "reset.case@test.local" });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "RESET.Case@Test.LOCAL" });
    expect(res.status).toBe(200);
    const stored = await User.findById(user._id).select("resetPasswordToken");
    expect(stored.resetPasswordToken).toBeTruthy();
  });
});

describe("name length limit", () => {
  it("rejects a name over 60 characters at registration", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ name: "N".repeat(61) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/60/);
    expect(await User.countDocuments({})).toBe(0);
  });

  it("accepts a name of exactly 60 characters and stores it trimmed", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ name: `  ${"N".repeat(60)}  ` }));
    expect(res.status).toBe(201);
    const stored = await User.findOne({ username: "test_person" });
    expect(stored.name).toHaveLength(60);
  });

  it("rejects an oversized name when updating a profile, and accepts one at the limit", async () => {
    const user = await createUser();
    const tooLong = await authed(user)("put", "/api/auth/profile").send({ name: "N".repeat(61) });
    expect(tooLong.status).toBe(400);
    const atLimit = await authed(user)("put", "/api/auth/profile").send({ name: "N".repeat(60) });
    expect(atLimit.status).toBe(200);
  });

  it("rejects a huge name outright instead of storing it", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(validRegistration({ name: "A".repeat(90000) }));
    expect(res.status).toBe(400);
  });
});

describe("push subscription validation", () => {
  const keys = { p256dh: "p256dh-key", auth: "auth-key" };

  it("accepts a subscription from a real push service", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys,
    });
    expect(res.status).toBe(201);
  });

  it.each([
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["a private network address", "https://10.0.0.5:8443/internal"],
    ["an arbitrary host", "https://attacker.example/collect"],
    ["plain http", "http://fcm.googleapis.com/fcm/send/abc"],
  ])("refuses %s and stores nothing", async (_label, endpoint) => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({ endpoint, keys });
    expect(res.status).toBe(400);
    expect(await PushSubscription.countDocuments({})).toBe(0);
  });

  it("returns 400, not 500, when the endpoint is a query operator", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({
      endpoint: { $ne: null },
      keys,
    });
    expect(res.status).toBe(400);
  });

  it("refuses keys that are not base64url text", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "<script>", auth: "auth-key" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when removing a subscription with a non-string endpoint", async () => {
    const user = await createUser();
    const res = await authed(user)("delete", "/api/push/subscriptions").send({ endpoint: { a: 1 } });
    expect(res.status).toBe(400);
  });
});

describe("name-search index", () => {
  it("has a partial index on name limited to public, name-discoverable accounts", async () => {
    await User.init();
    const indexes = await User.collection.indexes();
    const nameIndex = indexes.find((i) => i.name === "name_1");
    expect(nameIndex).toBeDefined();
    expect(nameIndex.partialFilterExpression).toEqual({ profileVisibility: "public", discoverableByName: true });
  });

  it("is eligible for the exact query the search runs", async () => {
    await User.init();
    const plan = await User.find({
      profileVisibility: "public",
      discoverableByName: true,
      name: { $regex: "zeb", $options: "i" },
    })
      .hint("name_1")
      .explain("queryPlanner");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("IXSCAN");
  });
});
