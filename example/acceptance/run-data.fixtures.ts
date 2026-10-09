import { test, expect } from '@playwright/test';

// No browser: run-data.acceptance.ts checks the reporter's counts against Playwright's on these.
test('passes', () => {});

test.describe('first block', () => {
  test('same title', () => {});
});

test.describe('second block', () => {
  test('same title', () => {
    expect(1).toBe(2);
  });
});

test('expected failure that fails', () => {
  test.fail();
  expect(1).toBe(2);
});

test('expected failure that passes', () => {
  test.fail();
});

test('passes on retry', () => {
  expect(test.info().retry).toBe(1);
});

test('fails when asked', () => {
  expect(process.env.ACCEPTANCE_FAIL).toBeUndefined();
});

test('skipped when asked', () => {
  test.skip(!!process.env.ACCEPTANCE_SKIP, 'asked to skip');
});

test('runs for three seconds', async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
});

// Gives a parallel worker time to start 'runs for three seconds', so --max-failures interrupts it.
test('fails after a second', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(1).toBe(2);
});
