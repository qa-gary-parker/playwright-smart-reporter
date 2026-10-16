import { test } from '@playwright/test';

test.use({ trace: 'retain-on-failure' });

const png = Buffer.from('89504e470d0a1a0a', 'hex');

// No browser: the first attempt attaches a screenshot and fails, the retry passes.
test('fails once with a screenshot', async ({}, testInfo) => {
  if (testInfo.retry > 0) return;
  await testInfo.attach('screenshot', { body: png, contentType: 'image/png' });
  throw new Error('first attempt fails');
});

test('fails every time with a screenshot', async ({}, testInfo) => {
  await testInfo.attach('screenshot', { body: png, contentType: 'image/png' });
  throw new Error(`attempt ${testInfo.retry + 1} fails`);
});
