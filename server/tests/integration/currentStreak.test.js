const request = require("supertest");
const app = require("../../app");
const Workout = require("../../models/workout");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor, seedExercisesFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(async () => {
  vi.useRealTimers();
  await clearTestDB();
});
afterAll(disconnectTestDB);

async function logWorkoutsOn(user, isoTimestamps) {
  const [exercise] = await seedExercisesFor(user, { count: 1 });
  for (const [index, date] of isoTimestamps.entries()) {
    await Workout.create({
      user: user._id,
      exercise: exercise._id,
      workoutSets: [{ weight: 40, reps: 8 }],
      sessionId: `streak-${index}`,
      date: new Date(date),
    });
  }
}

const streakOf = (user, query = "") =>
  request(app).get(`/api/dashboard/current-streak${query}`).set("Authorization", `Bearer ${tokenFor(user)}`);

describe("GET /api/dashboard/current-streak", () => {
  it("counts rest days inside the run, so a Monday and Tuesday workout still reads 3 on Wednesday morning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T06:00:00Z"));
    const user = await createUser();
    await logWorkoutsOn(user, ["2026-09-21T10:00:00Z", "2026-09-22T10:00:00Z"]);

    const res = await streakOf(user);
    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(3);
  });

  it("ends the streak once a day is confirmed missed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const user = await createUser();
    await logWorkoutsOn(user, ["2026-09-21T10:00:00Z"]);

    const res = await streakOf(user);
    expect(res.body.currentStreak).toBe(0);
  });

  it("uses the time zone offset from the client to decide which day a workout falls on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T04:00:00Z"));
    const user = await createUser();
    await logWorkoutsOn(user, ["2026-09-22T20:00:00Z"]);

    expect((await streakOf(user, "?tzOffset=-330")).body.currentStreak).toBe(1);
    expect((await streakOf(user)).body.currentStreak).toBe(2);
    expect((await streakOf(user, "?tzOffset=not-a-number")).body.currentStreak).toBe(2);
  });

  it("returns 0 for an account with no workouts", async () => {
    const user = await createUser();
    const res = await streakOf(user);
    expect(res.body.currentStreak).toBe(0);
  });
});

describe("public profile streak", () => {
  it("shows the same rest-aware streak on a public profile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T06:00:00Z"));
    const owner = await createUser({ profileVisibility: "public" });
    await logWorkoutsOn(owner, ["2026-09-21T10:00:00Z", "2026-09-22T10:00:00Z"]);
    const viewer = await createUser();

    const res = await request(app)
      .get(`/api/users/${owner.username}`)
      .set("Authorization", `Bearer ${tokenFor(viewer)}`);
    expect(res.status).toBe(200);
    expect(res.body.fitnessStats.currentStreak).toBe(3);
  });
});
