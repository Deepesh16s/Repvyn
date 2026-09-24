process.env.AUTH_RATE_LIMIT_MAX = "3";
process.env.LOGIN_RATE_LIMIT_MAX = "1000";
process.env.LOGIN_ACCOUNT_RATE_LIMIT_MAX = "3";
process.env.GOOGLE_LOGIN_RATE_LIMIT_MAX = "2";
process.env.AUTH_RESET_PASSWORD_RATE_LIMIT_MAX = "2";
process.env.API_ANON_RATE_LIMIT_MAX = "10000";
process.env.API_USER_RATE_LIMIT_MAX = "10000";

const request = require("supertest");
const { OAuth2Client } = require("google-auth-library");
const app = require("../../app");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("register limiter", () => {
  it("allows the configured number of sign-ups per address, then answers 429, without affecting login", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/api/auth/register").send({
        name: `Person ${i}`,
        email: `person${i}@test.local`,
        password: "Test1234!",
        username: `person_${i}`,
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);

    const stillWorks = await login("person0@test.local", "Test1234!");
    expect(stillWorks.status).toBe(200);
  });
});

describe("login limiters", () => {
  it("does not count successful logins against the failure budget", async () => {
    await createUser({ email: "steady@test.local" });
    for (let i = 0; i < 9; i++) {
      const res = await login("steady@test.local", "Test1234!");
      expect(res.status, `login ${i + 1}`).toBe(200);
    }
  });

  it("stops repeated wrong-password guesses against one account, but not other accounts", async () => {
    await createUser({ email: "target@test.local" });
    await createUser({ email: "bystander@test.local" });

    const guesses = [];
    for (let i = 0; i < 4; i++) guesses.push((await login("target@test.local", `guess-${i}`)).status);
    expect(guesses).toEqual([400, 400, 400, 429]);

    expect((await login("bystander@test.local", "wrong-once")).status).toBe(400);
    expect((await login("bystander@test.local", "wrong-twice")).status).toBe(400);
  });

  it("treats email case variants as the same account for the per-account budget", async () => {
    await createUser({ email: "casey@test.local" });
    const variants = ["casey@test.local", "CASEY@test.local", "Casey@Test.Local", "casey@test.local"];
    const statuses = [];
    for (const email of variants) statuses.push((await login(email, "wrong")).status);
    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});

describe("login limiter keys", () => {
  it("bounds the per-account key, so oversized emails that share a prefix are throttled together", async () => {
    const prefix = "a".repeat(254);
    const statuses = [];
    for (const suffix of ["1", "2", "3", "4"]) statuses.push((await login(prefix + suffix + "@test.local", "wrong")).status);
    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});

describe("Google sign-in limiter", () => {
  it("counts failed attempts but not successful ones", async () => {
    const spy = vi.spyOn(OAuth2Client.prototype, "verifyIdToken");
    spy.mockResolvedValue({
      getPayload: () => ({
        sub: "rate-limit-sub",
        email: "rate.limit@test.local",
        email_verified: true,
        name: "Rate Limit",
        picture: "https://example.com/p.jpg",
      }),
    });
    for (let i = 0; i < 4; i++) {
      const ok = await request(app).post("/api/auth/google").send({ token: "valid" });
      expect(ok.status, `success ${i + 1}`).toBe(200);
    }

    spy.mockRejectedValue(new Error("Invalid token signature"));
    const failures = [];
    for (let i = 0; i < 3; i++) failures.push((await request(app).post("/api/auth/google").send({ token: "bad" })).status);
    expect(failures).toEqual([401, 401, 429]);
    spy.mockRestore();
  });
});

describe("reset-password limiter", () => {
  it("limits guesses at reset links per address", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/auth/reset-password/not-a-real-token-${i}`).send({ newPassword: "NewPassw0rd!" });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([400, 400, 429]);
  });
});
