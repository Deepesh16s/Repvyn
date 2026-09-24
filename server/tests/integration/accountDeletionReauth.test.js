const request = require("supertest");
const { OAuth2Client } = require("google-auth-library");
const app = require("../../app");
const User = require("../../models/User");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

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

const nowSeconds = () => Math.floor(Date.now() / 1000);

function googlePayload(overrides = {}) {
  return {
    getPayload: () => ({
      sub: "google-sub-owner",
      email: "owner@test.local",
      email_verified: true,
      iat: nowSeconds(),
      ...overrides,
    }),
  };
}

function deleteAccount(user, body) {
  return request(app)
    .delete("/api/auth/account")
    .set("Authorization", `Bearer ${tokenFor(user)}`)
    .send(body);
}

describe("account deletion re-authentication (password account)", () => {
  it("refuses to delete without a password and keeps the account", async () => {
    const user = await createUser();
    const res = await deleteAccount(user, {});
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("refuses a wrong password and keeps the account", async () => {
    const user = await createUser();
    const res = await deleteAccount(user, { password: "wrong-password" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/incorrect/i);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("refuses a non-string or operator password", async () => {
    const user = await createUser();
    expect((await deleteAccount(user, { password: 12345 })).status).toBe(400);
    expect((await deleteAccount(user, { password: { $ne: null } })).status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("deletes the account when the password is correct", async () => {
    const user = await createUser();
    const res = await deleteAccount(user, { password: "Test1234!" });
    expect(res.status).toBe(200);
    expect(await User.findById(user._id)).toBeNull();
  });

  it("does not accept a Google credential in place of the password", async () => {
    const user = await createUser({ email: "owner@test.local", googleId: "google-sub-owner" });
    verifyIdTokenSpy.mockResolvedValue(googlePayload());
    const res = await deleteAccount(user, { googleToken: "valid-google-token" });
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });
});

describe("account deletion re-authentication (Google-only account)", () => {
  async function googleOnlyUser() {
    return createUser({ email: "owner@test.local", password: null, googleId: "google-sub-owner" });
  }

  it("asks for a Google confirmation when none is sent", async () => {
    const user = await googleOnlyUser();
    const res = await deleteAccount(user, {});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/google/i);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("deletes the account with a fresh Google credential for the same account", async () => {
    const user = await googleOnlyUser();
    verifyIdTokenSpy.mockResolvedValue(googlePayload());
    const res = await deleteAccount(user, { googleToken: "valid-google-token" });
    expect(res.status).toBe(200);
    expect(await User.findById(user._id)).toBeNull();
  });

  it("refuses an invalid or expired Google credential", async () => {
    const user = await googleOnlyUser();
    verifyIdTokenSpy.mockRejectedValue(new Error("Token used too late"));
    const res = await deleteAccount(user, { googleToken: "expired" });
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("refuses a credential that was issued more than five minutes ago", async () => {
    const user = await googleOnlyUser();
    verifyIdTokenSpy.mockResolvedValue(googlePayload({ iat: nowSeconds() - 600 }));
    const res = await deleteAccount(user, { googleToken: "old-but-valid" });
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("refuses a credential that belongs to a different Google account", async () => {
    const user = await googleOnlyUser();
    verifyIdTokenSpy.mockResolvedValue(googlePayload({ sub: "someone-else", email: "someone.else@test.local" }));
    const res = await deleteAccount(user, { googleToken: "other-account" });
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it("refuses a matching email that Google has not verified, when the account id differs", async () => {
    const user = await googleOnlyUser();
    verifyIdTokenSpy.mockResolvedValue(googlePayload({ sub: "someone-else", email_verified: false }));
    const res = await deleteAccount(user, { googleToken: "unverified-email" });
    expect(res.status).toBe(400);
    expect(await User.findById(user._id)).not.toBeNull();
  });
});
