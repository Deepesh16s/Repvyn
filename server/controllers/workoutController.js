const Workout = require("../models/workout");
const Exercise = require("../models/Exercise");
const PlannedWorkout = require("../models/PlannedWorkout");
const {
  updateGoalsForWorkout,
  updateGoalsForSession,
} = require("../utils/updateGoals");
const recalculateGoalsForExercise = require("../utils/recalculateGoals");
const { recalculateGoalsForExercises } = require("../utils/recalculateGoals");
const { detectWorkoutSessionNotifications } = require("../utils/notificationTriggers");
const { createNotificationsIfNew, suppressNotifications } = require("../utils/notificationService");
const { evaluateBadges } = require("../utils/badges");
const { recordActivity } = require("../utils/activityFeed");
const { OTHER_SESSION_TYPE } = require("../constants/sessionTypes");
const {
  validateWorkoutPayload,
  validateWorkoutSets,
  validateSessionMeta,
  validateSessionType,
  normalizeCustomSessionType,
  validateCardioEntry,
  validateSessionTiming,
  validateOptionalSessionTimestamps,
  validateNote,
} = require("../utils/validateWorkoutPayload");

const NOTE_MAX_LENGTH = 500;
const SESSION_NOTE_MAX_LENGTH = 1000;
const MAX_WORKOUTS_PAGE_SIZE = 5000;

function describeCompletedSession(sessionType, customSessionType) {
  if (!sessionType) return "completed a workout";
  if (sessionType === OTHER_SESSION_TYPE) {
    return customSessionType ? `completed ${customSessionType}` : "completed a workout";
  }
  return `completed a ${sessionType} session`;
}

exports.createWorkout = async (req, res) => {
  try {
    const { exercise, workoutSets, sessionId, sessionDuration } = req.body;

    validateWorkoutPayload({ workoutSets, sessionId, sessionDuration });

    const exerciseDoc = await Exercise.findOne({
      _id: exercise,
      createdBy: req.user._id,
    });
    if (!exerciseDoc) {
      const err = new Error("Selected exercise was not found");
      err.status = 400;
      throw err;
    }

    const cleanSets = workoutSets.map((s) => ({
      weight: Number(s.weight),
      reps: Number(s.reps),
    }));

    const workout = await Workout.create({
      user: req.user._id,
      exercise: exerciseDoc._id,
      workoutSets: cleanSets,
      sessionId: sessionId.trim(),
      sessionDuration: Number(sessionDuration),
    });

    await updateGoalsForWorkout(req.user._id, exercise, cleanSets);

    try {
      await evaluateBadges(req.user._id);
    } catch (badgeError) {
      console.error("Badge evaluation failed:", badgeError);
    }

    res.status(201).json(workout);
  } catch (error) {
    console.log(error);

    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server Error",
    });
  }
};

