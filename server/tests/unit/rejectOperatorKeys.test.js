const { hasOperatorKey } = require("../../middleware/rejectOperatorKeys");

describe("hasOperatorKey", () => {
  it("allows ordinary payloads, including nested arrays of objects", () => {
    expect(hasOperatorKey({ name: "A", sets: [{ weight: 50, reps: 5 }], cardio: { data: { distance: 3 } } })).toBe(false);
  });

  it("allows missing bodies and primitives", () => {
    expect(hasOperatorKey(undefined)).toBe(false);
    expect(hasOperatorKey(null)).toBe(false);
    expect(hasOperatorKey("text")).toBe(false);
  });

  it("flags a top-level operator key", () => {
    expect(hasOperatorKey({ email: { $gt: "" } })).toBe(true);
  });

  it("flags an operator key nested inside arrays and objects", () => {
    expect(hasOperatorKey({ a: [{ b: { c: { $ne: null } } }] })).toBe(true);
  });

  it("does not flag a dollar sign that is not at the start of a key", () => {
    expect(hasOperatorKey({ price$: 1, "a$b": 2 })).toBe(false);
  });

  it("handles very deep nesting without overflowing the stack", () => {
    let deep = {};
    const root = deep;
    for (let i = 0; i < 50000; i++) {
      deep.n = {};
      deep = deep.n;
    }
    expect(hasOperatorKey(root)).toBe(false);
  });

  it("treats an absurdly large structure as malformed", () => {
    expect(hasOperatorKey(new Array(150000).fill({}))).toBe(true);
  });
});
