import type { TestResult } from '@playwright/test/reporter';
import type { StepData } from '../types';

/**
 * Options for step collection
 */
export interface StepCollectorOptions {
  /**
   * When true, filters out pw:api steps and only shows test.step entries.
   * Useful when you have custom test.step descriptions and don't want the
   * verbose Playwright API calls cluttering the step list.
   * Default: false (show all steps)
   */
  filterPwApiSteps?: boolean;
}

/**
 * Extracts and processes step timing data from test results
 */
export class StepCollector {
  private options: StepCollectorOptions;

  constructor(options: StepCollectorOptions = {}) {
    this.options = {
      filterPwApiSteps: options.filterPwApiSteps ?? false,
    };
  }

  /**
   * Extract step timings from a test result
   * @param result - Playwright TestResult
   * @returns Array of step data with durations and categories
   */
  extractSteps(result: TestResult): StepData[] {
    const steps: StepData[] = [];
    const filterPwApi = this.options.filterPwApiSteps;

    // Recursively extract steps from the result
    const processStep = (step: TestResult['steps'][0]) => {
      // Only include meaningful steps (skip internal hooks)
      // Issue #22: Optionally filter out pw:api steps
      const isTestStep = step.category === 'test.step';
      const isPwApi = step.category === 'pw:api';

      if (isTestStep || (isPwApi && !filterPwApi)) {
        steps.push({
          title: step.title,
          duration: step.duration,
          category: step.category,
        });
      }

      // Process nested steps
      if (step.steps) {
        for (const nested of step.steps) {
          processStep(nested);
        }
      }
    };

    for (const step of result.steps) {
      processStep(step);
    }

    // Mark the slowest step if we have any
    if (steps.length > 0) {
      const maxDuration = Math.max(...steps.map((s) => s.duration));
      const slowestIndex = steps.findIndex((s) => s.duration === maxDuration);
      if (slowestIndex !== -1 && maxDuration > 100) {
        steps[slowestIndex].isSlowest = true;
      }
    }

    return steps;
  }

  /**
   * Calculate total duration of all steps
   * @param steps - Array of step data
   * @returns Total duration in milliseconds
   */
  getTotalStepDuration(steps: StepData[]): number {
    return steps.reduce((sum, step) => sum + step.duration, 0);
  }

  /**
   * Get slowest step
   * @param steps - Array of step data
   * @returns Slowest step or null if no steps
   */
  getSlowestStep(steps: StepData[]): StepData | null {
    if (steps.length === 0) return null;
    return steps.find(s => s.isSlowest) || null;
  }
}
