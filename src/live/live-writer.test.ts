import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { LiveWriter } from './live-writer';

vi.mock('fs');

describe('LiveWriter', () => {
  const mockFs = vi.mocked(fs);
  let writer: LiveWriter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    writer = new LiveWriter({ outputFile: '/tmp/live.jsonl' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start', () => {
    it('writes a start event with total expected count', () => {
      writer.start(47);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const written = mockFs.writeFileSync.mock.calls[0][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.event).toBe('start');
      expect(event.totalExpected).toBe(47);
      expect(event.timestamp).toBeDefined();
    });

    it('includes CI info when provided', () => {
      writer.start(10, { provider: 'github', branch: 'main', commit: 'abc123' });

      const written = mockFs.writeFileSync.mock.calls[0][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.ciInfo).toEqual({ provider: 'github', branch: 'main', commit: 'abc123' });
    });
  });

  describe('writeTestResult', () => {
    it('appends a test event with counters', () => {
      writer.start(3);
      mockFs.appendFileSync.mockImplementation(() => {});

      writer.writeTestResult({
        testId: 'file.ts::test1',
        title: 'test1',
        file: 'file.ts',
        status: 'passed',
        duration: 1200,
        retry: 0,
      });

      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      const written = mockFs.appendFileSync.mock.calls[0][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.event).toBe('test');
      expect(event.testId).toBe('file.ts::test1');
      expect(event.status).toBe('passed');
      expect(event.counters.passed).toBe(1);
      expect(event.counters.completed).toBe(1);
      expect(event.counters.totalExpected).toBe(3);
    });

    it('tracks retries: updates counters when a retry replaces a failure', () => {
      writer.start(2);
      mockFs.appendFileSync.mockImplementation(() => {});

      writer.writeTestResult({
        testId: 'file.ts::flaky',
        title: 'flaky',
        file: 'file.ts',
        status: 'failed',
        duration: 500,
        retry: 0,
      });

      writer.writeTestResult({
        testId: 'file.ts::flaky',
        title: 'flaky',
        file: 'file.ts',
        status: 'passed',
        duration: 600,
        retry: 1,
      });

      const written = mockFs.appendFileSync.mock.calls[1][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.counters.passed).toBe(0);
      expect(event.counters.failed).toBe(0);
      expect(event.counters.flaky).toBe(1);
      expect(event.counters.completed).toBe(1);
    });

    it('includes error summary for failed tests (first line only)', () => {
      writer.start(1);
      mockFs.appendFileSync.mockImplementation(() => {});

      writer.writeTestResult({
        testId: 'file.ts::broken',
        title: 'broken',
        file: 'file.ts',
        status: 'failed',
        duration: 300,
        retry: 0,
        error: 'Expected 200, got 500\n    at Object.test (file.ts:10:5)',
      });

      const written = mockFs.appendFileSync.mock.calls[0][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.error).toBe('Expected 200, got 500');
    });
  });

  describe('complete', () => {
    it('appends a complete event with final counters', () => {
      writer.start(1);
      mockFs.appendFileSync.mockImplementation(() => {});

      writer.writeTestResult({
        testId: 'file.ts::t1',
        title: 't1',
        file: 'file.ts',
        status: 'passed',
        duration: 100,
        retry: 0,
      });

      writer.complete(5000);

      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(2);
      const written = mockFs.appendFileSync.mock.calls[1][1] as string;
      const event = JSON.parse(written.trim());
      expect(event.event).toBe('complete');
      expect(event.duration).toBe(5000);
      expect(event.counters.passed).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes the output file if it exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      writer.cleanup();
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/live.jsonl');
    });

    it('does nothing if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      writer.cleanup();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('disabled writer', () => {
    it('returns a no-op writer when disabled', () => {
      const noop = LiveWriter.disabled();
      noop.start(10);
      noop.writeTestResult({ testId: 'x', title: 'x', file: 'x', status: 'passed', duration: 0, retry: 0 });
      noop.complete(0);
      noop.cleanup();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });
});
