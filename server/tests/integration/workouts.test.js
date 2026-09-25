const request = require("supertest");
const app = require("../../app");
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

describe("POST /api/workouts/session", () => {
  it("logs a strength session and persists it", async () => {
    const user = await createUser();
    const [exercise] = await seedExercisesFor(user, { count: 1 });
    const api = await authed(user);

    const res = await api("post", "/api/workouts/session").send({
      sessionId: "session-1",
      sessionDuration: 30,
      sessionType: "Push",
      exercises: [{ exercise: exercise._id, workoutSets: [{ weight: 40, reps: 8 }] }],
    });

    expect(res.status).toBe(201);
    const stored = await Workout.find({ user: user._id });
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe("session-1");
  });

  it("rejects an empty exercises array", async () => {
    const user = await createUser();
    const api = await authed(user);
    const res = await api("post", "/api/workouts/session").send({
      sessionId: "session-2",
      sessionDuration: 30,
      sessionType: "Push",
      exercises: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an exercise the user does not own", async () => {
    const owner = await createUser();
    const [ownerExercise] = await seedExercisesFor(owner, { count: 1 });
    const other = await createUser();
    const api = await authed(other);

    const res = await api("post", "/api/workouts/session").send({
      sessionId: "session-3",
      sessionDuration: 30,
      sessionType: "Push",
      exercises: [{ exercise: ownerExercise._id, workoutSets: [{ weight: 40, reps: 8 }] }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing sessionDuration", async () => {
    const user = await createUser();
    const [exercise] = await seedExercisesFor(user, { count: 1 });
    const api = await authed(user);
    const res = await api("post", "/api/workouts/session").send({
      sessionId: "session-4",
      sessionType: "Push",
      exercises: [{ exercise: exercise._id, workoutSets: [{ weight: 40, reps: 8 }] }],
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/workouts", () => {
  it("only returns the authenticated user's workouts", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const [exA] = await seedExercisesFor(userA, { count: 1 });
    const [exB] = await seedExercisesFor(userB, { count: 1 });

    await Workout.create({
      user: userA._id,
      exercise: exA._id,
      workoutSets: [{ weight: 10, reps: 10 }],
      sessionId: "a-1",
    });
    await Workout.create({
      user: userB._id,
      exercise: exB._id,
      workoutSets: [{ weight: 20, reps: 5 }],
      sessionId: "b-1",
    });

    const api = await authed(userA);
    const res = await api("get", "/api/workouts");
    expect(res.status).toBe(200);
    expect(res.body.every((w) => w.user === String(userA._id))).toBe(true);
    expect(res.body.some((w) => w.sessionId === "b-1")).toBe(false);
  });
});

describe("PUT /api/workouts/:id keeps Strength PR goals in step with the edit", () => {
  const Goal = require("../../models/Goal");

  async function setup() {
    const user = await createUser();
    const [bench, squat] = await seedExercisesFor(user, { count: 2 });
    const api = await authed(user);
    const logged = await api("post", "/api/workouts/session").send({
      sessionId: "pr-session",
      sessionDuration: 45,
      sessionType: "Push",
      exercises: [{ exercise: bench._id, workoutSets: [{ weight: 100, reps: 5 }] }],
    });
    const workoutId = logged.body.workouts[0]._id;
    const benchGoal = await Goal.create({
      user: user._id,
      title: "Bench 100",
      type: "Strength PR",
      target: 100,
      unit: "kg",
      exercise: bench._id,
      current: 100,
      status: "Completed",
    });
    const squatGoal = await Goal.create({
      user: user._id,
      title: "Squat 150",
      type: "Strength PR",
      target: 150,
      unit: "kg",
      exercise: squat._id,
      current: 0,
      status: "In Progress",
    });
    return { api, workoutId, benchGoal, squatGoal, squat };
  }

  it("lowers the PR goal when the best set is edited down (typo fix)", async () => {
    const { api, workoutId, benchGoal } = await setup();

    const res = await api("put", `/api/workouts/${workoutId}`).send({ workoutSets: [{ weight: 60, reps: 5 }] });
    expect(res.status).toBe(200);

    const goal = await Goal.findById(benchGoal._id);
    expect(goal.current).toBe(60);
    expect(goal.status).toBe("In Progress");
  });

  it("moves the lift off the old exercise's PR goal when the exercise is changed", async () => {
    const { api, workoutId, benchGoal, squatGoal, squat } = await setup();

    const res = await api("put", `/api/workouts/${workoutId}`).send({ exercise: squat._id });
    expect(res.status).toBe(200);

    expect((await Goal.findById(benchGoal._id)).current).toBe(0);
    expect((await Goal.findById(squatGoal._id)).current).toBe(100);
  });
});

describe("GET /api/workouts paging bounds", () => {
  async function userWithWorkouts(count) {
    const user = await createUser();
    const [exercise] = await seedExercisesFor(user, { count: 1 });
    await Workout.insertMany(
      Array.from({ length: count }, (_, i) => ({
        user: user._id,
        exercise: exercise._id,
        workoutSets: [{ weight: 10, reps: 10 }],
        sessionId: `s-${i}`,
      }))
    );
    return authed(user);
  }

  it("treats limit=0 as the default page size, not Mongo's unlimited", async () => {
    const api = await userWithWorkouts(12);
    const res = await api("get", "/api/workouts?limit=0");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
  });

  it("falls back to sane values for non-numeric page/limit instead of erroring", async () => {
    const api = await userWithWorkouts(3);
    const res = await api("get", "/api/workouts?page=abc&limit=xyz");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("rejects an invalid date range with 400", async () => {
    const api = await userWithWorkouts(1);
    const res = await api("get", "/api/workouts?start=not-a-date&end=2026-01-01");
    expect(res.status).toBe(400);
  });
});

describe("another user's workout", () => {
  it("is reported as not found on edit and delete (not 401, which would sign the caller out)", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const [exercise] = await seedExercisesFor(owner, { count: 1 });
    const workout = await Workout.create({
      user: owner._id,
      exercise: exercise._id,
      workoutSets: [{ weight: 10, reps: 10 }],
      sessionId: "owner-1",
    });
    const api = await authed(intruder);

    expect((await api("put", `/api/workouts/${workout._id}`).send({ workoutSets: [{ weight: 1, reps: 1 }] })).status).toBe(404);
    expect((await api("delete", `/api/workouts/${workout._id}`)).status).toBe(404);
    expect(await Workout.countDocuments({ _id: workout._id })).toBe(1);
  });
});
