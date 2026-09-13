const request = require("supertest");
const app = require("../../app");
const Notification = require("../../models/Notification");
const PushSubscription = require("../../models/PushSubscription");
const PushPreferences = require("../../models/PushPreferences");
const { createNotificationIfNew } = require("../../utils/notificationService");
const {
  isPushEligible,
  isWithinQuietHoursWindow,
  isSuppressedByQuietHours,
  deliverPushIfEligible,
} = require("../../utils/pushDeliveryManager");
const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser, tokenFor } = require("../helpers/factories");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function authed(user) {
  const token = tokenFor(user);
  return (method, url) => request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("Notification CRUD ownership / IDOR", () => {
  it("only returns the requesting user's own notifications", async () => {
    const owner = await createUser();
    const other = await createUser();
    await createNotificationIfNew(owner._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Owner's notification",
      dedupeKey: "owner-notif-1",
    });
    await createNotificationIfNew(other._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Other's notification",
      dedupeKey: "other-notif-1",
    });

    const res = await authed(owner)("get", "/api/notifications");
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].title).toBe("Owner's notification");
  });

  it("cannot mark-read another user's notification (404, not leaked)", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const notif = await createNotificationIfNew(owner._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Private",
      dedupeKey: "owner-notif-2",
    });

    const res = await authed(attacker)("put", `/api/notifications/${notif._id}/read`);
    expect(res.status).toBe(404);
    const stillUnread = await Notification.findById(notif._id);
    expect(stillUnread.read).toBe(false);
  });

  it("cannot dismiss or snooze another user's notification", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const notif = await createNotificationIfNew(owner._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Private",
      dedupeKey: "owner-notif-3",
    });

    const dismissRes = await authed(attacker)("put", `/api/notifications/${notif._id}/dismiss`);
    expect(dismissRes.status).toBe(404);

    const snoozeRes = await authed(attacker)("put", `/api/notifications/${notif._id}/snooze`).send({
      until: "today",
    });
    expect(snoozeRes.status).toBe(404);
  });

  it("markAllRead only affects the requesting user's notifications", async () => {
    const owner = await createUser();
    const other = await createUser();
    await createNotificationIfNew(owner._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Owner unread",
      dedupeKey: "owner-notif-4",
    });
    await createNotificationIfNew(other._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Other unread",
      dedupeKey: "other-notif-4",
    });

    await authed(owner)("put", "/api/notifications/read-all");

    expect(await Notification.countDocuments({ user: owner._id, read: false })).toBe(0);
    expect(await Notification.countDocuments({ user: other._id, read: false })).toBe(1);
  });

  it("computes an accurate unread count", async () => {
    const user = await createUser();
    await createNotificationIfNew(user._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "One",
      dedupeKey: "unread-1",
    });
    const two = await createNotificationIfNew(user._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Two",
      dedupeKey: "unread-2",
    });
    await authed(user)("put", `/api/notifications/${two._id}/read`);

    const res = await authed(user)("get", "/api/notifications");
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
  });
});

describe("createNotificationIfNew dedup / cooldown", () => {
  it("does not create a duplicate for the same dedupeKey while still active", async () => {
    const user = await createUser();
    const payload = {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Dedupe test",
      dedupeKey: "dedupe-test-1",
    };
    const first = await createNotificationIfNew(user._id, payload);
    const second = await createNotificationIfNew(user._id, payload);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await Notification.countDocuments({ user: user._id, dedupeKey: "dedupe-test-1" })).toBe(1);
  });

  it("resurfaces a dismissed notification with unchanged content only after the cooldown elapses", async () => {
    const user = await createUser();
    const payload = {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Cooldown test",
      dedupeKey: "dedupe-test-2",
    };
    const created = await createNotificationIfNew(user._id, payload);
    await Notification.updateOne(
      { _id: created._id },
      { dismissed: true, dismissedAt: new Date() }
    );

    const withinCooldown = await createNotificationIfNew(user._id, payload, { cooldownMs: 24 * 60 * 60 * 1000 });
    expect(withinCooldown).toBeNull();

    const afterCooldown = await createNotificationIfNew(user._id, payload, { cooldownMs: -1 });
    expect(afterCooldown).not.toBeNull();
    expect(afterCooldown.dismissed).toBe(false);
  });

  it("resurfaces a dismissed notification immediately when its content changed", async () => {
    const user = await createUser();
    const dedupeKey = "dedupe-test-3";
    const created = await createNotificationIfNew(user._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Original title",
      dedupeKey,
    });
    await Notification.updateOne({ _id: created._id }, { dismissed: true, dismissedAt: new Date() });

    const updated = await createNotificationIfNew(user._id, {
      type: "workoutOverdue",
      category: "reminders",
      icon: "Bell",
      title: "Changed title",
      dedupeKey,
    });
    expect(updated).not.toBeNull();
    expect(updated.title).toBe("Changed title");
  });
});

describe("POST /api/notifications/generate (client-submitted candidates)", () => {
  it("silently drops candidates missing required fields instead of creating malformed notifications", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/notifications/generate").send({
      candidates: [
        { type: "workoutOverdue", category: "reminders", icon: "Bell", title: "Valid", dedupeKey: "gen-1" },
        { type: "workoutOverdue", category: "not-a-real-category", icon: "Bell", title: "Bad category", dedupeKey: "gen-2" },
        { category: "reminders", icon: "Bell", title: "Missing type", dedupeKey: "gen-3" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(await Notification.countDocuments({ user: user._id })).toBe(1);
  });

  it("creates a notification under the requesting user, not an attacker-supplied user", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/notifications/generate").send({
      candidates: [{ type: "workoutOverdue", category: "reminders", icon: "Bell", title: "Mine", dedupeKey: "gen-owner" }],
    });
    expect(res.status).toBe(201);
    const stored = await Notification.findOne({ dedupeKey: "gen-owner" });
    expect(String(stored.user)).toBe(String(user._id));
  });
});

