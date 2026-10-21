import { test, expect } from '@playwright/test';

// No browser: run with ACCEPTANCE_PROJECTS=chromium,firefox,webkit. The reporter reads the browser from the project name.
test('passes everywhere', () => {});

test('fails on firefox', () => {
  expect(test.info().project.name).not.toBe('firefox');
});
