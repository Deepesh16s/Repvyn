import { describe, it, expect } from "vitest";
import {
  computeRestAwareStreak,
  computeLongestRestAwareStreak,
  trainedDayKeys,
} from "../../src/utils/activityStates";
import cases from "../fixtures/restAwareStreakCases.json";

const localNoon = (isoDate) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

describe("rest-aware streak", () => {
  it.each(cases.map((c) => [c.name, c]))("current streak: %s", (_name, scenario) => {
    const streak = computeRestAwareStreak(new Set(scenario.trained), { now: localNoon(scenario.now) });
    expect(streak).toBe(scenario.current);
  });

  it.each(cases.map((c) => [c.name, c]))("longest streak: %s", (_name, scenario) => {
    const longest = computeLongestRestAwareStreak(new Set(scenario.trained), { now: localNoon(scenario.now) });
    expect(longest).toBe(scenario.longest);
  });

  it("grows while rest days last, holds through an unfinished day, and only ends once a day is confirmed missed", () => {
    const trained = new Set(["2026-09-14", "2026-09-21"]);
    expect(computeRestAwareStreak(trained, { now: localNoon("2026-09-23") })).toBe(3);
    expect(computeRestAwareStreak(trained, { now: localNoon("2026-09-24") })).toBe(4);
    expect(computeRestAwareStreak(trained, { now: localNoon("2026-09-25") })).toBe(4);
    expect(computeRestAwareStreak(trained, { now: localNoon("2026-09-26") })).toBe(0);
  });

  it("builds trained day keys from workouts using their date, falling back to createdAt", () => {
    const keys = trainedDayKeys([
      { date: new Date(2026, 8, 21, 9, 30) },
      { date: new Date(2026, 8, 21, 18, 0) },
      { createdAt: new Date(2026, 8, 22, 7, 0) },
    ]);
    expect([...keys].sort()).toEqual(["2026-09-21", "2026-09-22"]);
    expect(trainedDayKeys(undefined).size).toBe(0);
  });
});
