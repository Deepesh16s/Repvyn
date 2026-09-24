const HealthConnection = require("../models/HealthConnection");
const HealthSyncState = require("../models/HealthSyncState");
const HealthSample = require("../models/HealthSample");
const HealthSleepSession = require("../models/HealthSleepSession");
const { HEALTH_SLEEP_RECORD_TYPE } = require("../constants/healthRecordTypes");

const MAX_SYNC_BATCH_SIZE = 500;

exports.getConnectionStatus = async (req, res) => {
  try {
    const connection = await HealthConnection.findOne({ user: req.user._id, connected: true });
    const syncState = await HealthSyncState.findOne({ user: req.user._id });

    res.status(200).json({
      connected: !!connection,
      connectedAt: connection?.connectedAt || null,
      grantedRecordTypes: connection?.grantedRecordTypes || [],
      syncState: {
        lastSyncedAt: syncState?.lastSyncedAt || null,
      },
    });
  } catch (error) {
    console.error("getConnectionStatus error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.connectHealth = async (req, res) => {
  try {
    const { grantedRecordTypes } = req.body;

    if (!Array.isArray(grantedRecordTypes) || grantedRecordTypes.length === 0) {
      return res.status(400).json({ message: "grantedRecordTypes is required" });
    }

    await HealthConnection.findOneAndUpdate(
      { user: req.user._id },
      {
        user: req.user._id,
        platform: "android",
        connected: true,
        connectedAt: new Date(),
        disconnectedAt: null,
        grantedRecordTypes,
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ message: "Health data connected" });
  } catch (error) {
    console.error("connectHealth error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.disconnectHealth = async (req, res) => {
  try {
    await HealthConnection.findOneAndUpdate(
      { user: req.user._id },
      { connected: false, disconnectedAt: new Date() }
    );

    // The sync cursor is intentionally cleared on disconnect (not just the
    // connection flag): if the user reconnects later, permissions may have
    // changed, and re-running the historical import is safer than resuming
    // from a stale token against a possibly different permission set.
    await HealthSyncState.deleteOne({ user: req.user._id });

    res.status(200).json({ message: "Health data disconnected" });
  } catch (error) {
    console.error("disconnectHealth error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getSyncState = async (req, res) => {
  try {
    const state = await HealthSyncState.findOne({ user: req.user._id });
    res.status(200).json({
      changesToken: state?.changesToken || null,
      lastSyncedAt: state?.lastSyncedAt || null,
    });
  } catch (error) {
    console.error("getSyncState error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.syncBatch = async (req, res) => {
  try {
    const connection = await HealthConnection.findOne({ user: req.user._id, connected: true });
    if (!connection) {
      return res.status(400).json({ message: "Health data is not connected" });
    }

    const { records, deletedRecordIds, changesToken } = req.body;

    if (!Array.isArray(records) || !Array.isArray(deletedRecordIds)) {
      return res.status(400).json({ message: "records and deletedRecordIds must be arrays" });
    }

    if (records.length > MAX_SYNC_BATCH_SIZE || deletedRecordIds.length > MAX_SYNC_BATCH_SIZE) {
      return res.status(413).json({
        message: `A sync batch can contain at most ${MAX_SYNC_BATCH_SIZE} records and ${MAX_SYNC_BATCH_SIZE} deletions`,
      });
    }

    let upserted = 0;

    for (const record of records) {
      const { recordType, healthConnectRecordId, startTime, endTime, sourceOrigin, device } = record;

      if (!recordType || !healthConnectRecordId || !startTime || !endTime) {
        continue; // malformed entry — skip rather than fail the whole batch
      }

      if (recordType === HEALTH_SLEEP_RECORD_TYPE) {
        await HealthSleepSession.findOneAndUpdate(
          { user: req.user._id, healthConnectRecordId },
          {
            user: req.user._id,
            healthConnectRecordId,
            startTime,
            endTime,
            stages: record.stages || [],
            title: record.title ?? null,
            sourceOrigin: sourceOrigin ?? null,
            device: device ?? null,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } else {
        await HealthSample.findOneAndUpdate(
          { user: req.user._id, healthConnectRecordId },
          {
            user: req.user._id,
            recordType,
            healthConnectRecordId,
            startTime,
            endTime,
            value: record.value,
            unit: record.unit ?? null,
            sourceOrigin: sourceOrigin ?? null,
            device: device ?? null,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
      upserted += 1;
    }

    let deleted = 0;
    if (deletedRecordIds.length > 0) {
      const sampleResult = await HealthSample.deleteMany({
        user: req.user._id,
        healthConnectRecordId: { $in: deletedRecordIds },
      });
      const sleepResult = await HealthSleepSession.deleteMany({
        user: req.user._id,
        healthConnectRecordId: { $in: deletedRecordIds },
      });
      deleted = sampleResult.deletedCount + sleepResult.deletedCount;
    }

    if (changesToken) {
      await HealthSyncState.findOneAndUpdate(
        { user: req.user._id },
        { user: req.user._id, changesToken, lastSyncedAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    res.status(200).json({ message: "Synced", upserted, deleted });
  } catch (error) {
    console.error("syncBatch error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// Most recent HeartRate sample's own {time, beatsPerMinute} entry within the
// most recent HeartRate record's `value` array (HeartRate is stored as a
// series per record, unlike the other scalar types).
function latestHeartRateReading(record) {
  if (!record || !Array.isArray(record.value) || record.value.length === 0) return null;
  return record.value.reduce((latest, sample) =>
    !latest || new Date(sample.time) > new Date(latest.time) ? sample : latest
  , null);
}

exports.getHealthSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    // "Today" as a UTC calendar day, matching this project's existing
    // convention for day-boundary aggregates (see todayKeyUTC/daysAgoKeyUTC
    // in server/utils/goalMetrics.js) rather than inventing a new,
    // timezone-aware definition.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const [
      stepsAgg,
      caloriesAgg,
      latestHeartRateRecord,
      latestRestingHeartRate,
      latestHrv,
      latestExercise,
      latestSleep,
    ] = await Promise.all([
      HealthSample.aggregate([
        { $match: { user: userId, recordType: "Steps", startTime: { $gte: todayStart, $lt: todayEnd } } },
        { $group: { _id: null, total: { $sum: "$value" } } },
      ]),
      HealthSample.aggregate([
        {
          $match: {
            user: userId,
            recordType: "ActiveCaloriesBurned",
            startTime: { $gte: todayStart, $lt: todayEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$value" } } },
      ]),
      HealthSample.findOne({ user: userId, recordType: "HeartRate" }).sort({ startTime: -1 }),
      HealthSample.findOne({ user: userId, recordType: "RestingHeartRate" }).sort({ startTime: -1 }),
      HealthSample.findOne({ user: userId, recordType: "HeartRateVariabilityRmssd" }).sort({ startTime: -1 }),
      HealthSample.findOne({ user: userId, recordType: "ExerciseSession" }).sort({ startTime: -1 }),
      HealthSleepSession.findOne({ user: userId }).sort({ startTime: -1 }),
    ]);

    const latestHr = latestHeartRateReading(latestHeartRateRecord);

    res.status(200).json({
      date: todayStart.toISOString().slice(0, 10),
      steps: stepsAgg.length > 0 ? { total: stepsAgg[0].total, unit: "count" } : null,
      activeCalories: caloriesAgg.length > 0 ? { total: caloriesAgg[0].total, unit: "kilocalories" } : null,
      heartRate: latestHr ? { value: latestHr.beatsPerMinute, unit: "bpm", time: latestHr.time } : null,
      restingHeartRate: latestRestingHeartRate
        ? { value: latestRestingHeartRate.value, unit: "bpm", time: latestRestingHeartRate.startTime }
        : null,
      heartRateVariability: latestHrv
        ? { value: latestHrv.value, unit: "ms", time: latestHrv.startTime }
        : null,
      exercise: latestExercise
        ? {
            exerciseType: latestExercise.value?.exerciseType ?? null,
            title: latestExercise.value?.title ?? null,
            startTime: latestExercise.startTime,
            endTime: latestExercise.endTime,
          }
        : null,
      sleep: latestSleep
        ? {
            startTime: latestSleep.startTime,
            endTime: latestSleep.endTime,
            durationMinutes: Math.round((latestSleep.endTime - latestSleep.startTime) / 60000),
          }
        : null,
    });
  } catch (error) {
    console.error("getHealthSummary error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.deleteHealthData = async (req, res) => {
  try {
    const sampleResult = await HealthSample.deleteMany({ user: req.user._id });
    const sleepResult = await HealthSleepSession.deleteMany({ user: req.user._id });
    await HealthSyncState.deleteOne({ user: req.user._id });

    const deletedCount = sampleResult.deletedCount + sleepResult.deletedCount;
    res.status(200).json({ message: "Health data deleted", deletedCount });
  } catch (error) {
    console.error("deleteHealthData error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};
