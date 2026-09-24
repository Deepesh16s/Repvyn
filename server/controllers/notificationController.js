const Notification = require("../models/Notification");
const { createNotificationsIfNew } = require("../utils/notificationService");

const MAX_LIST_LIMIT = 100;

exports.getNotifications = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, MAX_LIST_LIMIT);
    const now = new Date();

    await Notification.updateMany(
      { user: req.user._id, dismissed: false, expiresAt: { $ne: null, $lt: now } },
      { dismissed: true, dismissedAt: now }
    );

    const activeFilter = {
      user: req.user._id,
      dismissed: false,
      $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
    };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(activeFilter).sort({ lastShownAt: -1 }).limit(limit),
      Notification.countDocuments({ ...activeFilter, read: false }),
    ]);

    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to load notifications." });
  }
};

exports.markRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to update notification." });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false, dismissed: false },
      { read: true }
    );
    res.status(200).json({ message: "All notifications marked as read." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to mark notifications as read." });
  }
};

exports.dismiss = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { dismissed: true, dismissedAt: new Date() },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to dismiss notification." });
  }
};

const SNOOZE_END_OF_TODAY_HOURS = 23;
const SNOOZE_END_OF_TODAY_MINUTES = 59;

function computeSnoozeUntil(until) {
  const target = new Date();
  if (until === "tomorrow") target.setDate(target.getDate() + 1);
  else if (until !== "today") return null;
  target.setHours(SNOOZE_END_OF_TODAY_HOURS, SNOOZE_END_OF_TODAY_MINUTES, 59, 999);
  return target;
}

exports.snooze = async (req, res) => {
  try {
    const snoozedUntil = computeSnoozeUntil(req.body.until);
    if (!snoozedUntil) {
      return res.status(400).json({ message: "until must be 'today' or 'tomorrow'" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { snoozedUntil },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to snooze notification." });
  }
};

exports.clearRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: true, dismissed: false },
      { dismissed: true, dismissedAt: new Date() }
    );
    res.status(200).json({ message: "Read notifications cleared." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to clear read notifications." });
  }
};

const ALLOWED_CATEGORIES = ["progress", "cardio", "reminders", "insights"];
const ALLOWED_PRIORITIES = ["low", "medium", "high", "critical"];
const ALLOWED_CONFIDENCE = ["low", "medium", "high"];

const CLIENT_GENERATED_TYPES = new Set([
  "cardioActivityNotLogged",
  "cardioSessionDue",
  "cardioStreakExpiring",
  "goalExpiringToday",
  "goalProgressReminder",
  "groupedReminder",
  "milestoneAlmostComplete",
  "muscleGroupNeglected",
  "plannerOverlap",
  "plannerRescheduleWarning",
  "plannerSeriesEndingSoon",
  "plateauDetected",
  "recurringDueTomorrow",
  "streakProtection",
  "volumeLandmarkAchieved",
  "weeklyGradeImproved",
  "weeklyVolumeIncreased",
  "workoutMissedYesterday",
  "workoutOverdue",
  "workoutStartingSoon",
  "workoutToday",
]);

const MAX_CANDIDATES = 50;
const MAX_ICON_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_SUBTITLE_LENGTH = 500;
const MAX_DEDUPE_KEY_LENGTH = 200;
const MAX_NAVIGATION_TARGET_LENGTH = 300;
const MAX_ACTION_FIELD_LENGTH = 100;
const MAX_METADATA_JSON_LENGTH = 4000;

function clip(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function sanitizeNavigationTarget(value) {
  if (typeof value !== "string" || value.length > MAX_NAVIGATION_TARGET_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  try {
    return JSON.stringify(metadata).length <= MAX_METADATA_JSON_LENGTH ? metadata : null;
  } catch {
    return null;
  }
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const { page, entityId, focus } = action;
  if (typeof page !== "string") return null;
  return {
    page: clip(page, MAX_ACTION_FIELD_LENGTH),
    entityId: clip(entityId, MAX_ACTION_FIELD_LENGTH),
    focus: clip(focus, MAX_ACTION_FIELD_LENGTH),
  };
}

exports.generateFromClient = async (req, res) => {
  try {
    const candidates = Array.isArray(req.body.candidates)
      ? req.body.candidates.slice(0, MAX_CANDIDATES)
      : [];

    const payloads = candidates
      .filter(
        (c) =>
          c &&
          CLIENT_GENERATED_TYPES.has(c.type) &&
          ALLOWED_CATEGORIES.includes(c.category) &&
          typeof c.icon === "string" &&
          typeof c.title === "string" &&
          c.title.trim() &&
          typeof c.dedupeKey === "string" &&
          c.dedupeKey &&
          c.dedupeKey.length <= MAX_DEDUPE_KEY_LENGTH
      )
      .map((c) => {
        const parsedExpiresAt = c.expiresAt ? new Date(c.expiresAt) : null;
        return {
          type: c.type,
          category: c.category,
          priority: ALLOWED_PRIORITIES.includes(c.priority) ? c.priority : "medium",
          confidence: ALLOWED_CONFIDENCE.includes(c.confidence) ? c.confidence : undefined,
          icon: clip(c.icon, MAX_ICON_LENGTH),
          title: clip(c.title, MAX_TITLE_LENGTH),
          subtitle: clip(c.subtitle, MAX_SUBTITLE_LENGTH),
          navigationTarget: sanitizeNavigationTarget(c.navigationTarget),
          action: sanitizeAction(c.action),
          dedupeKey: c.dedupeKey,
          expiresAt: parsedExpiresAt && !Number.isNaN(parsedExpiresAt.getTime()) ? parsedExpiresAt : null,
          metadata: sanitizeMetadata(c.metadata),
        };
      });

    const created = await createNotificationsIfNew(req.user._id, payloads);
    res.status(201).json({ created });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to generate notifications." });
  }
};
