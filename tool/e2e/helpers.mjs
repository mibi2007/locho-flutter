import { expect } from '@playwright/test';

export async function openApp(page) {
  await page.goto('/');
  await page.locator('flt-semantics-placeholder').waitFor();
  await page.locator('flt-semantics-placeholder').evaluate((element) => element.click());
  await expect(page.getByRole('textbox', { name: 'Attachment ticket', exact: true })).toBeVisible();
}

export async function typeField(page, name, value) {
  const field = page.getByRole('textbox', { name, exact: true });
  await field.click();
  await expect(field).toBeFocused();
  // Flutter installs its editing connection on the next frame after focus.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
  // Avoid including a real attachment ticket in an assertion failure/report.
  if (name !== 'Attachment ticket') await expect(field).toHaveValue(value);
  await page.keyboard.press('Tab');
}
