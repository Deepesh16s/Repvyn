
const { GOAL_PERIODS, CARDIO_SESSION_METRIC } = require("../constants/goalTypes");
const { computeRestAwareStreak, dayKeyAt } = require("./restAwareStreak");

const startOfWeek = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMon);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonth = (date = new Date()) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getWorkoutVolume = (workout) =>
  (workout.workoutSets || []).reduce((sum, s) => sum + s.reps * s.weight, 0);

const sumVolume = (workouts) =>
  workouts.reduce((sum, w) => sum + getWorkoutVolume(w), 0);

const getMaxWeight = (workouts) =>
  workouts.reduce((max, w) => {
    const heaviest = (w.workoutSets || []).reduce(
      (m, s) => (Number(s.weight) > m ? Number(s.weight) : m),
      0
    );
    return heaviest > max ? heaviest : max;
  }, 0);

const getWorkoutTimestamp = (workout) =>
  new Date(workout.date || workout.createdAt).getTime();

const toDateKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dateKeyToDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const filterSince = (workouts, sinceDate) => {
  const cutoff = sinceDate.getTime();
  return workouts.filter((w) => getWorkoutTimestamp(w) >= cutoff);
};

const hasSessionId = (w) =>
  w.sessionId !== undefined && w.sessionId !== null && w.sessionId !== "";

const groupBySessionId = (workouts) => {
  const map = new Map();
  workouts.forEach((w) => {
    if (!hasSessionId(w)) return;
    if (!map.has(w.sessionId)) map.set(w.sessionId, []);
    map.get(w.sessionId).push(w);
  });
  return map;
};

const countDistinctSessions = (workouts) => groupBySessionId(workouts).size;

const getSessionTimestamp = (sessionWorkouts) =>
  Math.max(...sessionWorkouts.map(getWorkoutTimestamp));

const getLatestSessionWorkouts = (workouts) => {
  const sessions = groupBySessionId(workouts);
  if (sessions.size === 0) return [];

  let latestId = null;
  let latestTs = -Infinity;

  for (const [sessionId, sessionWorkouts] of sessions) {
    const ts = getSessionTimestamp(sessionWorkouts);
    if (ts > latestTs) {
      latestTs = ts;
      latestId = sessionId;
    }
  }

  return sessions.get(latestId);
};

const getSessionExerciseCount = (sessionWorkouts) =>
  sessionWorkouts.filter((w) => w.entryType !== "cardio").length;

const getLatestSessionMetrics = (workouts) => {
  const sessionWorkouts = getLatestSessionWorkouts(workouts);
  return {
    exerciseCount: getSessionExerciseCount(sessionWorkouts),
    volume: sumVolume(sessionWorkouts),
    duration: sessionWorkouts[0]?.sessionDuration ?? 0,
  };
};

const getAverageVolumeOfRecentSessions = (workouts, count = 5) => {
  const sessions = groupBySessionId(workouts);
  if (sessions.size === 0) return 0;

  const sortedGroups = Array.from(sessions.values()).sort(
    (a, b) => getSessionTimestamp(b) - getSessionTimestamp(a)
  );

  const recentGroups = sortedGroups.slice(0, count);
  const total = recentGroups.reduce(
    (sum, sessionWorkouts) => sum + sumVolume(sessionWorkouts),
    0
  );

  return total / recentGroups.length;
};

const getAverageSessionDurationOfRecentSessions = (workouts, count = 5) => {
  const sessions = groupBySessionId(workouts);
  if (sessions.size === 0) return null;

  const sortedGroups = Array.from(sessions.values()).sort(
    (a, b) => getSessionTimestamp(b) - getSessionTimestamp(a)
  );

  const recentGroups = sortedGroups.slice(0, count);

  const durations = recentGroups
    .map((sessionWorkouts) =>
      sessionWorkouts.find(
        (w) => w.sessionDuration !== undefined && w.sessionDuration !== null
      )
    )
    .filter((w) => w !== undefined)
    .map((w) => Number(w.sessionDuration))
    .filter((d) => !Number.isNaN(d));

  if (durations.length === 0) return null;

  const total = durations.reduce((sum, d) => sum + d, 0);
  return total / durations.length;
};

const computeCurrentStreak = (workouts, { now = new Date(), tzOffsetMinutes = 0 } = {}) => {
  if (!workouts.length) return 0;

  const trainedKeys = new Set(workouts.map((w) => dayKeyAt(w.date || w.createdAt, tzOffsetMinutes)));
  return computeRestAwareStreak(trainedKeys, dayKeyAt(now, tzOffsetMinutes));
};