exports.createWorkoutSession = async (req, res) => {
  try {
    const {
      sessionId,
      sessionDuration,
      sessionType,
      customSessionType,
      exercises,
      startedAt,
      endedAt,
      sessionNote,
      plannedWorkoutId,
    } = req.body;

    validateSessionMeta(sessionId, sessionDuration);
    validateSessionType(sessionType, customSessionType);
    const cleanSessionNote = validateNote(sessionNote, SESSION_NOTE_MAX_LENGTH, "Workout note");

    const { startedAt: parsedStartedAt, endedAt: parsedEndedAt } =
      validateOptionalSessionTimestamps(startedAt, endedAt);

    if (!Array.isArray(exercises) || exercises.length === 0) {
      const err = new Error("exercises must be a non-empty array");
      err.status = 400;
      throw err;
    }

    const cleanEntries = exercises.map((entry, i) => {
      const entryType =
        entry && entry.entryType === "cardio" ? "cardio" : "strength";
      const note = validateNote(entry?.note, NOTE_MAX_LENGTH, `Exercise ${i + 1} note`);

      if (entryType === "cardio") {
        const { activityType, data, variant } = validateCardioEntry(entry.cardio, i);
        return {
          entryType: "cardio",
          cardio: { activityType, data, variant },
          note,
        };
      }

      if (!entry || !entry.exercise) {
        const err = new Error(`Exercise ${i + 1} is missing an exercise id`);
        err.status = 400;
        throw err;
      }

      validateWorkoutSets(entry.workoutSets);

      return {
        entryType: "strength",
        exercise: entry.exercise,
        workoutSets: entry.workoutSets.map((s) => ({
          weight: Number(s.weight),
          reps: Number(s.reps),
        })),
        note,
      };
    });

    const strengthExerciseIds = [
      ...new Set(
        cleanEntries
          .filter((entry) => entry.entryType === "strength")
          .map((entry) => String(entry.exercise))
      ),
    ];

    let trainedMuscleGroups = [];

    if (strengthExerciseIds.length) {
      const ownedExercises = await Exercise.find({
        _id: { $in: strengthExerciseIds },
        createdBy: req.user._id,
      }).select("_id muscleGroup");

      const ownedIds = new Set(ownedExercises.map((e) => String(e._id)));
      const missingIds = strengthExerciseIds.filter((id) => !ownedIds.has(id));

      if (missingIds.length) {
        const err = new Error("One or more selected exercises were not found");
        err.status = 400;
        throw err;
      }

      trainedMuscleGroups = [...new Set(ownedExercises.map((e) => e.muscleGroup).filter(Boolean))];
    }

    const trimmedSessionId = sessionId.trim();
    const numericSessionDuration = Number(sessionDuration);
    const normalizedCustomSessionType = normalizeCustomSessionType(
      sessionType,
      customSessionType
    );

    const docs = cleanEntries.map((entry) => ({
      user: req.user._id,
      entryType: entry.entryType,
      ...(entry.entryType === "cardio"
        ? { cardio: entry.cardio }
        : { exercise: entry.exercise, workoutSets: entry.workoutSets }),
      note: entry.note,
      sessionId: trimmedSessionId,
      sessionDuration: numericSessionDuration,
      sessionType,
      customSessionType: normalizedCustomSessionType,
      startedAt: parsedStartedAt,
      endedAt: parsedEndedAt,
      timingMode: "AUTO",
      sessionNote: cleanSessionNote,
    }));

    const createdWorkouts = await Workout.insertMany(docs, {
      ordered: true,
    });

    if (plannedWorkoutId) {
      try {
        await PlannedWorkout.updateOne(
          { _id: plannedWorkoutId, user: req.user._id },
          { status: "Completed", completedSessionId: trimmedSessionId }
        );
        await suppressNotifications(req.user._id, { dedupeKey: `workout:${plannedWorkoutId}` });
      } catch (linkError) {
        console.error("Planned workout completion link failed:", linkError);
      }
    }

    if (trainedMuscleGroups.length) {
      try {
        await suppressNotifications(req.user._id, {
          type: { $in: ["muscleGroupNeglected"] },
          "metadata.muscles": { $in: trainedMuscleGroups },
        });
      } catch (suppressError) {
        console.error("Neglect suppression failed:", suppressError);
      }
    }

    const entriesForGoals = cleanEntries.map((entry) => ({
      exercise: entry.exercise,
      workoutSets: entry.workoutSets,
    }));

    let goalRecalculationFailed = false;
    let goalNotificationPayloads = [];

    try {
      goalNotificationPayloads = await updateGoalsForSession(req.user._id, entriesForGoals);
    } catch (goalError) {
      console.error("Goal recalculation failed:", goalError);
      goalRecalculationFailed = true;
    }

    let notifications = [];
    try {
      const strengthEntries = cleanEntries.filter((e) => e.entryType === "strength");
      const cardioEntries = cleanEntries.filter((e) => e.entryType === "cardio");
      const sessionPayloads = await detectWorkoutSessionNotifications(req.user._id, {
        sessionId: trimmedSessionId,
        strengthEntries,
        cardioEntries,
        sessionDuration: numericSessionDuration,
      });
      notifications = await createNotificationsIfNew(req.user._id, [
        ...sessionPayloads,
        ...goalNotificationPayloads,
      ]);
    } catch (notificationError) {
      console.error("Notification generation failed:", notificationError);
    }

    try {
      await evaluateBadges(req.user._id);
    } catch (badgeError) {
      console.error("Badge evaluation failed:", badgeError);
    }

    try {
      await recordActivity(req.user._id, {
        type: "workoutCompleted",
        title: describeCompletedSession(sessionType, normalizedCustomSessionType),
      });
    } catch (activityError) {
      console.error("Activity recording failed:", activityError);
    }

    if (goalRecalculationFailed) {
      return res.status(201).json({
        message:
          "Workout session saved successfully, but goal recalculation failed. Please refresh your Goals or recalculate them later.",
        workouts: createdWorkouts,
        goalRecalculationFailed: true,
        notifications,
      });
    }

    return res.status(201).json({
      message: "Workout session saved successfully.",
      workouts: createdWorkouts,
      goalRecalculationFailed: false,
      notifications,
    });
  } catch (error) {
    console.log(error);

    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server Error",
    });
  }
};

