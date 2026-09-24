process.env.PHYSIQUE_POST_RATE_LIMIT_MAX = process.env.PHYSIQUE_POST_RATE_LIMIT_MAX || "1000";

const request = require("supertest");
const cloudinaryUtils = require("../../utils/cloudinary");

const uploadSpy = vi.spyOn(cloudinaryUtils, "uploadBufferToCloudinary");
const destroySpy = vi.spyOn(cloudinaryUtils, "destroyCloudinaryAsset").mockResolvedValue(undefined);

const app = require("../../app");
const PhysiquePost = require("../../models/PhysiquePost");
const PhysiqueLike = require("../../models/PhysiqueLike");
const PhysiqueComment = require("../../models/PhysiqueComment");
const Reaction = require("../../models/Reaction");
const Report = require("../../models/Report");
const Activity = require("../../models/Activity");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01]);

beforeAll(connectTestDB);
beforeEach(() => {
  uploadSpy.mockReset();
  uploadSpy.mockResolvedValue({ secure_url: "https://example.test/mock.jpg", public_id: "mock-public-id" });
  destroySpy.mockClear();
});
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

async function follow(followerApi, targetUsername) {
  return followerApi("post", `/api/users/${targetUsername}/follow`);
}

describe("POST /api/physique (upload validation)", () => {
  it("rejects a request with no image", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/physique").field("caption", "no image");
    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/physique").attach("image", Buffer.from("not an image"), {
      filename: "malware.exe",
      contentType: "application/x-msdownload",
    });
    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects a file over the 8MB limit", async () => {
    const user = await createUser();
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    const res = await authed(user)("post", "/api/physique").attach("image", oversized, {
      filename: "big.jpg",
      contentType: "image/jpeg",
    });
    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid image and creates a post via the (mocked) Cloudinary pipeline", async () => {
    const user = await createUser({ profileVisibility: "public" });
    const res = await authed(user)("post", "/api/physique")
      .field("caption", "leg day")
      .field("visibility", "public")
      .attach("image", JPEG_MAGIC_BYTES, { filename: "legday.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.post.imageUrl).toBe("https://example.test/mock.jpg");
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    const stored = await PhysiquePost.findById(res.body.post._id);
    expect(stored.imageAssetId).toBe("mock-public-id");
  });

  it("propagates a Cloudinary upload failure as a clean error, not a partial DB record", async () => {
    uploadSpy.mockRejectedValueOnce(new Error("simulated Cloudinary outage"));
    const user = await createUser();
    const res = await authed(user)("post", "/api/physique").attach("image", JPEG_MAGIC_BYTES, {
      filename: "test.jpg",
      contentType: "image/jpeg",
    });
    expect(res.status).toBe(500);
    const count = await PhysiquePost.countDocuments({ user: user._id });
    expect(count).toBe(0);
  });

  it("rejects a public post from a private account", async () => {
    const user = await createUser({ profileVisibility: "private" });
    const res = await authed(user)("post", "/api/physique")
      .field("visibility", "public")
      .attach("image", JPEG_MAGIC_BYTES, { filename: "test.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid visibility value", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/physique")
      .field("visibility", "everyone")
      .attach("image", JPEG_MAGIC_BYTES, { filename: "test.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid category value", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/physique")
      .field("category", "not-a-real-category")
      .attach("image", JPEG_MAGIC_BYTES, { filename: "test.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/physique/:id (authorization, cascade, Cloudinary cleanup)", () => {
  it("rejects deletion by a non-owner with 403", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/x.jpg",
      imageAssetId: "asset-x",
      visibility: "public",
    });

    const res = await authed(intruder)("delete", `/api/physique/${post._id}`);
    expect(res.status).toBe(403);
    expect(await PhysiquePost.findById(post._id)).not.toBeNull();
  });

  it("returns 404 for a nonexistent post", async () => {
    const user = await createUser();
    const fakeId = "507f1f77bcf86cd799439011";
    const res = await authed(user)("delete", `/api/physique/${fakeId}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed post id", async () => {
    const user = await createUser();
    const res = await authed(user)("delete", "/api/physique/not-an-object-id");
    expect(res.status).toBe(400);
  });

  it("deletes the Cloudinary asset and cascades likes/comments/reactions/reports/activity", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const other = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/x.jpg",
      imageAssetId: "asset-to-destroy",
      visibility: "public",
    });

    await PhysiqueLike.create({ post: post._id, user: other._id });
    const comment = await PhysiqueComment.create({ post: post._id, user: other._id, text: "nice work" });
    await Reaction.create({ targetType: "physiquePost", targetId: post._id, user: other._id, type: "fire" });
    await Report.create({ reporter: other._id, targetType: "physiquePost", targetId: post._id, reason: "spam" });
    await Activity.create({ user: owner._id, type: "physiquePost", title: "shared a physique update", refId: post._id });

    const res = await authed(owner)("delete", `/api/physique/${post._id}`);
    expect(res.status).toBe(200);

    expect(destroySpy).toHaveBeenCalledWith("asset-to-destroy");
    expect(await PhysiquePost.findById(post._id)).toBeNull();
    expect(await PhysiqueLike.countDocuments({ post: post._id })).toBe(0);
    expect(await PhysiqueComment.countDocuments({ post: post._id })).toBe(0);
    expect(await Reaction.countDocuments({ targetType: "physiquePost", targetId: post._id })).toBe(0);
    expect(await Report.countDocuments({ targetType: "physiquePost", targetId: post._id })).toBe(0);
    expect(await Activity.countDocuments({ type: "physiquePost", refId: post._id })).toBe(0);
  });
});

describe("Physique post privacy / visibility (IDOR checks)", () => {
  it("a public post is visible to an anonymous (unauthenticated) viewer", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/p.jpg",
      imageAssetId: "p-asset",
      visibility: "public",
    });
    const res = await request(app).get(`/api/physique/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
  });

  it("a followers-only post is hidden from a non-follower", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const viewer = await createUser();
    await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/f.jpg",
      imageAssetId: "f-asset",
      visibility: "followers",
    });
    const res = await authed(viewer)("get", `/api/physique/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(0);
  });

  it("a followers-only post is visible to an actual follower", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const follower = await createUser();
    await follow(authed(follower), owner.username);
    await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/f2.jpg",
      imageAssetId: "f2-asset",
      visibility: "followers",
    });
    const res = await authed(follower)("get", `/api/physique/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
  });

  it("the owner always sees their own posts regardless of visibility", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/o.jpg",
      imageAssetId: "o-asset",
      visibility: "followers",
    });
    const res = await authed(owner)("get", `/api/physique/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
  });

  it("a post stays hidden from non-followers if the account later turns private, even though the post itself is marked public", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const viewer = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/priv.jpg",
      imageAssetId: "priv-asset",
      visibility: "public",
    });

    await authed(owner)("put", "/api/auth/profile-visibility").send({ profileVisibility: "private" });

    const listRes = await authed(viewer)("get", `/api/physique/${owner.username}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.posts).toHaveLength(0);

    const likeRes = await authed(viewer)("post", `/api/physique/${post._id}/like`);
    expect(likeRes.status).toBe(403);
  });

  it("a blocked user cannot view, like, comment on, or react to the blocker's public post", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const blocked = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/b.jpg",
      imageAssetId: "b-asset",
      visibility: "public",
    });

    await authed(owner)("post", `/api/users/${blocked.username}/block`);

    const listRes = await authed(blocked)("get", `/api/physique/${owner.username}`);
    expect(listRes.status).toBe(403);

    const likeRes = await authed(blocked)("post", `/api/physique/${post._id}/like`);
    expect(likeRes.status).toBe(403);

    const commentRes = await authed(blocked)("post", `/api/physique/${post._id}/comments`).send({ text: "hi" });
    expect(commentRes.status).toBe(403);

    const reactRes = await authed(blocked)("post", `/api/physique/${post._id}/reactions`).send({ type: "fire" });
    expect(reactRes.status).toBe(403);
  });

  it("returns 403, not a data leak, when fetching another user's posts with a supplied username after a block", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const blocker = await createUser();
    await authed(blocker)("post", `/api/users/${owner.username}/block`);

    const res = await authed(owner)("get", `/api/physique/${blocker.username}`);
    expect(res.status).toBe(403);
  });
});

