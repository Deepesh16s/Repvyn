const request = require("supertest");
const app = require("../../app");
const HealthConnection = require("../../models/HealthConnection");
const HealthSample = require("../../models/HealthSample");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

function heartRateRecord(i, samplesPerRecord) {
  const start = new Date(Date.UTC(2026, 0, 1, 0, i));
  return {
    recordType: "HeartRate",
    healthConnectRecordId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 60000).toISOString(),
    value: Array.from({ length: samplesPerRecord }, (_, s) => ({
      time: new Date(start.getTime() + s * 1000).toISOString(),
      beatsPerMinute: 70 + (s % 30),
    })),
    unit: "bpm",
    sourceOrigin: "com.google.android.apps.fitness",
    device: { manufacturer: "Google", model: "Pixel Watch" },
  };
}

async function connectedUser() {
  const user = await createUser();
  await HealthConnection.create({ user: user._id, connected: true, grantedRecordTypes: ["HeartRate"] });
  return user;
}

describe("POST /api/health/sync", () => {
  it("accepts a full 200-record heart-rate chunk well over the default 100kb body limit", async () => {
    const user = await connectedUser();
    const records = Array.from({ length: 200 }, (_, i) => heartRateRecord(i, 30));
    expect(Buffer.byteLength(JSON.stringify({ records })) > 100 * 1024).toBe(true);

    const res = await authed(user)("post", "/api/health/sync").send({ records, deletedRecordIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(200);
    expect(await HealthSample.countDocuments({ user: user._id })).toBe(200);
  });

  it("rejects a batch with more records than the server-side cap", async () => {
    const user = await connectedUser();
    const records = Array.from({ length: 501 }, (_, i) => heartRateRecord(i, 1));

    const res = await authed(user)("post", "/api/health/sync").send({ records, deletedRecordIds: [] });
    expect(res.status).toBe(413);
    expect(await HealthSample.countDocuments({ user: user._id })).toBe(0);
  });

  it("answers an unauthenticated request with 401 without ever parsing its body", async () => {
    const unparseable = "{" + "x".repeat(300 * 1024);
    const res = await request(app)
      .post("/api/health/sync")
      .set("Content-Type", "application/json")
      .send(unparseable);
    expect(res.status).toBe(401);
  });

  it("answers a signed-in request with a malformed body with 400", async () => {
    const user = await connectedUser();
    const res = await authed(user)("post", "/api/health/sync")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(res.status).toBe(400);
  });

  it("refuses a body over 2mb from a signed-in user", async () => {
    const user = await connectedUser();
    const huge = { records: [{ note: "x".repeat(3 * 1024 * 1024) }], deletedRecordIds: [] };
    const res = await authed(user)("post", "/api/health/sync").send(huge);
    expect(res.status).toBe(413);
  });

  it("still rejects query-operator keys hidden inside a sync batch", async () => {
    const user = await connectedUser();
    const record = heartRateRecord(1, 1);
    record.healthConnectRecordId = { $ne: null };
    const res = await authed(user)("post", "/api/health/sync").send({ records: [record], deletedRecordIds: [] });
    expect(res.status).toBe(400);
    expect(await HealthSample.countDocuments({ user: user._id })).toBe(0);
  });

  it("keeps the default body limit on other routes", async () => {
    const user = await createUser();
    const res = await authed(user)("put", "/api/auth/profile").send({ name: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });
});