exports.getWorkouts = async (req, res) => {
  try {
    const { start, end } = req.query;
    const page = Math.max(Math.floor(Number(req.query.page)) || 1, 1);
    const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 10, 1), MAX_WORKOUTS_PAGE_SIZE);

    let query = {
      user: req.user._id,
    };

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "start and end must be valid dates" });
      }
      query.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const workouts = await Workout.find(query)
      .populate("exercise")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json(workouts);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};


exports.updateWorkout = async (req, res) => {
  try {
    const workout = await Workout.findById(req.params.id);

    if (!workout) {
      return res.status(404).json({
        message: "Workout not found",
      });
    }

    if (workout.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({
        message: "Workout not found",
      });
    }

    const updates = {};

    if (req.body.workoutSets !== undefined) {
      validateWorkoutSets(req.body.workoutSets);

      updates.workoutSets = req.body.workoutSets.map((s) => ({
        weight: Number(s.weight),
        reps: Number(s.reps),
      }));
    }

    if (req.body.exercise !== undefined) {
      const exerciseDoc = await Exercise.findOne({
        _id: req.body.exercise,
        createdBy: req.user._id,
      });
      if (!exerciseDoc) {
        return res.status(400).json({
          message: "Selected exercise was not found",
        });
      }
      updates.exercise = exerciseDoc._id;
    }

    const updatedWorkout = await Workout.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        new: true,
        runValidators: true,
      }
    );

    if (
      updates.workoutSets !== undefined ||
      updates.exercise !== undefined
    ) {
      await updateGoalsForWorkout(
        req.user._id,
        updatedWorkout.exercise,
        updatedWorkout.workoutSets
      );
      await recalculateGoalsForExercises(req.user._id, [
        workout.exercise,
        updatedWorkout.exercise,
      ]);
    }

    res.status(200).json(updatedWorkout);
  } catch (error) {
    console.log(error);

    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server Error",
    });
  }
};

exports.updateWorkoutSessionTiming = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { startedAt, endedAt, sessionDuration, timingMode } = req.body;

    if (!sessionId || !sessionId.trim()) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const sessionWorkouts = await Workout.find({
      user: req.user._id,
      sessionId: sessionId.trim(),
    }).select("_id");

    if (!sessionWorkouts.length) {
      return res.status(404).json({ message: "Session not found" });
    }

    const validated = validateSessionTiming({
      startedAt,
      endedAt,
      sessionDuration,
      timingMode,
    });

    await Workout.updateMany(
      { user: req.user._id, sessionId: sessionId.trim() },
      {
        startedAt: validated.startedAt,
        endedAt: validated.endedAt,
        sessionDuration: validated.sessionDuration,
        timingMode: validated.timingMode,
      },
      { runValidators: true }
    );

    res.status(200).json({
      message: "Workout timing updated successfully.",
      sessionId: sessionId.trim(),
      startedAt: validated.startedAt,
      endedAt: validated.endedAt,
      sessionDuration: validated.sessionDuration,
      timingMode: validated.timingMode,
      warning: validated.warning,
    });
  } catch (error) {
    console.log(error);

    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server Error",
    });
  }
};

exports.deleteWorkout = async (req, res) => {
  try {
    const workout = await Workout.findById(req.params.id);

    if (!workout) {
      return res.status(404).json({
        message: "Workout not found",
      });
    }

    if (workout.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({
        message: "Workout not found",
      });
    }

    await workout.deleteOne();

    await recalculateGoalsForExercise(req.user._id, workout.exercise);

    res.status(200).json({
      message: "Workout deleted successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

exports.deleteWorkoutSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId || !sessionId.trim()) {
      return res.status(400).json({
        message: "sessionId is required",
      });
    }

    const sessionWorkouts = await Workout.find({
      user: req.user._id,
      sessionId: sessionId.trim(),
    }).select("exercise");

    if (!sessionWorkouts.length) {
      return res.status(404).json({
        message: "Session not found",
      });
    }

    const exerciseIds = sessionWorkouts.map((w) => w.exercise);

    await Workout.deleteMany({
      user: req.user._id,
      sessionId: sessionId.trim(),
    });

    await recalculateGoalsForExercises(req.user._id, exerciseIds);

    res.status(200).json({
      message: "Session deleted successfully",
      deletedCount: sessionWorkouts.length,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};