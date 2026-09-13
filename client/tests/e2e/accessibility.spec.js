import { test, expect } from "@playwright/test";

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    name: "A11y E2E User",
    email: `a11y${id}@test.local`,
    username: `a11y${id}`.slice(0, 20),
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

test("registration -> login -> dashboard", async ({ page }) => {
  user = uniqueUser();
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  authToken = await page.evaluate(() => localStorage.getItem("token"));
  expect(authToken).toBeTruthy();
});

test("a login error is exposed to assistive tech via role=alert", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@test.local");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText(/failed|invalid/i);
});

test("the Add Exercise modal is a real dialog and traps Tab focus inside itself", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "New Workout" }).click();
  await page.getByRole("button", { name: "Start Session" }).click();
  await page.getByRole("main").getByRole("button", { name: "Add Exercise", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add Exercise" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const isInsideDialog = () =>
    page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"][aria-modal="true"]');
      return !!dialogEl && dialogEl.contains(document.activeElement);
    });

  expect(await isInsideDialog()).toBe(true);

  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await isInsideDialog()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
