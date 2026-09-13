process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_dummy_key_not_for_production";
// forgotPasswordLimiter caps real traffic at 5/15min per IP; this file legitimately
// exercises the /forgot-password route more than that across its test cases.
process.env.AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX = "1000";

const request = require("supertest");
const crypto = require("crypto");
const { Resend } = require("resend");
const app = require("../../app");
const User = require("../../models/User");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser } = require("../helpers/factories");

const emailsProto = Object.getPrototypeOf(new Resend("re_dummy_for_prototype_lookup").emails);
let sendSpy;
let lastSentEmail;

beforeAll(async () => {
  await connectTestDB();
  sendSpy = vi.spyOn(emailsProto, "send");
});
beforeEach(() => {
  lastSentEmail = null;
  sendSpy.mockReset();
  sendSpy.mockImplementation(async (args) => {
    lastSentEmail = args;
    return { data: { id: "mock-email-id" }, error: null };
  });
});
afterEach(async () => {
  await clearTestDB();
});
afterAll(async () => {
  sendSpy.mockRestore();
  await disconnectTestDB();
});

describe("POST /api/auth/forgot-password", () => {
  it("sends a reset email for an existing account and returns the generic message", async () => {
    const user = await createUser({ email: "resetme@test.local" });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "resetme@test.local" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account with that email exists/i);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    expect(lastSentEmail.to).toBe("resetme@test.local");
    expect(lastSentEmail.html).toContain("/reset-password/");

    const stored = await User.findById(user._id);
    expect(stored.resetPasswordToken).toBeTruthy();
    expect(stored.resetPasswordExpires).toBeInstanceOf(Date);
  });

  it("returns the same generic message for a nonexistent email, without sending mail", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@test.local" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account with that email exists/i);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("still returns the generic 200 message when the email provider fails, not a 500", async () => {
    sendSpy.mockRejectedValueOnce(new Error("Resend sandbox restriction: domain not verified"));
    await createUser({ email: "emailfails@test.local" });
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "emailfails@test.local" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account with that email exists/i);
  });
});

describe("POST /api/auth/reset-password/:token", () => {
  async function requestReset(email) {
    await request(app).post("/api/auth/forgot-password").send({ email });
    const match = lastSentEmail.html.match(/\/reset-password\/([a-f0-9]+)/);
    return match[1];
  }

  it("resets the password with a valid token and allows login with the new password", async () => {
    await createUser({ email: "validreset@test.local" });
    const rawToken = await requestReset("validreset@test.local");

    const res = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: "NewPassword123!" });
    expect(res.status).toBe(200);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "validreset@test.local", password: "NewPassword123!" });
    expect(loginRes.status).toBe(200);
  });

  it("rejects an invalid/unknown token with 400", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password/not-a-real-token")
      .send({ newPassword: "NewPassword123!" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token with 400", async () => {
    const user = await createUser({ email: "expiredreset@test.local" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() - 60 * 1000;
    await user.save();

    const res = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: "NewPassword123!" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it("rejects a password shorter than 6 characters", async () => {
    await createUser({ email: "shortpwreset@test.local" });
    const rawToken = await requestReset("shortpwreset@test.local");
    const res = await request(app).post(`/api/auth/reset-password/${rawToken}`).send({ newPassword: "abc" });
    expect(res.status).toBe(400);
  });

  it("cannot be reused after a successful reset", async () => {
    await createUser({ email: "reusetoken@test.local" });
    const rawToken = await requestReset("reusetoken@test.local");

    const first = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: "FirstPassword123!" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ newPassword: "SecondPassword123!" });
    expect(second.status).toBe(400);
  });
});
