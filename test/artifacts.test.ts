import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/store';
import { buildArtifactUrl, makePublishArtifact } from '../src/store/artifacts';
import type { Artifact, NewArtifact } from '../src/domain/artifact';

function tmpStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'artifacts-test-'));
  return { store: new Store(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('artifact store', () => {
  it('round-trips an artifact of each kind', () => {
    const { store, cleanup } = tmpStore();
    try {
      const samples: Artifact[] = [
        { id: 'i1', kind: 'image', title: 'US visual', createdAt: 1, src: '/api/images/x.png' },
        { id: 'm1', kind: 'markdown', title: 'Report', createdAt: 2, content: '# Verdicts' },
        { id: 'j1', kind: 'json', title: 'Asset', createdAt: 3, content: '{"a":1}' },
        { id: 't1', kind: 'text', title: 'Note', createdAt: 4, content: 'hello' },
      ];
      for (const a of samples) store.saveArtifact(a);
      for (const a of samples) expect(store.getArtifact(a.id)).toEqual(a);
    } finally {
      cleanup();
    }
  });

  it('returns undefined for a missing id', () => {
    const { store, cleanup } = tmpStore();
    try {
      expect(store.getArtifact('nope')).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('replaces an artifact saved under the same id rather than duplicating', () => {
    const { store, cleanup } = tmpStore();
    try {
      store.saveArtifact({ id: 'a', kind: 'text', title: 'v1', createdAt: 1, content: 'one' });
      store.saveArtifact({ id: 'a', kind: 'text', title: 'v2', createdAt: 2, content: 'two' });
      expect(store.getArtifact('a')?.title).toBe('v2');
    } finally {
      cleanup();
    }
  });
});

describe('buildArtifactUrl', () => {
  it('joins base and id with exactly one slash', () => {
    expect(buildArtifactUrl('http://localhost:8787', 'abc')).toBe('http://localhost:8787/a/abc');
  });

  it('does not double the slash when the base has a trailing slash', () => {
    expect(buildArtifactUrl('http://localhost:8787/', 'abc')).toBe('http://localhost:8787/a/abc');
  });
});

describe('makePublishArtifact', () => {
  it('mints an id, stamps createdAt from the clock, persists, and returns the url', () => {
    const { store, cleanup } = tmpStore();
    try {
      const publish = makePublishArtifact(store, 'http://localhost:8787', () => 12345);
      const input: NewArtifact = { kind: 'markdown', title: 'Report', content: '# Verdicts' };
      const { id, url } = publish(input);

      expect(url).toBe(`http://localhost:8787/a/${id}`);
      const stored = store.getArtifact(id);
      expect(stored).toMatchObject({ id, kind: 'markdown', title: 'Report', content: '# Verdicts', createdAt: 12345 });
    } finally {
      cleanup();
    }
  });
});
