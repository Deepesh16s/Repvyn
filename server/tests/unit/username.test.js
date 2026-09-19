const { connectTestDB, clearTestDB, disconnectTestDB } = require("../helpers/db");
const { createUser } = require("../helpers/factories");
const {
  normalize,
  validateFormat,
  isAvailable,
  generateBaseUsername,
  resolveCollision,
} = require("../../utils/username");

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe("username.normalize", () => {
  it("lowercases and stringifies", () => {
    expect(normalize("AbC")).toBe("abc");
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });

  it("does not strip spaces or punctuation", () => {
    expect(normalize("a b c")).toBe("a b c");
    expect(normalize("a!b@c")).toBe("a!b@c");
  });

  it("never turns a character outside [A-Za-z0-9_] into a valid username character", () => {
    const offenders = [];
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
      const character = String.fromCodePoint(codePoint);
      if (/^[A-Za-z0-9_]$/.test(character)) continue;
      if (/^[a-z0-9_]+$/.test(normalize(character))) {
        offenders.push(`U+${codePoint.toString(16).toUpperCase()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not fold the Kelvin sign into an ASCII k", () => {
    expect(normalize("Katlas")).not.toBe("katlas");
  });
});

describe("username.validateFormat", () => {
  it("rejects too short", () => {
    expect(validateFormat("ab")).toMatch(/at least/);
  });
  it("rejects too long", () => {
    expect(validateFormat("a".repeat(21))).toMatch(/at most/);
  });
  it("rejects invalid characters", () => {
    expect(validateFormat("bad name!")).toMatch(/can only contain/);
  });
  it("accepts a valid username", () => {
    expect(validateFormat("valid_user123")).toBeNull();
  });
  it("accepts ASCII uppercase, which is lowercased later for lookup", () => {
    expect(validateFormat("Valid_User123")).toBeNull();
  });
  it("validates the raw input, so spaces and punctuation are never dropped to make it valid", () => {
    expect(validateFormat("a b c d e f")).toMatch(/can only contain/);
    expect(validateFormat("a!b@c#d$e%f")).toMatch(/can only contain/);
    expect(validateFormat("abc-def")).toMatch(/can only contain/);
    expect(validateFormat(" abcdef")).toMatch(/can only contain/);
  });
  it("rejects non-ASCII lookalikes that would lowercase into a valid username", () => {
    expect(validateFormat("Katlas")).toMatch(/can only contain/);
  });
  it("rejects non-string input", () => {
    expect(validateFormat(undefined)).toMatch(/required/);
  });
});

describe("username.generateBaseUsername", () => {
  it("derives from the email local part", () => {
    expect(generateBaseUsername("john.doe@example.com", "seed")).toBe("johndoe");
  });
  it("falls back to a seeded name when the local part is too short", () => {
    const base = generateBaseUsername("a@example.com", "abc123");
    expect(base.length).toBeGreaterThanOrEqual(3);
    expect(base).toMatch(/^user/);
  });
  it("strips invalid characters from the local part", () => {
    expect(generateBaseUsername("john+doe.99@example.com", "seed")).toBe("johndoe99");
  });
});

describe("username.isAvailable / resolveCollision (DB-backed)", () => {
  it("reports an unused username as available", async () => {
    expect(await isAvailable("totally_unused_name")).toBe(true);
  });

  it("reports a taken username as unavailable", async () => {
    const user = await createUser({ username: "taken_name" });
    expect(await isAvailable("taken_name")).toBe(false);
    expect(await isAvailable("taken_name", { excludeUserId: user._id })).toBe(true);
  });

  it("resolves a collision by appending a numeric suffix", async () => {
    await createUser({ username: "dupe" });
    const resolved = await resolveCollision("dupe");
    expect(resolved).toBe("dupe1");
  });

  it("chains suffixes when multiple collisions exist", async () => {
    await createUser({ username: "dupe" });
    await createUser({ username: "dupe1" });
    const resolved = await resolveCollision("dupe");
    expect(resolved).toBe("dupe2");
  });
});
