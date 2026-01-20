/**
 * Utility functions for formatting durations, dates, and other display values
 */

/**
 * Format duration in milliseconds to human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "1.5s", "2.3m", "450ms")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format timestamp to localized string
 * @param timestamp - ISO timestamp string
 * @returns Localized date/time string
 */
export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format date to short format
 * @param timestamp - ISO timestamp string
 * @returns Short date format (e.g., "Jan 15")
 */
export function formatShortDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format percentage
 * @param value - Decimal value (e.g., 0.85)
 * @returns Formatted percentage (e.g., "85%")
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format number with commas
 * @param value - Number to format
 * @returns Formatted string (e.g., "1,234")
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}
