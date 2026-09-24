import { bestSet, estimate1RM, suggestedLoadIncrement } from "../utils/strengthUtils";
import { groupWorkoutsIntoSessions, getSessionStats } from "../utils/workoutUtils";
import { computeRestAwareStreak, computeLongestRestAwareStreak, trainedDayKeys } from "../utils/activityStates";

export function strengthWorkoutsForExercise(historicalWorkouts, exerciseId) {
  if (!exerciseId || !historicalWorkouts?.length) return [];
  return historicalWorkouts
    .filter(
      (w) =>
        w.entryType !== "cardio" &&
        w.exercise &&
        String(w.exercise._id) === String(exerciseId)
    )
    .sort(
      (a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt)
    );
}

export function getExerciseHistorySnapshot(historicalWorkouts, exerciseId) {
  const past = strengthWorkoutsForExercise(historicalWorkouts, exerciseId);
  if (!past.length) return null;

  const allSets = past.flatMap((w) => w.workoutSets || []);
  if (!allSets.length) return null;

  const best = bestSet(allSets);
  const bestSingleSetVolume = allSets.reduce(
    (max, s) => Math.max(max, s.weight * s.reps),
    0
  );

  return {
    lastSession: past[0].workoutSets || [],
    lastSessionDate: past[0].date || past[0].createdAt,
    priorSession: past[1]?.workoutSets || null,
    bestSet: best,
    estOneRM: best ? estimate1RM(best.weight, best.reps) : null,
    bestSingleSetVolume,
    maxRepsAtWeightOrHeavier: (weight) =>
      allSets.reduce((max, s) => (s.weight >= weight ? Math.max(max, s.reps) : max), 0),
  };
}

export function getNextSetSuggestion(snapshot, sessionSetsSoFar = []) {
  if (sessionSetsSoFar.length) {
    const lastInSession = sessionSetsSoFar[sessionSetsSoFar.length - 1];
    const sessionBest = bestSet(sessionSetsSoFar);
    // Requires the performance to have already been repeated at least once
    // this session (2+ sets at/above the session best), not a single set —
    // a single set clearing a threshold isn't distinguishable from ordinary
    // set-to-set variability (1RM test-retest CV is ~4% even under controlled
    // conditions; ordinary training sets carry at least as much noise).
    const priorSets = sessionSetsSoFar.slice(0, -1);
    const priorBestInSession = priorSets.length ? bestSet(priorSets) : null;
    const readyForMoreWeight =
      priorBestInSession &&
      lastInSession.weight >= sessionBest.weight &&
      lastInSession.reps >= 3 &&
      priorBestInSession.weight >= sessionBest.weight &&
      priorBestInSession.reps >= 3;

    if (readyForMoreWeight) {
      return {
        weight: Math.round((lastInSession.weight + suggestedLoadIncrement(lastInSession.weight)) * 2) / 2,
        reps: lastInSession.reps,
        basis: "weight",
      };
    }

    return { weight: lastInSession.weight, reps: lastInSession.reps + 1, basis: "reps" };
  }

  if (!snapshot?.lastSession?.length) return null;

  const lastBest = bestSet(snapshot.lastSession);
  if (!lastBest) return null;

  const priorBest = snapshot.priorSession?.length
    ? bestSet(snapshot.priorSession)
    : null;

  const readyForMoreWeight = priorBest
    ? lastBest.weight === priorBest.weight && lastBest.reps >= priorBest.reps
    : lastBest.reps >= 3;

  if (readyForMoreWeight) {
    return {
      weight: Math.round((lastBest.weight + suggestedLoadIncrement(lastBest.weight)) * 2) / 2,
      reps: lastBest.reps,
      basis: "weight",
    };
  }

  return { weight: lastBest.weight, reps: lastBest.reps + 1, basis: "reps" };
}

export function detectSetPRs(snapshot, newSet, sessionSetsSoFar = []) {
  if (!newSet) return null;

  const sessionBest = bestSet(sessionSetsSoFar);
  const priorBest =
    sessionBest &&
    (!snapshot?.bestSet ||
      sessionBest.weight > snapshot.bestSet.weight ||
      (sessionBest.weight === snapshot.bestSet.weight && sessionBest.reps > snapshot.bestSet.reps))
      ? sessionBest
      : snapshot?.bestSet || null;

  const lifetimePR =
    !priorBest ||
    newSet.weight > priorBest.weight ||
    (newSet.weight === priorBest.weight && newSet.reps > priorBest.reps);

  const historicalMaxReps = snapshot ? snapshot.maxRepsAtWeightOrHeavier(newSet.weight) : 0;
  const sessionMaxReps = sessionSetsSoFar.reduce(
    (max, s) => (s.weight >= newSet.weight ? Math.max(max, s.reps) : max),
    0
  );
  const priorMaxReps = Math.max(historicalMaxReps, sessionMaxReps);
  const repPR = priorMaxReps > 0 && newSet.reps > priorMaxReps;

  const hasVolumeBaseline = !!snapshot || sessionSetsSoFar.length > 0;
  const newVolume = newSet.weight * newSet.reps;
  const historicalBestVolume = snapshot?.bestSingleSetVolume || 0;
  const sessionBestVolume = sessionSetsSoFar.reduce(
    (max, s) => Math.max(max, s.weight * s.reps),
    0
  );
  const volumePR =
    hasVolumeBaseline && newVolume > Math.max(historicalBestVolume, sessionBestVolume);

  if (!lifetimePR && !repPR && !volumePR) return null;

  return {
    lifetimePR,
    repPR,
    volumePR,
    weight: newSet.weight,
    reps: newSet.reps,
    estOneRM: estimate1RM(newSet.weight, newSet.reps),
  };
}

const COMPOUND_NAME_PATTERN = /squat|deadlift|bench|press|row|pull.?up|chin.?up/i;

export function getDefaultRestSeconds(exerciseName = "") {
  return COMPOUND_NAME_PATTERN.test(exerciseName) ? 150 : 75;
}

export function isFastestSession(historicalWorkouts, durationMinutes, setCount) {
  if (!durationMinutes || !setCount || !historicalWorkouts?.length) return false;

  const comparable = groupWorkoutsIntoSessions(historicalWorkouts)
    .map((session) => ({ session, stats: getSessionStats(session) }))
    .filter(
      ({ session, stats }) =>
        session.sessionDuration != null && stats.setCount >= setCount
    );

  if (!comparable.length) return false;

  return durationMinutes < Math.min(...comparable.map(({ session }) => session.sessionDuration));
}

export function getSessionBadges(historicalWorkouts, { durationMinutes, setCount }) {
  const badges = [];

  if (isFastestSession(historicalWorkouts, durationMinutes, setCount)) {
    badges.push({ key: "fastestSession", label: "Fastest Session" });
  }

  const trainedKeys = trainedDayKeys(historicalWorkouts);
  const currentStreak = computeRestAwareStreak(trainedKeys);
  const priorLongestStreak = computeLongestRestAwareStreak(trainedKeys);
  if (currentStreak > 0 && currentStreak >= priorLongestStreak) {
    badges.push({ key: "longestStreak", label: `Longest Streak · Day ${currentStreak}` });
  }

  return badges;
}
