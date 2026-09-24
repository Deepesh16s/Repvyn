process.env.LOGIN_RATE_LIMIT_MAX = "5";
process.env.LOGIN_ACCOUNT_RATE_LIMIT_MAX = "1000";
process.env.API_ANON_RATE_LIMIT_MAX = "10000";

const request = require("supertest");
const app = require("../../app");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("per-address login failure budget", () => {
  it("stops password spraying across many accounts from one address", async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await login(`victim${i}@test.local`, "Password123")).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429, 429, 429]);
  });

  it("blocks even a correct password from that address until the window passes", async () => {
    await createUser({ email: "legit@test.local" });
    const res = await login("legit@test.local", "Test1234!");
    expect(res.status).toBe(429);
  });
});
