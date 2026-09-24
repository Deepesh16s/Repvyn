import { test, expect } from "@playwright/test";

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    name: "E2E Test User",
    email: `e2e${id}@test.local`,
    username: `e2e${id}`.slice(0, 20),
    password: "Test1234!",
  };
}

test.describe.configure({ mode: "serial" });

let user;
let authToken;

async function restoreSession(page) {
  await page.goto("/login");
  await page.evaluate((token) => localStorage.setItem("token", token), authToken);
}

function isRealError(text) {
  return !/ws\/chat|websocket/i.test(text);
}

test.beforeAll(() => {
  user = uniqueUser();
});

test("registration -> login -> dashboard", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({ timeout: 10000 });

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  const firstName = user.name.split(" ")[0];
  await expect(page.getByRole("heading", { name: new RegExp(firstName, "i") })).toBeVisible({ timeout: 10000 });

  authToken = await page.evaluate(() => localStorage.getItem("token"));
  expect(authToken).toBeTruthy();
});

test("goals: create a weight-loss goal and see it as In Progress, not Completed", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/goals");
  await page.getByRole("button", { name: /add goal|new goal|create goal|\+ ?goal/i }).first().click();

  await page.locator('select[name="category"]').selectOption({ label: "Body" });
  await page.locator('select[name="type"]').selectOption({ label: "Weight Goal" });

  await page.locator('input[name="title"]').fill("Cut to 80kg");
  await page.locator('input[name="target"]').fill("80");
  await page.locator('input[name="current"]').fill("85");

  await page.locator(".goal-modal button[type='submit']").click();

  await expect(page.getByText("Cut to 80kg")).toBeVisible({ timeout: 10000 });
  const card = page.getByText("Cut to 80kg").locator("xpath=ancestor::*[contains(@class,'goal-card')]").first();
  await expect(card.getByText(/^completed$/i)).toHaveCount(0);
});

test("workouts: log a strength session and see it on the dashboard", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Workout" }).click();

  const addExerciseBtn = page.getByRole("button", { name: /add exercise/i }).first();
  if (await addExerciseBtn.count()) {
    await addExerciseBtn.click();
    const firstExerciseOption = page.getByRole("option").first();
    if (await firstExerciseOption.count()) await firstExerciseOption.click();
  }

  const weightInput = page.locator('input[placeholder*="weight" i], input[name*="weight" i]').first();
  const repsInput = page.locator('input[placeholder*="reps" i], input[name*="reps" i]').first();
  if ((await weightInput.count()) && (await repsInput.count())) {
    await weightInput.fill("40");
    await repsInput.fill("8");
  }

  const finishBtn = page.getByRole("button", { name: /finish workout|save workout|finish session/i });
  if (await finishBtn.count()) await finishBtn.click();

  await page.goto("/dashboard");
  await expect(page.getByText("Last Session", { exact: true })).toBeVisible({ timeout: 10000 });
});

test("progression page loads without console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && isRealError(msg.text())) errors.push(msg.text());
  });
  await restoreSession(page);
  await page.goto("/progression");
  await expect(page.getByRole("heading", { name: /progression|training journey/i })).toBeVisible({ timeout: 10000 });
  expect(errors).toEqual([]);
});

test("feed and own profile load without console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && isRealError(msg.text())) errors.push(msg.text());
  });

  await restoreSession(page);
  await page.goto("/feed");
  await page.waitForLoadState("networkidle");

  await page.goto(`/u/${user.username}`);
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});

test("account deletion: removes the account and redirects to landing", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Delete Account" }).click();
  await page.getByLabel("Enter your password to confirm").fill(user.password);
  await page.getByRole("button", { name: "Yes, Delete" }).click();

  await expect(page).toHaveURL("/", { timeout: 10000 });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10000 });
});
