import { test } from '@playwright/test';

// No browser: these exercise the reporter, not a page.
test('pays by card', { tag: '@quarantine(https://jira.example.com/browse/PAY-14)' }, () => {});

test('refunds', { annotation: { type: 'quarantine', description: 'PAY-15' } }, () => {});
