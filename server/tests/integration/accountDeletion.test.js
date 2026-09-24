const request = require("supertest");
const app = require("../../app");
const User = require("../../models/User");
const Workout = require("../../models/workout");
const Goal = require("../../models/Goal");
const Exercise = require("../../models/Exercise");
const Follow = require("../../models/Follow");
const Block = require("../../models/Block");
const PhysiquePost = require("../../models/PhysiquePost");
const PhysiqueLike = require("../../models/PhysiqueLike");
const Conversation = require("../../models/Conversation");
const Message = require("../../models/Message");
const HealthSample = require("../../models/HealthSample");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor, seedExercisesFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe("DELETE /api/auth/account", () => {
  it("cascades every owned collection and never touches another user's data", async () => {
    const userA = await createUser({ email: "delete-a@test.local" });
    const userB = await createUser({ email: "delete-b@test.local" });
    const [exA] = await seedExercisesFor(userA, { count: 1 });
    const [exB] = await seedExercisesFor(userB, { count: 1 });

    await Workout.create({ user: userA._id, exercise: exA._id, workoutSets: [{ weight: 10, reps: 10 }], sessionId: "a-1" });
    await Workout.create({ user: userB._id, exercise: exB._id, workoutSets: [{ weight: 20, reps: 5 }], sessionId: "b-1" });

    await Goal.create({ user: userA._id, title: "A goal", type: "Weekly Volume Goal", target: 100, unit: "kg" });
    await Goal.create({ user: userB._id, title: "B goal", type: "Weekly Volume Goal", target: 100, unit: "kg" });

    await Follow.create({ follower: userA._id, following: userB._id });
    await Block.create({ blocker: userB._id, blocked: userA._id });

    const postA = await PhysiquePost.create({ user: userA._id, imageUrl: "https://example.test/a.png", imageAssetId: "a-asset" });
    const postB = await PhysiquePost.create({ user: userB._id, imageUrl: "https://example.test/b.png", imageAssetId: "b-asset" });
    await PhysiqueLike.create({ post: postA._id, user: userB._id });
    await PhysiqueLike.create({ post: postB._id, user: userA._id });

    const [low, high] = Conversation.canonicalPair(userA._id, userB._id);
    const convo = await Conversation.create({ participants: [userA._id, userB._id], participantLow: low, participantHigh: high });
    await Message.create({ conversation: convo._id, sender: userA._id, body: "hi" });
    await Message.create({ conversation: convo._id, sender: userB._id, body: "hey" });

    await HealthSample.create({
      user: userA._id,
      recordType: "RestingHeartRate",
      healthConnectRecordId: "rec-a",
      startTime: new Date(),
      endTime: new Date(),
      value: 60,
    });

    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${tokenFor(userA)}`)
      .send({ password: "Test1234!" });
    expect(res.status).toBe(200);

    expect(await User.findById(userA._id)).toBeNull();
    expect(await Workout.countDocuments({ user: userA._id })).toBe(0);
    expect(await Goal.countDocuments({ user: userA._id })).toBe(0);
    expect(await Exercise.countDocuments({ createdBy: userA._id })).toBe(0);
    expect(await HealthSample.countDocuments({ user: userA._id })).toBe(0);
    expect(await PhysiquePost.findById(postA._id)).toBeNull();

    expect(await Follow.countDocuments({ $or: [{ follower: userA._id }, { following: userA._id }] })).toBe(0);
    expect(await Block.countDocuments({ $or: [{ blocker: userA._id }, { blocked: userA._id }] })).toBe(0);
    expect(await Conversation.findById(convo._id)).toBeNull();
    expect(await Message.countDocuments({ conversation: convo._id })).toBe(0);

    expect(await PhysiqueLike.exists({ post: postB._id, user: userA._id })).toBeNull();
    expect(await PhysiquePost.findById(postB._id)).not.toBeNull();

    expect(await User.findById(userB._id)).not.toBeNull();
    expect(await Workout.countDocuments({ user: userB._id })).toBe(1);
    expect(await Goal.countDocuments({ user: userB._id })).toBe(1);
    expect(await Exercise.countDocuments({ createdBy: userB._id })).toBe(1);
  });

  it("rejects deletion without auth", async () => {
    const res = await request(app).delete("/api/auth/account");
    expect(res.status).toBe(401);
  });
});
