import type { A11yImpact, A11yViolation } from '../../../types';
import { EmptyState, Icon } from '../../components';
import { plural } from '../data';
import { formatRoute } from '../router';
import { data, testsById } from '../store';

const IMPACTS: A11yImpact[] = ['critical', 'serious', 'moderate', 'minor'];

export function Impact({ impact }: { impact: A11yImpact }) {
  return (
    <span class="impact" data-impact={impact}>
      {impact[0].toUpperCase() + impact.slice(1)}
    </span>
  );
}

export function Violations({ violations }: { violations: A11yViolation[] }) {
  return (
    <ul class="a11y-list">
      {violations.map((v) => (
        <li class="a11y-item">
          <div class="a11y-item__head">
            <Impact impact={v.impact} />
            <span class="mono">{v.id}</span>
            <span class="muted">{v.description}</span>
            <a class="a11y-item__help" href={v.helpUrl} target="_blank" rel="noreferrer">
              How to fix <Icon name="external-link" size={12} />
            </a>
          </div>
          <ul class="a11y-nodes">
            {v.nodes.map((n) => (
              <li class="mono" title={n.failureSummary}>
                {n.target.join(' ')}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function Accessibility() {
  const a = data.value.a11y;
  const byId = testsById.value;
  if (!a) {
    return (
      <div class="page">
        <header class="page__head">
          <h1 class="page__title">Accessibility</h1>
        </header>
        <EmptyState title="No accessibility scans in this run" icon="eye">
          Wrap your config with <code>withAccessibility()</code> to scan pages with axe-core during tests.
        </EmptyState>
      </div>
    );
  }
  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Accessibility</h1>
        <span class="faint">
          {plural(a.testsScanned, 'test')} scanned · {plural(a.pagesScanned, 'page')} · rating {a.rating}
        </span>
      </header>
      <div class="stats">
        <div class="stat">
          <span class="stat__label">Violations</span>
          <span class="stat__value">{a.totalViolations}</span>
          <span class="stat__sub">
            in {a.testsWithViolations} of {plural(a.testsScanned, 'test')}
          </span>
        </div>
        {IMPACTS.map((impact) => (
          <div class="stat">
            <span class="stat__label">
              <Impact impact={impact} />
            </span>
            <span class="stat__value">{a.byImpact[impact]}</span>
          </div>
        ))}
      </div>
      <section class="panel">
        <header class="panel__head">
          <h2 class="panel__title">Rules</h2>
          <span class="panel__meta">most-hit first</span>
        </header>
        {a.byRule.length === 0 ? (
          <p class="panel__empty">No violations found.</p>
        ) : (
          <ul class="a11y-list">
            {a.byRule.map((rule) => (
              <li class="a11y-item">
                <details>
                  <summary class="a11y-item__head">
                    <Impact impact={rule.impact} />
                    <span class="mono">{rule.id}</span>
                    <span class="muted">{rule.description}</span>
                    <span class="faint a11y-item__count">
                      {plural(rule.nodes, 'element')} · {plural(rule.tests, 'test')}
                    </span>
                  </summary>
                  <ul class="lines a11y-tests">
                    {rule.testIds.map((id) => (
                      <li class="lines__item">
                        <a class="lines__label" href={formatRoute({ view: 'queue', queue: 'all', q: '', test: id })}>
                          {byId.get(id)?.title ?? id}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <a class="a11y-item__help" href={rule.helpUrl} target="_blank" rel="noreferrer">
                    How to fix <Icon name="external-link" size={12} />
                  </a>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
