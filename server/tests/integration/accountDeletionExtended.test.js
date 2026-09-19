const request = require("supertest");
const cloudinaryUtils = require("../../utils/cloudinary");

const destroySpy = vi.spyOn(cloudinaryUtils, "destroyCloudinaryAsset").mockResolvedValue(undefined);

const app = require("../../app");
const User = require("../../models/User");
const Badge = require("../../models/Badge");
const Notification = require("../../models/Notification");
const PushSubscription = require("../../models/PushSubscription");
const PushPreferences = require("../../models/PushPreferences");
const Subscription = require("../../models/Subscription");
const PlannedWorkout = require("../../models/PlannedWorkout");
const FollowRequest = require("../../models/FollowRequest");
const Follow = require("../../models/Follow");
const Report = require("../../models/Report");
const Reaction = require("../../models/Reaction");
const PhysiquePost = require("../../models/PhysiquePost");
const PhysiqueComment = require("../../models/PhysiqueComment");
const PhysiqueLike = require("../../models/PhysiqueLike");
const Activity = require("../../models/Activity");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
beforeEach(() => destroySpy.mockClear());
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe("DELETE /api/auth/account (extended cascade: badges, notifications, push, subscription, planned workouts, follow requests, reports, reactions, comments, Cloudinary)", () => {
  it("cleans up every remaining owned/referencing collection and destroys Cloudinary assets", async () => {
    const userA = await createUser({ email: "ext-a@test.local", pictureAssetId: "profile-asset-a" });
    const userB = await createUser({ email: "ext-b@test.local", profileVisibility: "public" });
    const userC = await createUser({ email: "ext-c@test.local", profileVisibility: "private" });

    await Badge.create({ user: userA._id, badgeId: "first-workout" });
    await Notification.create({
      user: userA._id,
      type: "test",
      category: "social",
      icon: "Bell",
      title: "hi",
      dedupeKey: "dedupe-a-1",
    });
    await PushSubscription.create({
      user: userA._id,
      endpoint: "https://fcm.googleapis.com/fcm/send/ext-a",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    await PushPreferences.create({ user: userA._id, pushEnabled: true });
    await Subscription.create({ user: userA._id, tier: "premium", status: "active" });
    await PlannedWorkout.create({
      user: userA._id,
      title: "Leg day",
      workoutType: "strength",
      scheduledDate: new Date(),
    });

    await FollowRequest.create({ requester: userA._id, target: userC._id });
    await FollowRequest.create({ requester: userB._id, target: userA._id });
    await Follow.create({ follower: userB._id, following: userA._id });

    const ownPost = await PhysiquePost.create({
      user: userA._id,
      imageUrl: "https://example.test/owned.jpg",
      imageAssetId: "owned-physique-asset",
      visibility: "public",
    });
    const othersPost = await PhysiquePost.create({
      user: userB._id,
      imageUrl: "https://example.test/others.jpg",
      imageAssetId: "others-physique-asset",
      visibility: "public",
    });

    await PhysiqueComment.create({ post: othersPost._id, user: userA._id, text: "commenting on someone else's post" });
    const commentOnOwnPost = await PhysiqueComment.create({ post: ownPost._id, user: userB._id, text: "nice work" });
    await PhysiqueLike.create({ post: othersPost._id, user: userA._id });
    await Reaction.create({ targetType: "physiquePost", targetId: othersPost._id, user: userA._id, type: "fire" });
    await Reaction.create({ targetType: "physiquePost", targetId: ownPost._id, user: userB._id, type: "heart" });

    await Report.create({ reporter: userA._id, targetType: "physiquePost", targetId: othersPost._id, reason: "spam" });
    await Report.create({ reporter: userB._id, targetType: "physiquePost", targetId: ownPost._id, reason: "spam" });
    await Report.create({ reporter: userB._id, targetType: "comment", targetId: commentOnOwnPost._id, reason: "spam" });
    await Report.create({ reporter: userA._id, targetType: "user", targetId: userB._id, reason: "harassment" });
    await Report.create({ reporter: userC._id, targetType: "physiquePost", targetId: othersPost._id, reason: "impersonation" });

    await Activity.create({ user: userA._id, type: "physiquePost", title: "shared a physique update", refId: ownPost._id });

    const res = await request(app).delete("/api/auth/account").set("Authorization", `Bearer ${tokenFor(userA)}`);
    expect(res.status).toBe(200);

    expect(await User.findById(userA._id)).toBeNull();

    expect(await Badge.countDocuments({ user: userA._id })).toBe(0);
    expect(await Notification.countDocuments({ user: userA._id })).toBe(0);
    expect(await PushSubscription.countDocuments({ user: userA._id })).toBe(0);
    expect(await PushPreferences.countDocuments({ user: userA._id })).toBe(0);
    expect(await Subscription.countDocuments({ user: userA._id })).toBe(0);
    expect(await PlannedWorkout.countDocuments({ user: userA._id })).toBe(0);

    expect(
      await FollowRequest.countDocuments({ $or: [{ requester: userA._id }, { target: userA._id }] })
    ).toBe(0);
    expect(await Follow.countDocuments({ $or: [{ follower: userA._id }, { following: userA._id }] })).toBe(0);

    expect(await PhysiquePost.findById(ownPost._id)).toBeNull();
    expect(await PhysiquePost.findById(othersPost._id)).not.toBeNull();

    expect(await PhysiqueComment.countDocuments({ user: userA._id })).toBe(0);
    expect(await PhysiqueComment.countDocuments({ post: ownPost._id })).toBe(0);
    expect(await PhysiqueLike.countDocuments({ user: userA._id })).toBe(0);
    expect(await Reaction.countDocuments({ user: userA._id })).toBe(0);
    expect(await Reaction.countDocuments({ targetType: "physiquePost", targetId: ownPost._id })).toBe(0);

    expect(await Report.countDocuments({ reporter: userA._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "user", targetId: userA._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "physiquePost", targetId: ownPost._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "comment", targetId: commentOnOwnPost._id })).toBe(0);

    expect(await Activity.countDocuments({ user: userA._id })).toBe(0);

    expect(destroySpy).toHaveBeenCalledWith("owned-physique-asset");
    expect(destroySpy).toHaveBeenCalledWith("profile-asset-a");
    expect(destroySpy).not.toHaveBeenCalledWith("others-physique-asset");

    expect(await User.findById(userB._id)).not.toBeNull();
    expect(await PhysiqueComment.countDocuments({ post: othersPost._id, user: userA._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "physiquePost", targetId: othersPost._id, reporter: userA._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "physiquePost", targetId: othersPost._id, reporter: userC._id })).toBe(1);
  });

  it("does not destroy any Cloudinary asset when the deleted user had none", async () => {
    const user = await createUser({ email: "no-assets@test.local" });
    const res = await request(app).delete("/api/auth/account").set("Authorization", `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
    expect(destroySpy).not.toHaveBeenCalled();
  });
});
