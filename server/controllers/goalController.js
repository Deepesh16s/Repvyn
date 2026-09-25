const Goal = require("../models/Goal");
const Exercise = require("../models/Exercise");
const Workout = require("../models/workout");
const {
  GOAL_TYPES,
  MANUAL_GOAL_TYPES,
  GOAL_PERIODS,
  DAILY_PERIODS,
  getAutoDailyTargetDays,
  CARDIO_SESSION_METRIC,
  CARDIO_GOAL_METRICS,
} = require("../constants/goalTypes");
const { CARDIO_ACTIVITY_TYPES } = require("../constants/cardioMetadata");
const metrics = require("../utils/goalMetrics");
const {
  getLatestSessionWorkouts,
  computeCardioGoalCurrent,
} = require("../utils/updateGoals");
const { detectGoalNotificationPayloads } = require("../utils/notificationTriggers");
const { createNotificationsIfNew } = require("../utils/notificationService");

const validateCardioGoalConfig = ({ activityType, metric, period, dailyTarget }) => {
  if (!activityType || !metric || !period) {
    const err = new Error(
      "Cardio Goal requires activityType, metric, and period together."
    );
    err.status = 400;
    throw err;
  }

  if (!CARDIO_ACTIVITY_TYPES.includes(activityType)) {
    const err = new Error(
      `activityType must be one of: ${CARDIO_ACTIVITY_TYPES.join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  if (!CARDIO_GOAL_METRICS.includes(metric)) {
    const err = new Error(
      `metric must be one of: ${CARDIO_GOAL_METRICS.join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  if (!Object.values(GOAL_PERIODS).includes(period)) {
    const err = new Error(
      `period must be one of: ${Object.values(GOAL_PERIODS).join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  if (period === GOAL_PERIODS.NEXT_SESSION && metric === CARDIO_SESSION_METRIC) {
    const err = new Error(
      "Next Session goals need a real metric (distance, duration, etc.), not Sessions."
    );
    err.status = 400;
    throw err;
  }

  if (DAILY_PERIODS.includes(period)) {
    if (
      dailyTarget === undefined ||
      dailyTarget === null ||
      dailyTarget === "" ||
      isNaN(Number(dailyTarget)) ||
      Number(dailyTarget) <= 0
    ) {
      const err = new Error("Daily goals need a dailyTarget greater than 0.");
      err.status = 400;
      throw err;
    }
  }
};

const resolveCardioGoalUnit = (period, requestedUnit) =>
  DAILY_PERIODS.includes(period) ? "days" : requestedUnit;

const buildGoalStatus = (current, target, direction) =>
  direction === "loss"
    ? Number(current) <= Number(target)
      ? "Completed"
      : "In Progress"
    : Number(current) >= Number(target)
    ? "Completed"
    : "In Progress";

const deriveWeightDirection = (startingValue, target) =>
  Number(startingValue) > Number(target) ? "loss" : "gain";

const ALLOWED_GOAL_UPDATE_FIELDS = [
  "title",
  "type",
  "target",
  "unit",
  "exercise",
  "deadline",
  "activityType",
  "metric",
  "period",
  "dailyTarget",
  "current",
];

exports.createGoal = async (req, res) => {
  try {
    const {
      title,
      type,
      target,
      unit,
      exercise,
      deadline,
      activityType,
      metric,
      period,
      dailyTarget,
    } = req.body;

    if (!title || !type || target === undefined || target === null || !unit) {
      return res.status(400).json({ message: "All required fields must be provided" });
    }

    if (!Number.isFinite(Number(target)) || Number(target) <= 0) {
      return res.status(400).json({ message: "Target must be a positive number" });
    }

    if (deadline && Number.isNaN(new Date(deadline).getTime())) {
      return res.status(400).json({ message: "Deadline is not a valid date" });
    }

    let exerciseDoc = null;

    if (type === GOAL_TYPES.STRENGTH_PR) {
      if (!exercise) {
        return res.status(400).json({ message: "Please select an exercise for a Strength PR goal" });
      }
      exerciseDoc = await Exercise.findOne({ _id: exercise, createdBy: req.user._id });
      if (!exerciseDoc) {
        return res.status(400).json({ message: "Selected exercise was not found" });
      }
    }

    let current = 0;
    let goalActivityType = null;
    let goalMetric = null;
    let goalPeriod = null;
    let goalDailyTarget = null;
    let resolvedTarget = target;
    let resolvedUnit = unit;

    if (type === GOAL_TYPES.STRENGTH_PR && exerciseDoc) {
      const workouts = await Workout.find({ user: req.user._id, exercise: exerciseDoc._id }).select("workoutSets");
      current = metrics.getMaxWeight(workouts);
    } else if (type === GOAL_TYPES.WEEKLY_WORKOUT_SESSIONS) {
      const weekWorkouts = await Workout.find({
        user: req.user._id,
        date: { $gte: metrics.startOfWeek() },
      }).select("sessionId");
      current = metrics.countDistinctSessions(weekWorkouts);
    } else if (type === GOAL_TYPES.MONTHLY_WORKOUT_SESSIONS) {
      const monthWorkouts = await Workout.find({
        user: req.user._id,
        date: { $gte: metrics.startOfMonth() },
      }).select("sessionId");
      current = metrics.countDistinctSessions(monthWorkouts);
    } else if (type === GOAL_TYPES.WEEKLY_VOLUME) {
      const weekWorkouts = await Workout.find({
        user: req.user._id,
        date: { $gte: metrics.startOfWeek() },
      }).select("workoutSets");
      current = metrics.sumVolume(weekWorkouts);
    } else if (type === GOAL_TYPES.MONTHLY_VOLUME) {
      const monthWorkouts = await Workout.find({
        user: req.user._id,
        date: { $gte: metrics.startOfMonth() },
      }).select("workoutSets");
      current = metrics.sumVolume(monthWorkouts);
    } else if (
      type === GOAL_TYPES.SESSION_EXERCISE ||
      type === GOAL_TYPES.SESSION_VOLUME ||
      type === GOAL_TYPES.SESSION_DURATION
    ) {
      const sessionWorkouts = await getLatestSessionWorkouts(req.user._id);

      if (type === GOAL_TYPES.SESSION_EXERCISE) {
        current = metrics.getSessionExerciseCount(sessionWorkouts);
      } else if (type === GOAL_TYPES.SESSION_VOLUME) {
        current = metrics.sumVolume(sessionWorkouts);
      } else {
        current = sessionWorkouts[0]?.sessionDuration ?? 0;
      }
    } else if (type === GOAL_TYPES.CURRENT_STREAK) {
      const allWorkouts = await Workout.find({ user: req.user._id }).select("date createdAt");
      current = metrics.computeCurrentStreak(allWorkouts);
    } else if (type === GOAL_TYPES.CARDIO) {
      const hasAnyCardioConfig =
        activityType !== undefined || metric !== undefined || period !== undefined;

      if (hasAnyCardioConfig) {
        validateCardioGoalConfig({ activityType, metric, period, dailyTarget });
        goalActivityType = activityType;
        goalMetric = metric;
        goalPeriod = period;
        goalDailyTarget = DAILY_PERIODS.includes(period) ? Number(dailyTarget) : null;

        const autoDays = getAutoDailyTargetDays(period);
        if (autoDays !== null) resolvedTarget = autoDays;
        resolvedUnit = resolveCardioGoalUnit(period, unit);

        current = await computeCardioGoalCurrent(req.user._id, {
          activityType,
          metric,
          period,
          dailyTarget: goalDailyTarget,
        });
      } else {
        current =
          req.body.current !== undefined && req.body.current !== null && req.body.current !== ""
            ? Number(req.body.current)
            : 0;
      }
    } else if (MANUAL_GOAL_TYPES.includes(type)) {
      current =
        req.body.current !== undefined && req.body.current !== null && req.body.current !== ""
          ? Number(req.body.current)
          : 0;
    }

    let direction = null;
    let startingValue = null;
    if (type === GOAL_TYPES.WEIGHT) {
      startingValue = current;
      direction = deriveWeightDirection(startingValue, resolvedTarget);
    }

    const status = buildGoalStatus(current, resolvedTarget, direction);

    const goal = await Goal.create({
      user: req.user._id,
      title: title.trim(),
      type,
      target: Number(resolvedTarget),
      current,
      unit: String(resolvedUnit).trim(),
      exercise: type === GOAL_TYPES.STRENGTH_PR ? exerciseDoc._id : null,
      activityType: goalActivityType,
      metric: goalMetric,
      period: goalPeriod,
      dailyTarget: goalDailyTarget,
      deadline: deadline || null,
      direction,
      startingValue,
      status,
    });

    const populatedGoal = await goal.populate("exercise", "name muscleGroup");
    res.status(201).json(populatedGoal);
  } catch (error) {
    console.log(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create goal. Please try again.",
    });
  }
};

exports.getGoals = async (req, res) => {
  try {
    const goals = await Goal.find({ user: req.user._id })
      .populate("exercise", "name muscleGroup")
      .sort({ createdAt: -1 });
    res.status(200).json(goals);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to load goals." });
  }
};

exports.updateGoal = async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).json({ message: "Goal not found" });
    if (goal.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: "Goal not found" });
    }

    const updates = {};
    ALLOWED_GOAL_UPDATE_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const willBeStrengthPR =
      updates.type === GOAL_TYPES.STRENGTH_PR ||
      (updates.type === undefined && goal.type === GOAL_TYPES.STRENGTH_PR);

    if (willBeStrengthPR) {
      const exerciseId = updates.exercise !== undefined ? updates.exercise : goal.exercise;
      if (!exerciseId) {
        return res.status(400).json({ message: "Please select an exercise for a Strength PR goal" });
      }
      const exerciseDoc = await Exercise.findOne({ _id: exerciseId, createdBy: req.user._id });
      if (!exerciseDoc) {
        return res.status(400).json({ message: "Selected exercise was not found" });
      }
      updates.exercise = exerciseDoc._id;
    }

    const willBeCardio =
      updates.type === GOAL_TYPES.CARDIO ||
      (updates.type === undefined && goal.type === GOAL_TYPES.CARDIO);

    if (willBeCardio) {
      const mergedActivityType =
        updates.activityType !== undefined ? updates.activityType : goal.activityType;
      const mergedMetric =
        updates.metric !== undefined ? updates.metric : goal.metric;
      const mergedPeriod =
        updates.period !== undefined ? updates.period : goal.period;
      const mergedDailyTarget =
        updates.dailyTarget !== undefined ? updates.dailyTarget : goal.dailyTarget;

      const hasAnyCardioConfig =
        mergedActivityType !== null || mergedMetric !== null || mergedPeriod !== null;

      if (hasAnyCardioConfig) {
        validateCardioGoalConfig({
          activityType: mergedActivityType,
          metric: mergedMetric,
          period: mergedPeriod,
          dailyTarget: mergedDailyTarget,
        });

        updates.activityType = mergedActivityType;
        updates.metric = mergedMetric;
        updates.period = mergedPeriod;
        updates.dailyTarget = DAILY_PERIODS.includes(mergedPeriod)
          ? Number(mergedDailyTarget)
          : null;

        const autoDays = getAutoDailyTargetDays(mergedPeriod);
        if (autoDays !== null) updates.target = autoDays;
        if (updates.unit !== undefined || DAILY_PERIODS.includes(mergedPeriod)) {
          updates.unit = resolveCardioGoalUnit(mergedPeriod, updates.unit ?? goal.unit);
        }

        const configChanged =
          mergedActivityType !== goal.activityType ||
          mergedMetric !== goal.metric ||
          mergedPeriod !== goal.period ||
          Number(mergedDailyTarget) !== Number(goal.dailyTarget);

        if (configChanged) {
          updates.current = await computeCardioGoalCurrent(req.user._id, {
            activityType: mergedActivityType,
            metric: mergedMetric,
            period: mergedPeriod,
            dailyTarget: updates.dailyTarget,
            createdAt: goal.createdAt,
          });
        }
      }
    }

    const mergedCurrent = updates.current !== undefined ? Number(updates.current) : goal.current;
    const mergedTarget = updates.target !== undefined ? Number(updates.target) : goal.target;

    if (!Number.isFinite(mergedTarget) || mergedTarget <= 0) {
      return res.status(400).json({ message: "Target must be a positive number" });
    }
    if (!Number.isFinite(mergedCurrent) || mergedCurrent < 0) {
      return res.status(400).json({ message: "Current progress must be a non-negative number" });
    }
    if (updates.deadline && Number.isNaN(new Date(updates.deadline).getTime())) {
      return res.status(400).json({ message: "Deadline is not a valid date" });
    }

    const willBeWeight =
      updates.type === GOAL_TYPES.WEIGHT ||
      (updates.type === undefined && goal.type === GOAL_TYPES.WEIGHT);

    if (willBeWeight) {
      const becomingWeight = updates.type === GOAL_TYPES.WEIGHT && goal.type !== GOAL_TYPES.WEIGHT;
      const needsBaseline = becomingWeight || goal.startingValue === null || goal.startingValue === undefined;

      if (needsBaseline) updates.startingValue = mergedCurrent;
      if (needsBaseline || updates.target !== undefined) {
        const baseline = needsBaseline ? mergedCurrent : goal.startingValue;
        updates.direction = deriveWeightDirection(baseline, mergedTarget);
      }
    } else if (updates.type !== undefined && goal.type === GOAL_TYPES.WEIGHT) {
      updates.direction = null;
      updates.startingValue = null;
    }

    const mergedDirection = updates.direction !== undefined ? updates.direction : goal.direction;
    updates.status = buildGoalStatus(mergedCurrent, mergedTarget, mergedDirection);

    const updatedGoal = await Goal.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate("exercise", "name muscleGroup");

    try {
      const payloads = detectGoalNotificationPayloads(goal, mergedCurrent, mergedTarget);
      if (payloads.length) await createNotificationsIfNew(req.user._id, payloads);
    } catch (notificationError) {
      console.error("Notification generation failed:", notificationError);
    }

    res.status(200).json(updatedGoal);
  } catch (error) {
    console.log(error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to update goal. Please try again.",
    });
  }
};

exports.deleteGoal = async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).json({ message: "Goal not found" });
    if (goal.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: "Goal not found" });
    }
    await Goal.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Goal deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Failed to delete goal. Please try again." });
  }
};