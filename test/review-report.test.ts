// test/review-report.test.ts
import { describe, expect, it } from 'vitest';
import { composeReport } from '../src/agents/review-report';

const f = (severity: 'block' | 'warn' | 'info', claim: string, rationale: string, extra: Record<string, unknown> = {}) =>
  ({ category: 'claim', severity, claim, rationale, ...extra });

describe('composeReport', () => {
  it('groups a claim across reviewers, naming the rule and reason, and lists material links', () => {
    const report = composeReport({
      asset: { id: 'vitaboost-q3', name: 'VitaBoost Focus Q3', markets: ['US', 'EU', 'LATAM'] },
      decision: 'asking',
      sources: [
        { source: 'EU', findings: [f('block', 'clinically proven to boost your immune system', 'Unauthorised health claim.', { ruleId: 'eu-health-preauth', requiredDisclosure: 'Article 10(2) statement' })] },
        { source: 'US', findings: [f('warn', 'clinically proven to boost your immune system', 'Needs substantiation on file.', { ruleId: 'us-substantiation' })] },
        { source: 'Claims', findings: [f('block', '9 out of 10 users felt healthier', 'No survey methodology provided.')] },
      ],
      fixes: [{ region: 'EU', copy: 'Supports everyday wellness.', imageUrl: 'http://localhost:8788/api/images/x.png' }],
    });
    // one grouped entry per claim, both reviewers shown under the shared claim
    expect(report).toContain('"clinically proven to boost your immune system"');
    expect(report).toContain('EU [block] (eu-health-preauth)');
    expect(report).toContain('US [warn] (us-substantiation)');
    expect(report).toContain('Required disclosure: "Article 10(2) statement"');
    expect(report).toContain('"9 out of 10 users felt healthier"');
    // the fix + image link surface
    expect(report).toContain('Proposed fix:');
    expect(report).toContain('http://localhost:8788/api/images/x.png');
    // the ask header
    expect(report).toContain('awaiting your decision');
    // 2 claims, 2 blocking
    expect(report).toContain('2 claim(s) flagged, 2 blocking');
  });

  it('labels multiple fixes as per-market versions and shows a clean publish header', () => {
    const report = composeReport({
      asset: { id: 'a', name: 'NeuroPeak Q3', markets: ['US', 'EU', 'LATAM'] },
      decision: 'published',
      sources: [],
      fixes: [
        { region: 'US', copy: 'Clinically studied for focus. Results may vary.', imageUrl: 'http://x/us.png' },
        { region: 'EU', copy: 'Supports everyday focus.', imageUrl: 'http://x/eu.png' },
      ],
    });
    expect(report).toContain('NeuroPeak Q3: PUBLISHED');
    expect(report).toContain('Proposed market-tailored versions:');
    expect(report).toContain('US: "Clinically studied for focus. Results may vary."');
    expect(report).toContain('EU: "Supports everyday focus."');
    expect(report).toContain('Findings: none');
    expect(report).toContain('not legal advice');
  });
});
