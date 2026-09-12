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