const buildDailyCardioValueMap = (matchingCardio, metric) => {
  const map = new Map();
  matchingCardio.forEach((w) => {
    const key = toDateKey(w.date || w.createdAt);
    const value = metric === CARDIO_SESSION_METRIC ? 1 : Number(w.cardio?.data?.[metric]) || 0;
    map.set(key, (map.get(key) || 0) + value);
  });
  return map;
};

const mergeDailyStepsLog = (dayValueMap, dailyStepsRecords) => {
  dailyStepsRecords.forEach(({ date, steps }) => {
    if (!date) return;
    dayValueMap.set(date, (dayValueMap.get(date) || 0) + (Number(steps) || 0));
  });
  return dayValueMap;
};

const computeDailyConsistencyCount = (dayValueMap, dailyTarget, sinceDate, now = new Date()) => {
  let count = 0;
  const cursor = new Date(sinceDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    if ((dayValueMap.get(toDateKey(cursor)) || 0) >= dailyTarget) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

const computeBestDailyStreak = (dayValueMap, dailyTarget) => {
  const qualifyingDayKeys = [...dayValueMap.entries()]
    .filter(([, value]) => value >= dailyTarget)
    .map(([key]) => key)
    .sort();

  if (!qualifyingDayKeys.length) return 0;

  let best = 1;
  let current = 1;
  for (let i = 1; i < qualifyingDayKeys.length; i++) {
    const diffDays = Math.round(
      (dateKeyToDate(qualifyingDayKeys[i]) - dateKeyToDate(qualifyingDayKeys[i - 1])) /
        (24 * 60 * 60 * 1000)
    );
    current = diffDays === 1 ? current + 1 : 1;
    if (current > best) best = current;
  }
  return best;
};

const computeNextSessionMetric = (workouts, { activityType, metric, createdAt }) => {
  const cutoff = createdAt ? new Date(createdAt).getTime() : Infinity;

  const matching = workouts
    .filter((w) => w.entryType === "cardio" && w.cardio?.activityType === activityType)
    .filter((w) => getWorkoutTimestamp(w) > cutoff)
    .sort((a, b) => getWorkoutTimestamp(a) - getWorkoutTimestamp(b));

  if (!matching.length) return 0;
  if (metric === CARDIO_SESSION_METRIC) return 1;
  return Number(matching[0].cardio?.data?.[metric]) || 0;
};

const computeCardioGoalMetric = (
  workouts,
  { activityType, metric, period, dailyTarget = null, createdAt = null, dailyStepsRecords = [] }
) => {
  const matchingCardio = workouts.filter(
    (w) => w.entryType === "cardio" && w.cardio?.activityType === activityType
  );

  if (period === GOAL_PERIODS.NEXT_SESSION) {
    return computeNextSessionMetric(workouts, { activityType, metric, createdAt });
  }

  if (
    period === GOAL_PERIODS.DAILY_WEEKLY ||
    period === GOAL_PERIODS.DAILY_MONTHLY ||
    period === GOAL_PERIODS.DAILY_LIFETIME
  ) {
    const dayValueMap = buildDailyCardioValueMap(matchingCardio, metric);
    if (metric === "steps") mergeDailyStepsLog(dayValueMap, dailyStepsRecords);

    const target = Number(dailyTarget) || 0;

    if (period === GOAL_PERIODS.DAILY_LIFETIME) {
      return computeBestDailyStreak(dayValueMap, target);
    }

    const since = period === GOAL_PERIODS.DAILY_MONTHLY ? startOfMonth() : startOfWeek();
    return computeDailyConsistencyCount(dayValueMap, target, since);
  }

  if (period === GOAL_PERIODS.MILESTONE) {
    if (metric === CARDIO_SESSION_METRIC) {
      return countDistinctSessions(matchingCardio);
    }
    return matchingCardio.reduce(
      (max, w) => Math.max(max, Number(w.cardio?.data?.[metric]) || 0),
      0
    );
  }

  const since = period === GOAL_PERIODS.MONTHLY ? startOfMonth() : startOfWeek();
  const periodWorkouts = filterSince(matchingCardio, since);

  if (metric === CARDIO_SESSION_METRIC) {
    return countDistinctSessions(periodWorkouts);
  }

  return periodWorkouts.reduce(
    (sum, w) => sum + (Number(w.cardio?.data?.[metric]) || 0),
    0
  );
};

module.exports = {
  startOfWeek,
  startOfMonth,
  getWorkoutVolume,
  sumVolume,
  getMaxWeight,
  filterSince,
  groupBySessionId,
  countDistinctSessions,
  getSessionTimestamp,
  getLatestSessionWorkouts,
  getSessionExerciseCount,
  getLatestSessionMetrics,
  getAverageVolumeOfRecentSessions,
  getAverageSessionDurationOfRecentSessions,
  computeCurrentStreak,
  computeCardioGoalMetric,
  toDateKey,
};