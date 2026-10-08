import { isFailing, isFlaky, type ReportTest } from './data';
import type { GroupBy } from './grouping';

export const QUEUE_IDS = ['failures', 'flaky', 'regressions', 'quarantined', 'all'] as const;
export type QueueId = (typeof QUEUE_IDS)[number];

export interface Queue {
  label: string;
  icon: string;
  groupBy: GroupBy;
  includes: (t: ReportTest) => boolean;
  empty: string;
}

export const QUEUES: Record<QueueId, Queue> = {
  failures: { label: 'Failures', icon: 'x-circle', groupBy: 'cluster', includes: isFailing, empty: 'No failures in this run.' },
  flaky: { label: 'Flaky', icon: 'shuffle', groupBy: 'file', includes: isFlaky, empty: 'No flaky tests in this run.' },
  regressions: {
    label: 'Regressions',
    icon: 'trending-up',
    groupBy: 'file',
    includes: (t) => t.signals.includes('regression'),
    empty: 'No performance regressions in this run.',
  },
  quarantined: {
    label: 'Quarantined',
    icon: 'ban',
    groupBy: 'file',
    includes: (t) => t.signals.includes('quarantined'),
    empty: 'No quarantined tests.',
  },
  all: { label: 'All tests', icon: 'layers', groupBy: 'file', includes: () => true, empty: 'No tests in this run.' },
};
