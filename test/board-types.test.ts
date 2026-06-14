// test/board-types.test.ts
import { describe, expect, it } from 'vitest';
import {
  WorkItem, ScoutOutput, ConflictItem, PodFinding, AdjudicatorDecision,
  MediationResult, TerminalDecision,
} from '../src/domain/board';

describe('board domain schemas', () => {
  it('parses a Scout work-item list', () => {
    const out = ScoutOutput.parse({
      workItems: [{ id: 'w1', kind: 'claim', text: 'boost your immune system', surfaces: ['headline'] }],
    });
    expect(out.workItems[0]?.kind).toBe('claim');
  });

  it('defaults surfaces and conflicts to empty arrays', () => {
    expect(WorkItem.parse({ id: 'w1', kind: 'cta', text: 'sign up' }).surfaces).toEqual([]);
    const pf = PodFinding.parse({ kind: 'pod-finding', pod: 'regulatory', summary: 's', findings: [] });
    expect(pf.conflicts).toEqual([]);
  });

  it('models a cross-region conflict', () => {
    const c = ConflictItem.parse({ span: 'boost', blockedBy: ['EU'], passedBy: ['US'] });
    expect(c.blockedBy).toContain('EU');
    expect(c.rationale).toBe('');
  });

  it('parses an adjudicator decision and terminal enum', () => {
    const d = AdjudicatorDecision.parse({ kind: 'adjudication', decision: 'escalate', score: 0.2, rationale: 'deadlock' });
    expect(d.decision).toBe('escalate');
    expect(TerminalDecision.parse('spiked')).toBe('spiked');
    expect(MediationResult.parse({ kind: 'mediation', resolved: false, note: 'no movement' }).requiredDisclosure).toBeNull();
  });
});
