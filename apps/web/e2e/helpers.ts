import type { Page } from "@playwright/test";

const SHOTS = process.env.SCREENSHOT_DIR;

/** Screenshot for the documentation, only when SCREENSHOT_DIR is set. */
export const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  // Let drawers and toasts finish their animations first.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

/** Dev sign-in as one of the fictional people (apps/api/src/seed/dev-users.ts). */
export const signInAs = async (page: Page, userId: string) => {
  await page.goto("/");
  await page.evaluate((id) => localStorage.setItem("hh:devUser", id), userId);
};
