const request = require("supertest");
const app = require("../../app");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

async function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("Goals API", () => {
  it("creates a generic goal and computes status", async () => {
    const user = await createUser();
    const api = await authed(user);
    const res = await api("post", "/api/goals").send({
      title: "Bench 100kg",
      type: "Weekly Volume Goal",
      target: 1000,
      unit: "kg",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("In Progress");
  });

  it("rejects a goal with a non-positive target", async () => {
    const user = await createUser();
    const api = await authed(user);
    const res = await api("post", "/api/goals").send({
      title: "Bad",
      type: "Weekly Volume Goal",
      target: 0,
      unit: "kg",
    });
    expect(res.status).toBe(400);
  });

  it("a user cannot see or modify another user's goals", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const ownerApi = await authed(owner);
    const intruderApi = await authed(intruder);

    const created = await ownerApi("post", "/api/goals").send({
      title: "Private goal",
      type: "Weekly Volume Goal",
      target: 500,
      unit: "kg",
    });

    const listRes = await intruderApi("get", "/api/goals");
    expect(listRes.body.find((g) => g._id === created.body._id)).toBeUndefined();

    const updateRes = await intruderApi("put", `/api/goals/${created.body._id}`).send({ current: 999 });
    expect(updateRes.status).toBe(404);

    const deleteRes = await intruderApi("delete", `/api/goals/${created.body._id}`);
    expect(deleteRes.status).toBe(404);
  });

  describe("Weight Goal direction (real bug fix, end to end)", () => {
    it("a weight-LOSS goal (target below current) is NOT completed at creation", async () => {
      const user = await createUser();
      const api = await authed(user);
      const res = await api("post", "/api/goals").send({
        title: "Cut to 80kg",
        type: "Weight Goal",
        target: 80,
        unit: "kg",
        current: 85,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("In Progress");
      expect(res.body.direction).toBe("loss");
      expect(res.body.startingValue).toBe(85);
    });

    it("a weight-GAIN goal (target above current) still works as before", async () => {
      const user = await createUser();
      const api = await authed(user);
      const res = await api("post", "/api/goals").send({
        title: "Bulk to 90kg",
        type: "Weight Goal",
        target: 90,
        unit: "kg",
        current: 70,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("In Progress");
      expect(res.body.direction).toBe("gain");
    });

    it("a loss goal transitions to Completed once current drops to/below target", async () => {
      const user = await createUser();
      const api = await authed(user);
      const created = await api("post", "/api/goals").send({
        title: "Cut to 80kg",
        type: "Weight Goal",
        target: 80,
        unit: "kg",
        current: 85,
      });

      const stillGoing = await api("put", `/api/goals/${created.body._id}`).send({ current: 82 });
      expect(stillGoing.body.status).toBe("In Progress");
      expect(stillGoing.body.direction).toBe("loss");

      const done = await api("put", `/api/goals/${created.body._id}`).send({ current: 79 });
      expect(done.body.status).toBe("Completed");
    });

    it("re-derives direction when the target is edited past the starting weight", async () => {
      const user = await createUser();
      const api = await authed(user);
      const created = await api("post", "/api/goals").send({
        title: "Cut to 80kg",
        type: "Weight Goal",
        target: 80,
        unit: "kg",
        current: 85,
      });
      expect(created.body.direction).toBe("loss");

      const flipped = await api("put", `/api/goals/${created.body._id}`).send({ target: 95 });
      expect(flipped.body.direction).toBe("gain");
      expect(flipped.body.startingValue).toBe(85);
    });

    it("rejects a negative current value on update", async () => {
      const user = await createUser();
      const api = await authed(user);
      const created = await api("post", "/api/goals").send({
        title: "Cut to 80kg",
        type: "Weight Goal",
        target: 80,
        unit: "kg",
        current: 85,
      });
      const updateRes = await api("put", `/api/goals/${created.body._id}`).send({ current: -1 });
      expect(updateRes.status).toBe(400);
    });
  });
});
