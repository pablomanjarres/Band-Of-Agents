import { describe, expect, it } from 'vitest';
import { findCampaignByName } from '../src/domain/load';
import type { ContentAsset } from '../src/domain/types';

const asset = (name: string, id: string): ContentAsset => ({
  id, name, channel: 'instagram', markets: ['US'], copy: 'c', claim: 'c',
});

describe('findCampaignByName', () => {
  const library = [
    asset('VitaBoost Focus - Q3 Launch', 'a1'),
    asset('Lumavida Immune+ Spring', 'a2'),
  ];

  it('resolves a partial, natural reference to a saved campaign', () => {
    expect(findCampaignByName(library, 'Conductor, review the VitaBoost Focus campaign')?.id).toBe('a1');
    expect(findCampaignByName(library, 'check VitaBoost please')?.id).toBe('a1');
    expect(findCampaignByName(library, 'review the lumavida immune one')?.id).toBe('a2');
  });

  it('returns undefined when nothing meaningful overlaps', () => {
    expect(findCampaignByName(library, 'review the campaign please')).toBeUndefined();
    expect(findCampaignByName(library, 'hello there')).toBeUndefined();
    expect(findCampaignByName([], 'VitaBoost')).toBeUndefined();
  });
});
