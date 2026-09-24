process.env.API_ANON_RATE_LIMIT_MAX = "6";
process.env.API_USER_RATE_LIMIT_MAX = "8";
process.env.HEAVY_READ_RATE_LIMIT_MAX = "4";
process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX = "2";
process.env.ACCOUNT_DELETION_RATE_LIMIT_MAX = "2";
process.env.NOTIFICATION_GENERATE_RATE_LIMIT_MAX = "3";
process.env.HEALTH_SYNC_RATE_LIMIT_MAX = "3";

const request = require("supertest");
const app = require("../../app");
const User = require("../../models/User");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const as = (user) => (method, url) =>
  request(app)[method](url).set("Authorization", `Bearer ${tokenFor(user)}`);

async function statusesOf(times, makeRequest) {
  const statuses = [];
  for (let i = 0; i < times; i++) statuses.push((await makeRequest(i)).status);
  return statuses;
}

describe("global API budget", () => {
  it("limits anonymous callers per address, and a forged token does not escape that bucket", async () => {
    const statuses = await statusesOf(6, () => request(app).get("/api/users/nobody-here"));
    expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);

    const seventh = await request(app).get("/api/users/nobody-here");
    expect(seventh.status).toBe(429);
    expect(seventh.body.message).toMatch(/too many/i);

    const forged = await request(app).get("/api/users/nobody-here").set("Authorization", "Bearer not-a-real-token");
    expect(forged.status).toBe(429);
  });

  it("gives each signed-in user their own budget, unaffected by the exhausted anonymous bucket", async () => {
    const heavy = await createUser();
    const other = await createUser();

    const heavyStatuses = await statusesOf(9, () => as(heavy)("get", "/api/auth/me"));
    expect(heavyStatuses.slice(0, 8)).toEqual(Array(8).fill(200));
    expect(heavyStatuses[8]).toBe(429);

    const otherRes = await as(other)("get", "/api/auth/me");
    expect(otherRes.status).toBe(200);
  });
});

describe("expensive read endpoints", () => {
  it("limits dashboard aggregates per user, independently of other users", async () => {
    const a = await createUser();
    const b = await createUser();

    const aStatuses = await statusesOf(5, () => as(a)("get", "/api/dashboard/current-streak"));
    expect(aStatuses).toEqual([200, 200, 200, 200, 429]);

    expect((await as(b)("get", "/api/dashboard/current-streak")).status).toBe(200);
  });
});

describe("sensitive account actions", () => {
  it("limits password-change attempts per user, even with the right password", async () => {
    const user = await createUser();
    const statuses = await statusesOf(3, (i) =>
      as(user)("put", "/api/auth/change-password").send({
        oldPassword: i < 2 ? "wrong-password" : "Test1234!",
        newPassword: "NewPassw0rd!",
      })
    );
    expect(statuses).toEqual([400, 400, 429]);
  });

  it("limits account-deletion attempts per user and leaves the account intact", async () => {
    const user = await createUser();
    const statuses = await statusesOf(3, (i) =>
      as(user)("delete", "/api/auth/account").send({ password: i < 2 ? "wrong-password" : "Test1234!" })
    );
    expect(statuses).toEqual([400, 400, 429]);
    expect(await User.findById(user._id)).not.toBeNull();
  });
});

describe("high-volume write endpoints", () => {
  it("limits client-submitted notification generation per user", async () => {
    const user = await createUser();
    const statuses = await statusesOf(4, () => as(user)("post", "/api/notifications/generate").send({ candidates: [] }));
    expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  it("limits health sync batches per user", async () => {
    const user = await createUser();
    const statuses = await statusesOf(4, () => as(user)("post", "/api/health/sync").send({}));
    expect(statuses[3]).toBe(429);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
  });
});