describe("Push subscription / preferences", () => {
  it("registers a subscription and enables push preferences by default", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({
      endpoint: "https://push.example/registration-test",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(res.status).toBe(201);

    const prefs = await PushPreferences.findOne({ user: user._id });
    expect(prefs.pushEnabled).toBe(true);
  });

  it("rejects a malformed subscription payload", async () => {
    const user = await createUser();
    const res = await authed(user)("post", "/api/push/subscriptions").send({ endpoint: "https://push.example/x" });
    expect(res.status).toBe(400);
  });

  it("removeSubscription only removes the requesting user's own subscription", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    await PushSubscription.create({
      user: owner._id,
      endpoint: "https://push.example/owned",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });

    const res = await authed(attacker)("delete", "/api/push/subscriptions").send({
      endpoint: "https://push.example/owned",
    });
    expect(res.status).toBe(200);
    expect(await PushSubscription.countDocuments({ endpoint: "https://push.example/owned" })).toBe(1);
  });

  it("updates quiet-hours preferences", async () => {
    const user = await createUser();
    const res = await authed(user)("put", "/api/push/preferences").send({
      pushEnabled: true,
      quietHours: { enabled: true, start: "22:00", end: "07:00", mode: "criticalOnly" },
    });
    expect(res.status).toBe(200);
    expect(res.body.quietHours.mode).toBe("criticalOnly");

    const stored = await PushPreferences.findOne({ user: user._id });
    expect(stored.quietHours.enabled).toBe(true);
  });

  it("ignores an invalid quiet-hours mode rather than storing it", async () => {
    const user = await createUser();
    await authed(user)("put", "/api/push/preferences").send({
      quietHours: { mode: "not-a-real-mode" },
    });
    const stored = await PushPreferences.findOne({ user: user._id });
    expect(stored.quietHours.mode).toBe("suppressAll");
  });
});

describe("Push delivery eligibility (pure logic)", () => {
  it("only treats the curated notification types as push-eligible", () => {
    expect(isPushEligible({ type: "personalRecord" })).toBe(true);
    expect(isPushEligible({ type: "physiqueLiked" })).toBe(false);
  });

  it("computes quiet-hours window membership across midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 30, 0));
    try {
      expect(isWithinQuietHoursWindow("22:00", "07:00")).toBe(true);
      expect(isWithinQuietHoursWindow("08:00", "20:00")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppressAll blocks everything in-window; criticalOnly allows only critical priority", () => {
    const inWindowQuietHours = { enabled: true, start: "00:00", end: "23:59", mode: "suppressAll" };
    expect(isSuppressedByQuietHours(inWindowQuietHours, { priority: "high" })).toBe(true);

    const criticalOnly = { enabled: true, start: "00:00", end: "23:59", mode: "criticalOnly" };
    expect(isSuppressedByQuietHours(criticalOnly, { priority: "critical" })).toBe(false);
    expect(isSuppressedByQuietHours(criticalOnly, { priority: "high" })).toBe(true);
  });
});

describe("deliverPushIfEligible gating (webpush call mocked, not real delivery)", () => {
  const webpush = require("web-push");
  let sendSpy;

  beforeEach(() => {
    sendSpy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 });
  });
  afterEach(() => sendSpy.mockRestore());

  it("does not attempt delivery when push is disabled", async () => {
    const user = await createUser();
    await PushPreferences.create({ user: user._id, pushEnabled: false });
    await PushSubscription.create({
      user: user._id,
      endpoint: "https://push.example/disabled",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });

    await deliverPushIfEligible(user._id, {
      _id: "000000000000000000000001",
      type: "personalRecord",
      priority: "high",
      title: "PR",
      subtitle: "",
      icon: "Trophy",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does not attempt delivery for a non-push-eligible notification type", async () => {
    const user = await createUser();
    await PushPreferences.create({ user: user._id, pushEnabled: true });
    await PushSubscription.create({
      user: user._id,
      endpoint: "https://push.example/ineligible",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });

    await deliverPushIfEligible(user._id, {
      _id: "000000000000000000000002",
      type: "physiqueLiked",
      priority: "medium",
      title: "Liked",
      subtitle: "",
      icon: "Heart",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("attempts delivery and marks pushSentAt when eligible, enabled, and subscribed", async () => {
    const user = await createUser();
    await PushPreferences.create({ user: user._id, pushEnabled: true });
    await PushSubscription.create({
      user: user._id,
      endpoint: "https://push.example/eligible",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    const notif = await Notification.create({
      user: user._id,
      type: "personalRecord",
      category: "progress",
      priority: "high",
      icon: "Trophy",
      title: "New PR!",
      dedupeKey: "push-eligible-1",
    });

    await deliverPushIfEligible(user._id, notif);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const stored = await Notification.findById(notif._id);
    expect(stored.pushSentAt).not.toBeNull();
  });

  it("does not attempt delivery with no registered subscription", async () => {
    const user = await createUser();
    await PushPreferences.create({ user: user._id, pushEnabled: true });

    await deliverPushIfEligible(user._id, {
      _id: "000000000000000000000003",
      type: "personalRecord",
      priority: "high",
      title: "PR",
      subtitle: "",
      icon: "Trophy",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
