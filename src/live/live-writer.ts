import * as fs from 'fs';
import type {
  CIInfo,
  LiveStartEvent,
  LiveTestEvent,
  LiveCompleteEvent,
  LiveCounters,
} from '../types';

interface LiveTestInput {
  testId: string;
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  retry: number;
  error?: string;
}

interface TrackedTest {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  retry: number;
  wasRetried: boolean;
}

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

    fs.writeFileSync(this.outputFile, JSON.stringify(event) + '\n');
  }

  writeTestResult(input: LiveTestInput): void {
    if (this.noop) return;

    const existing = this.tracked.get(input.testId);

    if (existing) {
      this.tracked.set(input.testId, {
        status: input.status,
        retry: input.retry,
        wasRetried: true,
      });
    } else {
      this.tracked.set(input.testId, {
        status: input.status,
        retry: input.retry,
        wasRetried: false,
      });
    }

    const counters = this.computeCounters();

    const errorSummary = input.error
      ? input.error.split('\n')[0].slice(0, 200)
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
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let flaky = 0;

    for (const [, tracked] of this.tracked) {
      if (tracked.wasRetried && tracked.status === 'passed') {
        flaky++;
      } else if (tracked.status === 'passed') {
        passed++;
      } else if (tracked.status === 'failed' || tracked.status === 'timedOut' || tracked.status === 'interrupted') {
        failed++;
      } else if (tracked.status === 'skipped') {
        skipped++;
      }
    }

    const completed = this.tracked.size;

    return {
      passed,
      failed,
      skipped,
      flaky,
      completed,
      totalExpected: this.totalExpected,
    };
  }
}
