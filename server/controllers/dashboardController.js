const Workout = require("../models/workout");
const {
  groupBySessionId,
  countDistinctSessions,
  getSessionTimestamp,
  getLatestSessionWorkouts,
  getAverageVolumeOfRecentSessions,
  getAverageSessionDurationOfRecentSessions,
  computeCurrentStreak,
  filterSince,
  sumVolume,
} = require("../utils/goalMetrics");
const { parseTzOffset } = require("../utils/restAwareStreak");

const totalSetsCount = (w) => (w.workoutSets || []).length;

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const buildLastSessionPayload = (sessionWorkouts) => {
  if (!sessionWorkouts || sessionWorkouts.length === 0) return null;

  const first = sessionWorkouts[0];
  const exercises = [];
  const cardioActivities = [];
  const muscleGroups = new Set();

  sessionWorkouts.forEach((w) => {
    if (w.entryType === "cardio") {
      cardioActivities.push({
        activityType: w.cardio?.activityType ?? null,
        data: w.cardio?.data ?? {},
      });
    } else if (w.exercise) {
      exercises.push({
        name: w.exercise.name,
        muscleGroup: w.exercise.muscleGroup,
      });
      if (w.exercise.muscleGroup) muscleGroups.add(w.exercise.muscleGroup);
    }
  });

  return {
    sessionType: first.sessionType || null,
    customSessionType: first.customSessionType || null,
    date: first.date,
    sessionDuration: first.sessionDuration ?? null,
    volume: sumVolume(sessionWorkouts),
    exerciseCount: exercises.length,
    cardioCount: cardioActivities.length,
    exercises,
    cardioActivities,
    muscleGroups: Array.from(muscleGroups),
  };
};

exports.getPersonalRecords = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id }).populate(
      "exercise"
    );

    const prs = {};
    workouts.forEach((w) => {
      if (!w.exercise) return;
      const name = w.exercise.name;

      const heaviestSet = (w.workoutSets || []).reduce(
        (max, s) => (s.weight > max ? s.weight : max),
        0
      );

      if (!prs[name] || heaviestSet > prs[name]) prs[name] = heaviestSet;
    });

    res.status(200).json(prs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getCurrentStreak = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id }).select("date createdAt");
    const currentStreak = computeCurrentStreak(workouts, {
      tzOffsetMinutes: parseTzOffset(req.query.tzOffset),
    });
    res.status(200).json({ currentStreak });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getTopMuscle = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id }).populate(
      "exercise"
    );

    const muscleSets = {};
    workouts.forEach((w) => {
      if (!w.exercise) return;
      const muscle = w.exercise.muscleGroup;
      muscleSets[muscle] = (muscleSets[muscle] || 0) + totalSetsCount(w);
    });

    let topMuscle = null;
    let count = 0;
    for (const [muscle, n] of Object.entries(muscleSets)) {
      if (n > count) {
        count = n;
        topMuscle = muscle;
      }
    }

    res.status(200).json({ topMuscle, count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getTopExercise = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id }).populate(
      "exercise"
    );

    const counts = {};
    workouts.forEach((w) => {
      if (!w.exercise) return;
      const name = w.exercise.name;
      counts[name] = (counts[name] || 0) + 1;
    });

    let exercise = null;
    let count = 0;
    for (const [name, n] of Object.entries(counts)) {
      if (n > count) {
        count = n;
        exercise = name;
      }
    }

    res.status(200).json({ exercise, count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getCalendarWorkouts = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id })
      .populate("exercise")
      .sort({ date: -1 });

    res.status(200).json(workouts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};


exports.getSessionSummary = async (req, res) => {
  try {
    const workouts = await Workout.find({ user: req.user._id }).populate(
      "exercise"
    );

    const totalSessions = countDistinctSessions(workouts);

    const sessionsLast7Days = countDistinctSessions(
      filterSince(workouts, daysAgo(7))
    );
    const sessionsLast30Days = countDistinctSessions(
      filterSince(workouts, daysAgo(30))
    );

    const lastSessionWorkouts = getLatestSessionWorkouts(workouts);
    const lastSession = buildLastSessionPayload(lastSessionWorkouts);

    const averageVolumeRecent = getAverageVolumeOfRecentSessions(
      workouts,
      5
    );

    const averageSessionDuration = getAverageSessionDurationOfRecentSessions(
      workouts,
      5
    );

    res.status(200).json({
      totalSessions,
      sessionsLast7Days,
      sessionsLast30Days,
      lastSession,
      lastSessionType: lastSession?.sessionType ?? null,
      averageVolumeRecent,
      averageSessionDuration,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.getRecentSessions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 6;

    const workouts = await Workout.find({ user: req.user._id })
      .populate("exercise")
      .sort({ createdAt: 1 });

    const sessions = groupBySessionId(workouts);

    const topSessionIds = Array.from(sessions.entries())
      .sort((a, b) => getSessionTimestamp(b[1]) - getSessionTimestamp(a[1]))
      .slice(0, limit)
      .map(([sessionId]) => sessionId);

    const idSet = new Set(topSessionIds);
    const limitedWorkouts = workouts.filter(
      (w) => w.sessionId && idSet.has(w.sessionId)
    );

    res.status(200).json(limitedWorkouts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};