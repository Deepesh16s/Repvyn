const request = require("supertest");
const app = require("../../app");
const Workout = require("../../models/workout");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor, seedExercisesFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("GET /api/users/:username (public profile visibility)", () => {
  it("the owner always sees their own content and (per their own setting) heatmap", async () => {
    const owner = await createUser({ profileVisibility: "private", showTrainingActivity: false });
    const res = await authed(owner)("get", `/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(true);
    expect(res.body.fitnessStats).not.toBeNull();
    expect(res.body.heatmapVisible).toBe(true);
  });

  it("an anonymous viewer sees a public account's content", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const res = await request(app).get(`/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(true);
    expect(res.body.fitnessStats).not.toBeNull();
  });

  it("a public account always exposes the heatmap, regardless of showTrainingActivity (client only offers that toggle for private accounts)", async () => {
    const owner = await createUser({ profileVisibility: "public", showTrainingActivity: false });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(true);
    expect(res.body.heatmapVisible).toBe(true);
  });

  it("a private account with showTrainingActivity off hides the heatmap even from an approved follower", async () => {
    const owner = await createUser({ profileVisibility: "private", showTrainingActivity: false });
    const follower = await createUser();
    await authed(follower)("post", `/api/users/${owner.username}/follow`);
    await authed(owner)("post", `/api/users/${follower.username}/accept-follow-request`);

    const res = await authed(follower)("get", `/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(true);
    expect(res.body.heatmapVisible).toBe(false);
  });

  it("a private account hides content and fitnessStats from a non-follower", async () => {
    const owner = await createUser({ profileVisibility: "private" });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(false);
    expect(res.body.fitnessStats).toBeNull();
    expect(res.body.heatmapVisible).toBe(false);
  });

  it("a private account with showTrainingActivity on reveals the heatmap only to an approved follower", async () => {
    const owner = await createUser({ profileVisibility: "private", showTrainingActivity: true });
    const follower = await createUser();

    await authed(follower)("post", `/api/users/${owner.username}/follow`);
    const beforeAccept = await authed(follower)("get", `/api/users/${owner.username}`);
    expect(beforeAccept.body.heatmapVisible).toBe(false);

    await authed(owner)("post", `/api/users/${follower.username}/accept-follow-request`);
    const afterAccept = await authed(follower)("get", `/api/users/${owner.username}`);
    expect(afterAccept.status).toBe(200);
    expect(afterAccept.body.viewerCanSeeContent).toBe(true);
    expect(afterAccept.body.fitnessStats).not.toBeNull();
    expect(afterAccept.body.heatmapVisible).toBe(true);
  });

  it("a blocked viewer sees no content, no badges, and no heatmap even on a public account", async () => {
    const owner = await createUser({ profileVisibility: "public", showTrainingActivity: true });
    const blocked = await createUser();
    await authed(owner)("post", `/api/users/${blocked.username}/block`);

    const res = await authed(blocked)("get", `/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerCanSeeContent).toBe(false);
    expect(res.body.fitnessStats).toBeNull();
    expect(res.body.heatmapVisible).toBe(false);
    expect(res.body.badges).toEqual([]);
  });

  it("reports accurate follower/following counts", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const followerA = await createUser();
    const followerB = await createUser();
    await authed(followerA)("post", `/api/users/${owner.username}/follow`);
    await authed(followerB)("post", `/api/users/${owner.username}/follow`);

    const res = await request(app).get(`/api/users/${owner.username}`);
    expect(res.body.followerCount).toBe(2);
    expect(res.body.followingCount).toBe(0);
  });

  it("fitnessStats reflects the viewer's actual logged workouts", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const [exercise] = await seedExercisesFor(owner, { count: 1 });
    await Workout.create({
      user: owner._id,
      exercise: exercise._id,
      workoutSets: [{ weight: 60, reps: 8 }],
      sessionId: "profile-test-session",
    });

    const res = await request(app).get(`/api/users/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.fitnessStats.sessionCount).toBeGreaterThan(0);
  });

  it("returns 404 for a nonexistent username", async () => {
    const res = await request(app).get("/api/users/no-such-user-anywhere");
    expect(res.status).toBe(404);
  });
});