describe("Comment authorization", () => {
  it("lets the comment author delete their own comment", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const commenter = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/c.jpg",
      imageAssetId: "c-asset",
      visibility: "public",
    });
    const comment = await PhysiqueComment.create({ post: post._id, user: commenter._id, text: "own comment" });

    const res = await authed(commenter)("delete", `/api/physique/comments/${comment._id}`);
    expect(res.status).toBe(200);
    expect(await PhysiqueComment.findById(comment._id)).toBeNull();
  });

  it("lets the post owner delete a comment left by someone else on their post", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const commenter = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/c2.jpg",
      imageAssetId: "c2-asset",
      visibility: "public",
    });
    const comment = await PhysiqueComment.create({ post: post._id, user: commenter._id, text: "moderate me" });

    const res = await authed(owner)("delete", `/api/physique/comments/${comment._id}`);
    expect(res.status).toBe(200);
    expect(await PhysiqueComment.findById(comment._id)).toBeNull();
  });

  it("rejects deletion by a third party who is neither the author nor the post owner", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const commenter = await createUser();
    const outsider = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/c3.jpg",
      imageAssetId: "c3-asset",
      visibility: "public",
    });
    const comment = await PhysiqueComment.create({ post: post._id, user: commenter._id, text: "leave me" });

    const res = await authed(outsider)("delete", `/api/physique/comments/${comment._id}`);
    expect(res.status).toBe(403);
    expect(await PhysiqueComment.findById(comment._id)).not.toBeNull();
  });

  it("rejects an empty comment", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/c4.jpg",
      imageAssetId: "c4-asset",
      visibility: "public",
    });
    const res = await authed(owner)("post", `/api/physique/${post._id}/comments`).send({ text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("Likes", () => {
  it("is idempotent: liking twice does not double-count", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const liker = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/l.jpg",
      imageAssetId: "l-asset",
      visibility: "public",
    });

    await authed(liker)("post", `/api/physique/${post._id}/like`);
    const res = await authed(liker)("post", `/api/physique/${post._id}/like`);
    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(1);
  });

  it("unlike removes the like", async () => {
    const owner = await createUser({ profileVisibility: "public" });
    const liker = await createUser();
    const post = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/l2.jpg",
      imageAssetId: "l2-asset",
      visibility: "public",
    });

    await authed(liker)("post", `/api/physique/${post._id}/like`);
    const res = await authed(liker)("delete", `/api/physique/${post._id}/like`);
    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(0);
  });
});

