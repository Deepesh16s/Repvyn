const PushSubscription = require("../models/PushSubscription");
const PushPreferences = require("../models/PushPreferences");
const Notification = require("../models/Notification");
const { isAllowedPushEndpoint, isValidPushKey } = require("../utils/pushEndpoint");

exports.registerSubscription = async (req, res) => {
  try {
    const { endpoint, keys } = req.body.subscription || req.body;
    if (!isAllowedPushEndpoint(endpoint) || !isValidPushKey(keys?.p256dh) || !isValidPushKey(keys?.auth)) {
      return res.status(400).json({ message: "Invalid push subscription." });
    }

    const subscription = await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        user: req.user._id,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.headers["user-agent"] || null,
        lastSeenAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await PushPreferences.findOneAndUpdate(
      { user: req.user._id },
      { $setOnInsert: { user: req.user._id }, pushEnabled: true },
      { upsert: true }
    );

    res.status(201).json(subscription);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to register push subscription." });
  }
};

exports.removeSubscription = async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (typeof endpoint !== "string" || !endpoint) {
      return res.status(400).json({ message: "endpoint is required." });
    }
    await PushSubscription.deleteOne({ endpoint, user: req.user._id });
    res.status(200).json({ message: "Push subscription removed." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to remove push subscription." });
  }
};

exports.getPreferences = async (req, res) => {
  try {
    const prefs =
      (await PushPreferences.findOne({ user: req.user._id })) ||
      new PushPreferences({ user: req.user._id });
    res.status(200).json(prefs);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to load push preferences." });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    const { pushEnabled, quietHours } = req.body;
    const update = {};
    if (typeof pushEnabled === "boolean") update.pushEnabled = pushEnabled;
    if (quietHours && typeof quietHours === "object") {
      if (typeof quietHours.enabled === "boolean") update["quietHours.enabled"] = quietHours.enabled;
      if (typeof quietHours.start === "string") update["quietHours.start"] = quietHours.start;
      if (typeof quietHours.end === "string") update["quietHours.end"] = quietHours.end;
      if (["allow", "criticalOnly", "suppressAll"].includes(quietHours.mode)) {
        update["quietHours.mode"] = quietHours.mode;
      }
    }

    const prefs = await PushPreferences.findOneAndUpdate(
      { user: req.user._id },
      { $set: update, $setOnInsert: { user: req.user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(200).json(prefs);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to update push preferences." });
  }
};

exports.markPushClicked = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { pushClickedAt: new Date(), read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to record push click." });
  }
};
