const REST_ALLOWANCE_PER_WEEK = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

const TRAINED = "trained";
const REST = "rest";
const MISSED = "missed";

function dayNumberOf(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function weekStartOf(dayNumber) {
  const weekday = (new Date(dayNumber * DAY_MS).getUTCDay() + 6) % 7;
  return dayNumber - weekday;
}

function dayKeyAt(value, tzOffsetMinutes = 0) {
  return new Date(new Date(value).getTime() - tzOffsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

function parseTzOffset(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= MAX_TZ_OFFSET_MINUTES ? Math.trunc(value) : 0;
}

function classifyDays(trainedKeys, todayKey) {
  const today = dayNumberOf(todayKey);
  const trained = new Set();
  let first = Infinity;
  for (const key of trainedKeys) {
    const day = dayNumberOf(key);
    if (day > today) continue;
    trained.add(day);
    if (day < first) first = day;
  }
  if (trained.size === 0) return [];

  const trainedWeeks = new Set();
  for (const day of trained) trainedWeeks.add(weekStartOf(day));

  const untrainedSoFar = new Map();
  const states = [];
  for (let day = first; day <= today; day += 1) {
    if (trained.has(day)) {
      states.push(TRAINED);
      continue;
    }
    const week = weekStartOf(day);
    const position = untrainedSoFar.get(week) || 0;
    untrainedSoFar.set(week, position + 1);
    states.push(trainedWeeks.has(week) && position < REST_ALLOWANCE_PER_WEEK ? REST : MISSED);
  }
  return states;
}

function computeRestAwareStreak(trainedKeys, todayKey) {
  const states = classifyDays(trainedKeys, todayKey);
  if (states.length === 0) return 0;

  let index = states.length - 1;
  if (states[index] === MISSED) index -= 1;

  let streak = 0;
  for (; index >= 0 && states[index] !== MISSED; index -= 1) streak += 1;
  return streak;
}

module.exports = { computeRestAwareStreak, dayKeyAt, parseTzOffset };
