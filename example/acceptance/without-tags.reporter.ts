import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

// Playwright added test.tags in 1.42. Listed before the smart reporter, this hides it, so the smart reporter
// sees each test as Playwright 1.40 and 1.41 report it. onEnd puts it back for Playwright's JSON reporter.
export default class WithoutTags implements Reporter {
  private tests: TestCase[] = [];

  onBegin(_config: FullConfig, suite: Suite) {
    this.tests = suite.allTests();
    for (const test of this.tests) Object.defineProperty(test, 'tags', { value: undefined, configurable: true });
  }

  onEnd() {
    for (const test of this.tests) delete (test as { tags?: string[] }).tags;
  }
}
