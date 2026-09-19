process.env.AUTH_RATE_LIMIT_MAX = "1000";

const request = require("supertest");
const { OAuth2Client } = require("google-auth-library");
const app = require("../../app");
const User = require("../../models/User");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser } = require("../helpers/factories");

let verifyIdTokenSpy;

beforeAll(connectTestDB);
beforeEach(() => {
  verifyIdTokenSpy = vi.spyOn(OAuth2Client.prototype, "verifyIdToken");
});
afterEach(async () => {
  verifyIdTokenSpy.mockRestore();
  await clearTestDB();
});
afterAll(disconnectTestDB);

function mockTicket(overrides = {}) {
  return {
    getPayload: () => ({
      sub: "google-sub-123",
      email: "googleuser@test.local",
      email_verified: true,
      name: "Google User",
      picture: "https://example.com/pic.jpg",
      ...overrides,
    }),
  };
}

describe("POST /api/auth/google", () => {
  it("rejects a missing credential with 400", async () => {
    const res = await request(app).post("/api/auth/google").send({});
    expect(res.status).toBe(400);
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-string credential with 400", async () => {
    const res = await request(app).post("/api/auth/google").send({ token: 12345 });
    expect(res.status).toBe(400);
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed token with 401, not 500", async () => {
    verifyIdTokenSpy.mockRejectedValueOnce(new Error("Wrong number of segments in token: not-a-jwt"));
    const res = await request(app).post("/api/auth/google").send({ token: "not-a-jwt" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid-signature token with 401, not 500", async () => {
    verifyIdTokenSpy.mockRejectedValueOnce(new Error("Invalid token signature"));
    const res = await request(app).post("/api/auth/google").send({ token: "bad.signature.token" });
    expect(res.status).toBe(401);
  });

  it("rejects an expired token with 401, not 500", async () => {
    verifyIdTokenSpy.mockRejectedValueOnce(new Error("Token used too late"));
    const res = await request(app).post("/api/auth/google").send({ token: "expired-token" });
    expect(res.status).toBe(401);
  });

  it("rejects a ticket with no payload with 401", async () => {
    verifyIdTokenSpy.mockResolvedValueOnce({ getPayload: () => undefined });
    const res = await request(app).post("/api/auth/google").send({ token: "weird-token" });
    expect(res.status).toBe(401);
  });

  it("rejects an unverified email with 401", async () => {
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket({ email_verified: false }));
    const res = await request(app).post("/api/auth/google").send({ token: "unverified-email-token" });
    expect(res.status).toBe(401);
  });

  it("logs in an existing user with a valid token", async () => {
    await createUser({ email: "googleuser@test.local" });
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket());
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe("googleuser@test.local");
  });

  it("creates a new user on first Google sign-in with a valid token", async () => {
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket({ email: "newgoogleuser@test.local" }));
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(200);
    const stored = await User.findOne({ email: "newgoogleuser@test.local" });
    expect(stored).not.toBeNull();
    expect(stored.username).toBeTruthy();
  });

  it("stores a lowercased email and truncates an overlong Google display name instead of failing", async () => {
    verifyIdTokenSpy.mockResolvedValueOnce(
      mockTicket({ email: "Mixed.Case.Google@Test.local", name: "G".repeat(100) })
    );
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(200);
    const stored = await User.findOne({ email: "mixed.case.google@test.local" });
    expect(stored).not.toBeNull();
    expect(stored.name).toHaveLength(60);
  });

  it("keeps the fallback display name within the limit when Google sends no name and the email is long", async () => {
    const email = `${"x".repeat(64)}@test.local`;
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket({ email, name: undefined }));
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(200);
    const stored = await User.findOne({ email });
    expect(stored.name).toHaveLength(60);
  });

  it("signs a returning user in to the same account when Google reports a different email case", async () => {
    await createUser({ email: "returning.google@test.local" });
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket({ email: "Returning.Google@Test.local" }));
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(200);
    expect(await User.countDocuments({})).toBe(1);
  });

  it("returns 500 on a genuine unexpected server failure after successful verification", async () => {
    verifyIdTokenSpy.mockResolvedValueOnce(mockTicket({ email: "servererror@test.local" }));
    const findOneSpy = vi.spyOn(User, "findOne").mockRejectedValueOnce(new Error("simulated DB failure"));
    const res = await request(app).post("/api/auth/google").send({ token: "valid-token" });
    expect(res.status).toBe(500);
    findOneSpy.mockRestore();
  });
});
