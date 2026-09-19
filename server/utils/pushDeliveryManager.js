const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");
const PushPreferences = require("../models/PushPreferences");
const Notification = require("../models/Notification");
const { isAllowedPushEndpoint } = require("./pushEndpoint");

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || "no-reply@repvyn.local"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const PUSH_ELIGIBLE_TYPES = new Set([
  "workoutOverdue",
  "workoutStartingSoon",
  "workoutToday",
  "workoutMissedYesterday",
  "recurringDueTomorrow",
  "streakProtection",
  "cardioStreakExpiring",
  "goalCompleted",
  "goalExpiringToday",
  "plannerRescheduleWarning",
  "plannerOverlap",
  "plannerSeriesEndingSoon",
  "personalRecord",
]);

const MAX_PUSHES_PER_HOUR = 3;
const MAX_PUSHES_PER_DAY = 10;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

function isPushEligible(notification) {
  return PUSH_ELIGIBLE_TYPES.has(notification.type);
}

function isWithinQuietHoursWindow(start, end) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function isSuppressedByQuietHours(quietHours, notification) {
  if (!quietHours?.enabled) return false;
  if (!isWithinQuietHoursWindow(quietHours.start, quietHours.end)) return false;

  if (quietHours.mode === "allow") return false;
  if (quietHours.mode === "suppressAll") return true;
  if (quietHours.mode === "criticalOnly") return notification.priority !== "critical";
  return false;
}

async function isThrottled(userId) {
  const now = Date.now();
  const [hourCount, dayCount] = await Promise.all([
    Notification.countDocuments({ user: userId, pushSentAt: { $gte: new Date(now - MS_PER_HOUR) } }),
    Notification.countDocuments({ user: userId, pushSentAt: { $gte: new Date(now - MS_PER_DAY) } }),
  ]);
  return hourCount >= MAX_PUSHES_PER_HOUR || dayCount >= MAX_PUSHES_PER_DAY;
}

function buildPushPayload(notification) {
  return {
    notificationId: String(notification._id),
    title: notification.title,
    body: notification.subtitle || "",
    icon: notification.icon,
    navigationTarget: notification.navigationTarget,
    action: notification.action || null,
  };
}

const GONE_STATUS_CODES = new Set([404, 410]);

async function deliverPushIfEligible(userId, notification) {
  if (!isPushEligible(notification)) return;

  const prefs = await PushPreferences.findOne({ user: userId });
  if (!prefs?.pushEnabled) return;

  if (isSuppressedByQuietHours(prefs.quietHours, notification)) return;
  if (await isThrottled(userId)) return;

  const storedSubscriptions = await PushSubscription.find({ user: userId });
  const rejected = storedSubscriptions.filter((sub) => !isAllowedPushEndpoint(sub.endpoint));
  if (rejected.length) {
    await PushSubscription.deleteMany({ _id: { $in: rejected.map((sub) => sub._id) } });
  }
  const subscriptions = storedSubscriptions.filter((sub) => !rejected.includes(sub));
  if (!subscriptions.length) return;

  const payload = JSON.stringify(buildPushPayload(notification));
  let sentToAny = false;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          payload
        );
        sentToAny = true;
      } catch (error) {
        if (GONE_STATUS_CODES.has(error.statusCode)) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
          console.error("Push delivery failed:", error.message || error);
        }
      }
    })
  );

  await Notification.updateOne(
    { _id: notification._id },
    sentToAny ? { pushSentAt: new Date() } : { pushFailedAt: new Date() }
  );
}

module.exports = {
  deliverPushIfEligible,
  isPushEligible,
  isWithinQuietHoursWindow,
  isSuppressedByQuietHours,
};
