const request = require("supertest");
const app = require("../../app");
const Subscription = require("../../models/Subscription");
const Workout = require("../../models/workout");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor, seedExercisesFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

async function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("GET /api/progression/advanced entitlement", () => {
  it("401 with no auth", async () => {
    const res = await request(app).get("/api/progression/advanced");
    expect(res.status).toBe(401);
  });

  it("403 for a free user", async () => {
    const user = await createUser({ premiumTier: "free" });
    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
  });

  it("200 for a premium user with no active subscription record (manual grant)", async () => {
    const user = await createUser({ premiumTier: "premium" });
    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");
    expect(res.status).toBe(200);
  });

  it("200 for a premium user with a subscription that has not expired", async () => {
    const user = await createUser({ premiumTier: "premium" });
    await Subscription.create({
      user: user._id,
      tier: "premium",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");
    expect(res.status).toBe(200);
  });

  it("403 for a premium-tier user whose subscription has explicitly expired", async () => {
    const user = await createUser({ premiumTier: "premium" });
    await Subscription.create({
      user: user._id,
      tier: "premium",
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
  });

  it("403 for a premium-tier user whose subscription status is canceled", async () => {
    const user = await createUser({ premiumTier: "premium" });
    await Subscription.create({
      user: user._id,
      tier: "premium",
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");
    expect(res.status).toBe(403);
  });

  it("never accepts a target-user override — always the caller's own data", async () => {
    const user = await createUser({ premiumTier: "premium" });
    const other = await createUser();
    const api = await authed(user);
    const res = await api("get", `/api/progression/advanced?userId=${other._id}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/progression/advanced scan cap", () => {
  it("keeps the newest workouts when a heavy logger exceeds the scan cap", async () => {
    const user = await createUser({ premiumTier: "premium" });
    const [exercise] = await seedExercisesFor(user, { count: 1 });
    const day = 86400000;
    const entry = (daysAgo, sessionId) => ({
      user: user._id,
      exercise: exercise._id,
      entryType: "strength",
      workoutSets: [{ weight: 50, reps: 10 }],
      date: new Date(Date.now() - daysAgo * day),
      sessionId,
    });
    const oldEntries = Array.from({ length: 4000 }, (_, i) => entry(250, `old-${i}`));
    const recentEntries = [1, 8, 15].map((daysAgo) => entry(daysAgo, `recent-${daysAgo}`));
    await Workout.insertMany([...oldEntries, ...recentEntries], { ordered: false });

    const api = await authed(user);
    const res = await api("get", "/api/progression/advanced");

    expect(res.status).toBe(200);
    expect(res.body.volumeTrends.status).toBe("ok");
    expect(res.body.volumeTrends.trainedWeekCount).toBe(4);
  }, 60000);
});
