const request = require("supertest");
const app = require("../../app");
const Conversation = require("../../models/Conversation");
const Message = require("../../models/Message");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("GET /api/users/:username/followers and /following (privacy)", () => {
  it("is visible to anyone for a public account", async () => {
    const target = await createUser({ profileVisibility: "public" });
    const viewer = await createUser();
    const followersRes = await authed(viewer)("get", `/api/users/${target.username}/followers`);
    expect(followersRes.status).toBe(200);
    const followingRes = await authed(viewer)("get", `/api/users/${target.username}/following`);
    expect(followingRes.status).toBe(200);
  });

  it("is hidden from a non-follower for a private account", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const viewer = await createUser();
    const followersRes = await authed(viewer)("get", `/api/users/${target.username}/followers`);
    expect(followersRes.status).toBe(403);
    const followingRes = await authed(viewer)("get", `/api/users/${target.username}/following`);
    expect(followingRes.status).toBe(403);
  });

  it("is visible to an approved follower for a private account", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const follower = await createUser();

    await authed(follower)("post", `/api/users/${target.username}/follow`);
    await authed(target)("post", `/api/users/${follower.username}/accept-follow-request`);

    const res = await authed(follower)("get", `/api/users/${target.username}/followers`);
    expect(res.status).toBe(200);
  });

  it("is always visible to the account owner themselves", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const res = await authed(target)("get", `/api/users/${target.username}/followers`);
    expect(res.status).toBe(200);
  });

  it("is blocked for a user the account owner has blocked, even if the account is public", async () => {
    const target = await createUser({ profileVisibility: "public" });
    const blocked = await createUser();
    await authed(target)("post", `/api/users/${blocked.username}/block`);

    const followersRes = await authed(blocked)("get", `/api/users/${target.username}/followers`);
    expect(followersRes.status).toBe(403);
    const followingRes = await authed(blocked)("get", `/api/users/${target.username}/following`);
    expect(followingRes.status).toBe(403);
  });

  it("returns 404 for a nonexistent username", async () => {
    const viewer = await createUser();
    const res = await authed(viewer)("get", "/api/users/no-such-user-at-all/followers");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/users/search (discoverability)", () => {
  it("finds a public account by its exact username", async () => {
    const target = await createUser({ profileVisibility: "public" });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/search?q=${target.username}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).toContain(target.username);
  });

  it("does not return a username match for a partial or prefix username", async () => {
    const target = await createUser({ profileVisibility: "public" });
    const viewer = await createUser();
    const prefix = target.username.slice(0, Math.max(1, target.username.length - 1));
    const res = await authed(viewer)("get", `/api/users/search?q=${prefix}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).not.toContain(target.username);
  });

  it("surfaces a private account to anyone by its exact username", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/search?q=${target.username}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).toContain(target.username);
  });

  it("does not surface a private account by name search, even with discoverableByName set", async () => {
    const target = await createUser({
      profileVisibility: "private",
      name: "Zebra Quokka",
      discoverableByName: true,
    });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/search?q=Zebra`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).not.toContain(target.username);
  });

  it("does not surface a public account by name unless it opted in with discoverableByName", async () => {
    const target = await createUser({
      profileVisibility: "public",
      name: "Zebra Quokka",
      discoverableByName: false,
    });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/search?q=Zebra`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).not.toContain(target.username);
  });

  it("surfaces a public account by name once it opts in with discoverableByName", async () => {
    const target = await createUser({
      profileVisibility: "public",
      name: "Zebra Quokka",
      discoverableByName: true,
    });
    const viewer = await createUser();
    const res = await authed(viewer)("get", `/api/users/search?q=Zebra`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).toContain(target.username);
  });

  it("hides a blocked account from the blocker's exact-username search", async () => {
    const target = await createUser({ profileVisibility: "public" });
    const blocker = await createUser();
    await authed(blocker)("post", `/api/users/${target.username}/block`);

    const res = await authed(blocker)("get", `/api/users/search?q=${target.username}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).not.toContain(target.username);
  });

  it("always surfaces a private account to itself", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const res = await authed(target)("get", `/api/users/search?q=${target.username}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.username)).toContain(target.username);
  });

  it("returns an empty list for a nonexistent username", async () => {
    const viewer = await createUser();
    const res = await authed(viewer)("get", "/api/users/search?q=no-such-user-at-all-12345");
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(0);
  });
});

describe("Conversation / message IDOR checks", () => {
  async function createConversationBetween(userA, userB) {
    const [low, high] = Conversation.canonicalPair(userA._id, userB._id);
    return Conversation.create({ participants: [low, high], participantLow: low, participantHigh: high });
  }

  it("a non-participant cannot fetch someone else's conversation", async () => {
    const a = await createUser();
    const b = await createUser();
    const outsider = await createUser();
    const conversation = await createConversationBetween(a, b);

    const res = await authed(outsider)("get", `/api/conversations/${conversation._id}`);
    expect(res.status).toBe(403);
  });

  it("a non-participant cannot read someone else's messages", async () => {
    const a = await createUser();
    const b = await createUser();
    const outsider = await createUser();
    const conversation = await createConversationBetween(a, b);
    await Message.create({ conversation: conversation._id, sender: a._id, body: "secret" });

    const res = await authed(outsider)("get", `/api/conversations/${conversation._id}/messages`);
    expect(res.status).toBe(403);
  });

  it("a non-participant cannot send a message into someone else's conversation", async () => {
    const a = await createUser();
    const b = await createUser();
    const outsider = await createUser();
    const conversation = await createConversationBetween(a, b);

    const res = await authed(outsider)("post", `/api/conversations/${conversation._id}/messages`).send({
      body: "injected",
    });
    expect(res.status).toBe(403);
    expect(await Message.countDocuments({ conversation: conversation._id })).toBe(0);
  });

  it("a participant can send and read messages in their own conversation", async () => {
    const a = await createUser();
    const b = await createUser();
    const conversation = await createConversationBetween(a, b);

    const sendRes = await authed(a)("post", `/api/conversations/${conversation._id}/messages`).send({ body: "hi" });
    expect(sendRes.status).toBe(201);

    const readRes = await authed(b)("get", `/api/conversations/${conversation._id}/messages`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.messages).toHaveLength(1);
  });

  it("blocks a message send after a block occurs, even in an existing conversation", async () => {
    const a = await createUser();
    const b = await createUser();
    const conversation = await createConversationBetween(a, b);
    await authed(a)("post", `/api/users/${b.username}/block`);

    const res = await authed(a)("post", `/api/conversations/${conversation._id}/messages`).send({ body: "hi" });
    expect(res.status).toBe(403);
  });

  it("only the sender can delete their own message", async () => {
    const a = await createUser();
    const b = await createUser();
    const conversation = await createConversationBetween(a, b);
    const msg = await Message.create({ conversation: conversation._id, sender: a._id, body: "delete me" });

    const wrongUser = await authed(b)("delete", `/api/conversations/${conversation._id}/messages/${msg._id}`);
    expect(wrongUser.status).toBe(403);

    const rightUser = await authed(a)("delete", `/api/conversations/${conversation._id}/messages/${msg._id}`);
    expect(rightUser.status).toBe(200);
  });

  it("creating a conversation with a private account requires a mutual follow", async () => {
    const target = await createUser({ profileVisibility: "private" });
    const requester = await createUser({ profileVisibility: "public" });

    const blockedAttempt = await authed(requester)("post", "/api/conversations").send({ username: target.username });
    expect(blockedAttempt.status).toBe(403);

    await authed(requester)("post", `/api/users/${target.username}/follow`);
    await authed(target)("post", `/api/users/${requester.username}/accept-follow-request`);
    await authed(target)("post", `/api/users/${requester.username}/follow`);

    const allowedAttempt = await authed(requester)("post", "/api/conversations").send({ username: target.username });
    expect(allowedAttempt.status).toBe(200);
  });
});
