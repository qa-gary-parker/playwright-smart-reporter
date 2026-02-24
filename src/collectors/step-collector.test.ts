import { describe, it, expect } from 'vitest';
import { StepCollector } from './step-collector';
import type { TestResult } from '@playwright/test/reporter';

function makeStep(
  title: string,
  duration: number,
  category: string,
  nestedSteps: TestResult['steps'] = []
): TestResult['steps'][0] {
  return {
    title,
    duration,
    category,
    steps: nestedSteps,
    startTime: new Date(),
    location: undefined as any,
    error: undefined,
    parent: undefined as any,
    titlePath: () => [title],
    annotations: [],
    attachments: [],
  };
}

function makeTestResult(steps: TestResult['steps']): TestResult {
  return {
    steps,
    attachments: [],
    annotations: [],
    status: 'passed',
    duration: 1000,
    startTime: new Date(),
    retry: 0,
    parallelIndex: 0,
    workerIndex: 0,
    errors: [],
    stderr: [],
    stdout: [],
  };
}

describe('StepCollector', () => {
  describe('extractSteps', () => {
    it('extracts basic steps from a test result', () => {
      const result = makeTestResult([
        makeStep('Click button', 50, 'pw:api'),
        makeStep('Fill form', 80, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(2);
      expect(steps[0]).toEqual({
        title: 'Click button',
        duration: 50,
        category: 'pw:api',
      });
      expect(steps[1]).toEqual({
        title: 'Fill form',
        duration: 80,
        category: 'pw:api',
      });
    });

    it('returns empty array when result has no steps', () => {
      const result = makeTestResult([]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toEqual([]);
    });

    it('includes test.step category steps regardless of filter', () => {
      const result = makeTestResult([
        makeStep('Login step', 200, 'test.step'),
        makeStep('page.click', 30, 'pw:api'),
      ]);
      const collector = new StepCollector({ filterPwApiSteps: true });

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe('Login step');
      expect(steps[0].category).toBe('test.step');
    });

    it('includes pw:api steps when filterPwApiSteps is false', () => {
      const result = makeTestResult([
        makeStep('Login step', 200, 'test.step'),
        makeStep('page.click', 30, 'pw:api'),
      ]);
      const collector = new StepCollector({ filterPwApiSteps: false });

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(2);
    });

    it('includes pw:api steps by default', () => {
      const result = makeTestResult([
        makeStep('page.goto', 100, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(1);
    });

    it('filters out pw:api steps when filterPwApiSteps is true', () => {
      const result = makeTestResult([
        makeStep('page.click', 30, 'pw:api'),
        makeStep('page.fill', 20, 'pw:api'),
        makeStep('Login', 100, 'test.step'),
      ]);
      const collector = new StepCollector({ filterPwApiSteps: true });

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe('Login');
    });

    it('skips internal hook steps', () => {
      const result = makeTestResult([
        makeStep('Before Hooks', 10, 'hook'),
        makeStep('page.goto', 50, 'pw:api'),
        makeStep('After Hooks', 5, 'hook'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe('page.goto');
    });

    it('walks nested steps recursively', () => {
      const nested = makeStep('page.fill', 20, 'pw:api');
      const parent = makeStep('Fill form', 50, 'test.step', [nested]);
      const result = makeTestResult([parent]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(2);
      expect(steps[0].title).toBe('Fill form');
      expect(steps[1].title).toBe('page.fill');
    });

    it('walks deeply nested steps', () => {
      const deepChild = makeStep('locator.click', 10, 'pw:api');
      const child = makeStep('page.locator', 30, 'pw:api', [deepChild]);
      const parent = makeStep('Interaction', 60, 'test.step', [child]);
      const result = makeTestResult([parent]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps).toHaveLength(3);
      expect(steps[0].title).toBe('Interaction');
      expect(steps[1].title).toBe('page.locator');
      expect(steps[2].title).toBe('locator.click');
    });

    it('marks the slowest step when its duration exceeds 100ms', () => {
      const result = makeTestResult([
        makeStep('Fast step', 50, 'pw:api'),
        makeStep('Slow step', 500, 'pw:api'),
        makeStep('Medium step', 80, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps[0].isSlowest).toBeUndefined();
      expect(steps[1].isSlowest).toBe(true);
      expect(steps[2].isSlowest).toBeUndefined();
    });

    it('does not mark slowest step when all steps are under 100ms', () => {
      const result = makeTestResult([
        makeStep('Step A', 30, 'pw:api'),
        makeStep('Step B', 50, 'pw:api'),
        makeStep('Step C', 90, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps.every(s => s.isSlowest === undefined)).toBe(true);
    });

    it('marks slowest step when exactly 101ms', () => {
      const result = makeTestResult([
        makeStep('Step A', 50, 'pw:api'),
        makeStep('Step B', 101, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps[1].isSlowest).toBe(true);
    });

    it('does not mark slowest step at exactly 100ms', () => {
      const result = makeTestResult([
        makeStep('Step A', 50, 'pw:api'),
        makeStep('Step B', 100, 'pw:api'),
      ]);
      const collector = new StepCollector();

      const steps = collector.extractSteps(result);

      expect(steps.every(s => s.isSlowest === undefined)).toBe(true);
    });
  });

  describe('getTotalStepDuration', () => {
    it('sums all step durations', () => {
      const collector = new StepCollector();
      const steps = [
        { title: 'A', duration: 100, category: 'pw:api' },
        { title: 'B', duration: 200, category: 'pw:api' },
        { title: 'C', duration: 300, category: 'test.step' },
      ];

      expect(collector.getTotalStepDuration(steps)).toBe(600);
    });

    it('returns 0 for empty steps', () => {
      const collector = new StepCollector();

      expect(collector.getTotalStepDuration([])).toBe(0);
    });
  });

  describe('getSlowestStep', () => {
    it('returns the step marked as slowest', () => {
      const collector = new StepCollector();
      const steps = [
        { title: 'Fast', duration: 10, category: 'pw:api' },
        { title: 'Slow', duration: 500, category: 'pw:api', isSlowest: true },
      ];

      expect(collector.getSlowestStep(steps)).toEqual(steps[1]);
    });

    it('returns null when no steps exist', () => {
      const collector = new StepCollector();

      expect(collector.getSlowestStep([])).toBeNull();
    });

    it('returns null when no step is marked as slowest', () => {
      const collector = new StepCollector();
      const steps = [
        { title: 'A', duration: 50, category: 'pw:api' },
        { title: 'B', duration: 80, category: 'pw:api' },
      ];

      expect(collector.getSlowestStep(steps)).toBeNull();
    });
  });
});
