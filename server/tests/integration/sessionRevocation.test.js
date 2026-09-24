process.env.AUTH_RATE_LIMIT_MAX = "1000";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../../app");
const User = require("../../models/User");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function changePassword(token, oldPassword = "Test1234!", newPassword = "NewPassw0rd!") {
  return request(app).put("/api/auth/change-password").set(bearer(token)).send({ oldPassword, newPassword });
}

describe("session revocation with a token version", () => {
  it("keeps accepting a token issued before versioning existed", async () => {
    const user = await createUser();
    const res = await request(app).get("/api/auth/me").set(bearer(tokenFor(user)));
    expect(res.status).toBe(200);
  });

  it("puts the current version in tokens issued at login", async () => {
    await createUser({ email: "version@test.local", tokenVersion: 3 });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "version@test.local", password: "Test1234!" });
    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.token).tv).toBe(3);
    const me = await request(app).get("/api/auth/me").set(bearer(res.body.token));
    expect(me.status).toBe(200);
  });

  it("rejects a token whose version does not match the account", async () => {
    const user = await createUser({ tokenVersion: 1 });
    const stale = jwt.sign({ id: user._id, tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const ahead = jwt.sign({ id: user._id, tv: 9 }, process.env.JWT_SECRET, { expiresIn: "1h" });
    expect((await request(app).get("/api/auth/me").set(bearer(stale))).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(bearer(ahead))).status).toBe(401);
  });

  it("revokes every existing session when the password changes and hands back a working new token", async () => {
    const user = await createUser();
    const oldToken = tokenFor(user);

    const res = await changePassword(oldToken);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");

    expect((await request(app).get("/api/auth/me").set(bearer(oldToken))).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(bearer(res.body.token))).status).toBe(200);
  });

  it("does not revoke sessions when the password change fails", async () => {
    const user = await createUser();
    const token = tokenFor(user);
    const res = await changePassword(token, "not-the-password");
    expect(res.status).toBe(400);
    expect((await request(app).get("/api/auth/me").set(bearer(token))).status).toBe(200);
  });

  it("revokes every existing session when the password is reset", async () => {
    const user = await createUser();
    const oldToken = tokenFor(user);
    await User.updateOne(
      { _id: user._id },
      {
        resetPasswordToken: crypto.createHash("sha256").update("reset-for-revocation").digest("hex"),
        resetPasswordExpires: Date.now() + 60000,
      }
    );

    const reset = await request(app)
      .post("/api/auth/reset-password/reset-for-revocation")
      .send({ newPassword: "NewPassw0rd!" });
    expect(reset.status).toBe(200);

    expect((await request(app).get("/api/auth/me").set(bearer(oldToken))).status).toBe(401);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "NewPassw0rd!" });
    expect(login.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set(bearer(login.body.token))).status).toBe(200);
  });

  it("marks an unverified account as verified once its owner completes a password reset", async () => {
    const squatted = await createUser({ emailVerified: false });
    await User.updateOne(
      { _id: squatted._id },
      {
        resetPasswordToken: crypto.createHash("sha256").update("owner-reset-link").digest("hex"),
        resetPasswordExpires: Date.now() + 60000,
      }
    );

    const reset = await request(app)
      .post("/api/auth/reset-password/owner-reset-link")
      .send({ newPassword: "OwnersNewPassw0rd!" });
    expect(reset.status).toBe(200);

    const stored = await User.findById(squatted._id);
    expect(stored.emailVerified).toBe(true);
    expect(stored.tokenVersion).toBe(1);
  });

  it("cancels an outstanding reset link when the password is changed", async () => {
    const user = await createUser();
    await User.updateOne(
      { _id: user._id },
      {
        resetPasswordToken: crypto.createHash("sha256").update("pending-link").digest("hex"),
        resetPasswordExpires: Date.now() + 60000,
      }
    );

    expect((await changePassword(tokenFor(user))).status).toBe(200);

    const replay = await request(app)
      .post("/api/auth/reset-password/pending-link")
      .send({ newPassword: "AnotherPassw0rd!" });
    expect(replay.status).toBe(400);
  });

  it("treats a stale token as signed out on routes that allow anonymous access", async () => {
    await createUser({ profileVisibility: "public", name: "Zebra Quokka", discoverableByName: true });
    const viewer = await createUser();
    const staleToken = tokenFor(viewer);
    const changed = await changePassword(staleToken);

    const stale = await request(app).get("/api/users/search?q=Zebra").set(bearer(staleToken));
    expect(stale.status).toBe(200);
    expect(stale.body.users).toHaveLength(0);

    const fresh = await request(app).get("/api/users/search?q=Zebra").set(bearer(changed.body.token));
    expect(fresh.body.users).toHaveLength(1);
  });

  it("returns a clear 400 instead of a 500 when a Google-only account tries to change a password", async () => {
    const user = await createUser({ password: null, googleId: "google-sub-1" });
    const res = await changePassword(tokenFor(user));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/google/i);
  });
});

describe("what the API exposes about an account", () => {
  it("never serializes the password hash, reset token, or token version", async () => {
    const user = await createUser({ tokenVersion: 2 });
    await User.updateOne(
      { _id: user._id },
      { resetPasswordToken: "hashed-reset-token", resetPasswordExpires: Date.now() + 60000 }
    );
    const token = jwt.sign({ id: user._id, tv: 2 }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const me = await request(app).get("/api/auth/me").set(bearer(token));
    expect(me.status).toBe(200);
    for (const field of ["password", "resetPasswordToken", "resetPasswordExpires", "tokenVersion"]) {
      expect(me.body, field).not.toHaveProperty(field);
    }

    const updated = await request(app).put("/api/auth/profile").set(bearer(token)).send({ name: "New Name" });
    expect(updated.status).toBe(200);
    for (const field of ["password", "resetPasswordToken", "resetPasswordExpires", "tokenVersion"]) {
      expect(updated.body.user, field).not.toHaveProperty(field);
    }
  });

  it("tells the client whether the account has a password and whether the email is verified", async () => {
    const withPassword = await createUser();
    const googleOnly = await createUser({ password: null, googleId: "google-sub-2", emailVerified: true });
    const unverified = await createUser({ emailVerified: false });

    const a = await request(app).get("/api/auth/me").set(bearer(tokenFor(withPassword)));
    expect(a.body.hasPassword).toBe(true);
    expect(a.body.emailVerified).toBe(true);

    const b = await request(app).get("/api/auth/me").set(bearer(tokenFor(googleOnly)));
    expect(b.body.hasPassword).toBe(false);

    const c = await request(app).get("/api/auth/me").set(bearer(tokenFor(unverified)));
    expect(c.body.emailVerified).toBe(false);
  });

  it("registers new password accounts as unverified", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "New Person",
      email: "new.person@test.local",
      password: "Test1234!",
      username: "new_person",
    });
    expect(res.status).toBe(201);
    const stored = await User.findOne({ username: "new_person" });
    expect(stored.emailVerified).toBe(false);
  });
});
