const { computeRestAwareStreak, dayKeyAt, parseTzOffset } = require("../../utils/restAwareStreak");
const { computeCurrentStreak } = require("../../utils/goalMetrics");
const cases = require("../../../client/tests/fixtures/restAwareStreakCases.json");

describe("rest-aware streak matches the shared scenarios used by the client", () => {
  it.each(cases.map((c) => [c.name, c]))("%s", (_name, scenario) => {
    expect(computeRestAwareStreak(new Set(scenario.trained), scenario.now)).toBe(scenario.current);
  });
});

describe("computeCurrentStreak (goals, dashboard, public profile)", () => {
  it("returns 0 for an account with no workouts", () => {
    expect(computeCurrentStreak([])).toBe(0);
  });

  it("counts rest days inside the run and does not read 0 before today's first workout", () => {
    const workouts = [{ date: "2026-09-21T10:00:00Z" }, { date: "2026-09-22T10:00:00Z" }];
    expect(computeCurrentStreak(workouts, { now: new Date("2026-09-23T06:00:00Z") })).toBe(3);
  });

  it("falls back to createdAt when a workout has no date", () => {
    const workouts = [{ createdAt: "2026-09-22T10:00:00Z" }];
    expect(computeCurrentStreak(workouts, { now: new Date("2026-09-22T18:00:00Z") })).toBe(1);
  });

  it("uses the caller's time zone to decide which day a workout, and today, fall on", () => {
    const workouts = [{ date: "2026-09-22T20:00:00Z" }];
    const now = new Date("2026-09-23T04:00:00Z");
    expect(computeCurrentStreak(workouts, { now, tzOffsetMinutes: -330 })).toBe(1);
    expect(computeCurrentStreak(workouts, { now, tzOffsetMinutes: 0 })).toBe(2);
  });
});

describe("day keys and time zone parsing", () => {
  it("shifts a timestamp into the requested local day", () => {
    expect(dayKeyAt("2026-09-22T20:00:00Z", 0)).toBe("2026-09-22");
    expect(dayKeyAt("2026-09-22T20:00:00Z", -330)).toBe("2026-09-23");
    expect(dayKeyAt("2026-09-23T03:00:00Z", 480)).toBe("2026-09-22");
  });

  it.each([
    ["-330", -330],
    ["300", 300],
    ["330.7", 330],
    [undefined, 0],
    ["abc", 0],
    ["99999", 0],
    [["1", "2"], 0],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseTzOffset(raw)).toBe(expected);
  });
});