describe("Public profile activity respects physique post visibility", () => {
  async function seed() {
    const owner = await createUser({ profileVisibility: "public" });
    const publicPost = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/pub.jpg",
      imageAssetId: "pub-asset",
      caption: "public caption",
      visibility: "public",
    });
    const privatePost = await PhysiquePost.create({
      user: owner._id,
      imageUrl: "https://example.test/fol.jpg",
      imageAssetId: "fol-asset",
      caption: "followers-only caption",
      visibility: "followers",
    });
    await Activity.create({ user: owner._id, type: "physiquePost", title: "shared a physique update", subtitle: "public caption", refId: publicPost._id });
    await Activity.create({ user: owner._id, type: "physiquePost", title: "shared a physique update", subtitle: "followers-only caption", refId: privatePost._id });
    await Activity.create({ user: owner._id, type: "workoutCompleted", title: "completed a workout" });
    return owner;
  }

  const subtitles = (res) => res.body.activity.map((a) => a.subtitle);

  it("hides a followers-only post's activity (and caption) from anonymous viewers and non-followers", async () => {
    const owner = await seed();
    const stranger = await createUser();

    for (const res of [
      await request(app).get(`/api/users/${owner.username}/activity`),
      await authed(stranger)("get", `/api/users/${owner.username}/activity`),
    ]) {
      expect(res.status).toBe(200);
      expect(res.body.activity).toHaveLength(2);
      expect(subtitles(res)).toContain("public caption");
      expect(subtitles(res)).not.toContain("followers-only caption");
    }
  });

  it("shows it to followers and to the owner", async () => {
    const owner = await seed();
    const follower = await createUser();
    await follow(authed(follower), owner.username);

    for (const res of [
      await authed(follower)("get", `/api/users/${owner.username}/activity`),
      await authed(owner)("get", `/api/users/${owner.username}/activity`),
    ]) {
      expect(res.body.activity).toHaveLength(3);
      expect(subtitles(res)).toContain("followers-only caption");
    }
  });
});
