import { test, expect } from "@playwright/test";

test("homepage renders lobby shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dungeon Dice Monsters" })).toBeVisible();
  await expect(page.getByText("Create Room")).toBeVisible();
});
