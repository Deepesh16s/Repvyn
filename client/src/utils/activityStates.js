import { dateKey } from "./dateUtils";

export const REST_ALLOWANCE_PER_WEEK = 3;

export const ACTIVITY_STATE = {
  TRAINED: "trained",
  REST: "rest",
  MISSED: "missed",
  BLANK: "blank",
};

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKeyOf(value) {
  const d = startOfDay(value);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

export function classifyActivityDays(days, { now = new Date() } = {}) {
  const states = new Map();
  if (!days?.length) return states;

  const today = startOfDay(now).getTime();
  const firstTrained = days.find((d) => d.trained);
  const firstTrainedTime = firstTrained ? startOfDay(firstTrained.date).getTime() : null;

  const trainedWeeks = new Set();
  days.forEach((day) => {
    if (day.trained) trainedWeeks.add(weekKeyOf(day.date));
  });

  const pendingByWeek = new Map();

  days.forEach((day) => {
    if (day.trained) {
      states.set(day.key, ACTIVITY_STATE.TRAINED);
      return;
    }

    const time = startOfDay(day.date).getTime();
    if (firstTrainedTime === null || time < firstTrainedTime || time > today) {
      states.set(day.key, ACTIVITY_STATE.BLANK);
      return;
    }

    const wk = weekKeyOf(day.date);
    if (!pendingByWeek.has(wk)) pendingByWeek.set(wk, []);
    pendingByWeek.get(wk).push(day);
  });

  pendingByWeek.forEach((untrained, wk) => {
    const allowance = trainedWeeks.has(wk) ? REST_ALLOWANCE_PER_WEEK : 0;
    untrained
      .slice()
      .sort((a, b) => startOfDay(a.date).getTime() - startOfDay(b.date).getTime())
      .forEach((day, index) => {
        states.set(day.key, index < allowance ? ACTIVITY_STATE.REST : ACTIVITY_STATE.MISSED);
      });
  });

  return states;
}

export function summarizeActivity(states) {
  let trained = 0;
  let rest = 0;
  let missed = 0;
  states.forEach((state) => {
    if (state === ACTIVITY_STATE.TRAINED) trained += 1;
    else if (state === ACTIVITY_STATE.REST) rest += 1;
    else if (state === ACTIVITY_STATE.MISSED) missed += 1;
  });
  return { trained, rest, missed, tracked: trained + rest + missed };
}

const STREAK_STATES = new Set([ACTIVITY_STATE.TRAINED, ACTIVITY_STATE.REST]);

export function trainedDayKeys(workouts) {
  return new Set((workouts || []).map((w) => dateKey(w.date || w.createdAt)));
}

function daysFromFirstTrained(trainedKeys, now) {
  if (!trainedKeys?.size) return [];
  const [year, month, day] = [...trainedKeys].sort()[0].split("-").map(Number);
  const end = startOfDay(now);
  const days = [];
  for (const cursor = new Date(year, month - 1, day); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    days.push({ key, date: new Date(cursor), trained: trainedKeys.has(key) });
  }
  return days;
}

export function computeRestAwareStreak(trainedKeys, { now = new Date() } = {}) {
  const days = daysFromFirstTrained(trainedKeys, now);
  if (!days.length) return 0;

  const states = classifyActivityDays(days, { now });
  let index = days.length - 1;
  if (states.get(days[index].key) === ACTIVITY_STATE.MISSED) index -= 1;

  let streak = 0;
  for (; index >= 0 && STREAK_STATES.has(states.get(days[index].key)); index -= 1) streak += 1;
  return streak;
}

export function computeLongestRestAwareStreak(trainedKeys, { now = new Date() } = {}) {
  const days = daysFromFirstTrained(trainedKeys, now);
  if (!days.length) return 0;

  const states = classifyActivityDays(days, { now });
  const lastIndex = states.get(days[days.length - 1].key) === ACTIVITY_STATE.MISSED ? days.length - 2 : days.length - 1;

  let longest = 0;
  let run = 0;
  for (let i = 0; i <= lastIndex; i += 1) {
    run = STREAK_STATES.has(states.get(days[i].key)) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}
