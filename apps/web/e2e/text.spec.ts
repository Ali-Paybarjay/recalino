import { expect, test } from "@playwright/test";

// FR-PLT-011: mixed and right-to-left text in the English, left-to-right UI.

test('"The word "apple" یعنی سیب." keeps its order and the full stop at the end', async ({
  page,
}) => {
  await page.goto("/dev/ui");
  const persianRun = page.getByTestId("mixed").locator("bdi");
  const fullStop = page.getByTestId("mixed-end");
  const run = await persianRun.boundingBox();
  const stop = await fullStop.boundingBox();
  if (!run || !stop) throw new Error("mixed sentence not rendered");
  // Left-to-right paragraph: the isolated Persian run comes after "apple", the stop after it.
  expect(stop.x).toBeGreaterThanOrEqual(run.x + run.width - 1);
  await expect(page.getByTestId("mixed").locator("..")).toHaveAttribute("dir", "ltr");
});

test("a Persian block is right-to-left and right-aligned, even when it starts with English", async ({
  page,
}) => {
  await page.goto("/dev/ui");
  const text = page.getByTestId("persian");
  const block = text.locator("..");
  await expect(block).toHaveAttribute("lang", "fa");
  await expect(block).toHaveAttribute("dir", "rtl");
  await expect(block).toHaveCSS("direction", "rtl");
  // Each line ends at the block's right edge. A line holds several boxes (the English word is its
  // own run), so compare the rightmost box of each line.
  const gap = await text.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const lineRight = new Map<number, number>();
    for (const box of range.getClientRects()) {
      const line = Math.round(box.top);
      lineRight.set(line, Math.max(lineRight.get(line) ?? 0, box.right));
    }
    const blockRight = node.parentElement?.getBoundingClientRect().right ?? 0;
    return Math.max(...[...lineRight.values()].map((right) => Math.abs(blockRight - right)));
  });
  expect(gap).toBeLessThan(2);
});

test("every script block declares its language", async ({ page }) => {
  await page.goto("/dev/ui");
  for (const lang of ["fa", "ar", "ru", "ja", "zh-Hans"]) {
    await expect(page.locator(`[lang="${lang}"]`).first()).toBeVisible();
  }
  await expect(page.locator('[lang="ar"]').first()).toHaveAttribute("dir", "rtl");
  await expect(page.locator('[lang="ja"]').first()).toHaveAttribute("dir", "ltr");
});
