import * as fs from 'fs';
import * as path from 'path';
import type {
  CIInfo,
  LiveStartEvent,
  LiveTestEvent,
  LiveCompleteEvent,
  LiveCounters,
  TestResultData,
} from '../types';
import { computeRunStats } from '../utils/run-stats';

interface LiveTestInput {
  testId: string;
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  retry: number;
  error?: string;
  // Playwright's outcome so far, test.outcome(); counted as the report counts it.
  outcome?: TestResultData['outcome'];
}

type TrackedTest = Pick<TestResultData, 'status' | 'outcome'>;

export class LiveWriter {
  private outputFile: string;
  private totalExpected: number = 0;
  private tracked: Map<string, TrackedTest> = new Map();
  private noop: boolean;

  constructor(options: { outputFile: string; noop?: boolean }) {
    this.outputFile = options.outputFile;
    this.noop = options.noop ?? false;
  }

  static disabled(): LiveWriter {
    return new LiveWriter({ outputFile: '', noop: true });
  }

  getOutputPath(): string {
    return this.outputFile;
  }

  start(totalExpected: number, ciInfo?: CIInfo): void {
    if (this.noop) return;
    this.totalExpected = totalExpected;
    this.tracked.clear();

    const event: LiveStartEvent = {
      event: 'start',
      timestamp: new Date().toISOString(),
      totalExpected,
      ...(ciInfo ? { ciInfo } : {}),
    };

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(event) + '\n');
  }

  writeTestResult(input: LiveTestInput): void {
    if (this.noop) return;

    // Without an outcome, a test that passed after an earlier attempt passed on retry.
    const retried = this.tracked.has(input.testId) && input.status === 'passed';
    this.tracked.set(input.testId, { status: input.status, outcome: input.outcome ?? (retried ? 'flaky' : undefined) });

    const counters = this.computeCounters();

    const errorSummary = input.error
      ? input.error.split('\n')[0].slice(0, 500)
      : undefined;

    const event: LiveTestEvent = {
      event: 'test',
      timestamp: new Date().toISOString(),
      testId: input.testId,
      title: input.title,
      file: input.file,
      status: input.status,
      duration: input.duration,
      retry: input.retry,
      counters,
      ...(errorSummary ? { error: errorSummary } : {}),
    };

    fs.appendFileSync(this.outputFile, JSON.stringify(event) + '\n');
  }

  complete(duration: number): void {
    if (this.noop) return;

    const event: LiveCompleteEvent = {
      event: 'complete',
      timestamp: new Date().toISOString(),
      duration,
      counters: this.computeCounters(),
    };

    fs.appendFileSync(this.outputFile, JSON.stringify(event) + '\n');
  }

  cleanup(): void {
    if (this.noop) return;
    if (fs.existsSync(this.outputFile)) {
      fs.unlinkSync(this.outputFile);
    }
  }

  private computeCounters(): LiveCounters {
    const { passed, failed, skipped, flaky, total } = computeRunStats([...this.tracked.values()]);
    // The live counters are buckets that add up to completed, so passed leaves out flaky.
    return {
      passed: passed - flaky,
      failed,
      skipped,
      flaky,
      completed: total,
      totalExpected: this.totalExpected,
    };
  }
}
