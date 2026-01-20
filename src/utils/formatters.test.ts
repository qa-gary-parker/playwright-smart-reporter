import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTimestamp,
  formatShortDate,
  formatPercent,
  formatNumber,
} from './formatters';

describe('formatDuration', () => {
  it('formats milliseconds under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(100)).toBe('100ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats duration in seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('formats duration in minutes', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(90000)).toBe('1.5m');
    expect(formatDuration(120000)).toBe('2.0m');
  });

  it('rounds milliseconds to whole numbers', () => {
    expect(formatDuration(123.456)).toBe('123ms');
    expect(formatDuration(99.9)).toBe('100ms');
    expect(formatDuration(0.4)).toBe('0ms');
    expect(formatDuration(50.5)).toBe('51ms');
  });
});

describe('formatTimestamp', () => {
  it('formats ISO timestamp to locale string', () => {
    const timestamp = '2024-01-15T10:30:00.000Z';
    const result = formatTimestamp(timestamp);
    // The exact format depends on locale, but it should be a string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatShortDate', () => {
  it('formats timestamp to short date', () => {
    const timestamp = '2024-01-15T10:30:00.000Z';
    const result = formatShortDate(timestamp);
    expect(result).toBe('Jan 15');
  });

  it('handles different months', () => {
    expect(formatShortDate('2024-06-20T10:30:00.000Z')).toBe('Jun 20');
    expect(formatShortDate('2024-12-25T10:30:00.000Z')).toBe('Dec 25');
  });
});

describe('formatPercent', () => {
  it('formats decimal to percentage', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.85)).toBe('85%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('rounds to nearest integer', () => {
    expect(formatPercent(0.333)).toBe('33%');
    expect(formatPercent(0.666)).toBe('67%');
    expect(formatPercent(0.999)).toBe('100%');
  });
});

describe('formatNumber', () => {
  it('formats numbers with locale formatting', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(100)).toBe('100');
    // Note: locale-dependent, may have commas or periods
    const result = formatNumber(1234);
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles large numbers', () => {
    const result = formatNumber(1000000);
    expect(result).toBeTruthy();
    // Should contain some separator for thousands
    expect(result.length).toBeGreaterThan(4);
  });
});
