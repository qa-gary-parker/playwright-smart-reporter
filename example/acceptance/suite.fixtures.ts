import { test, expect } from '@playwright/test';

// No browser: these exercise the reporter, not a page.
test('passes', () => {
  expect(1 + 1).toBe(2);
});

test('fails', () => {
  expect(1 + 1).toBe(3);
});

test('passes on retry', () => {
  expect(test.info().retry).toBe(1);
});

test.skip('is skipped', () => {});

test('takes a second', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
});
