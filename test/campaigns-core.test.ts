// Core1 of the campaigns rung: the domain + board + reviewer + store foundation.
// These tests pin the additive contract (single-asset behavior is unchanged) and
// the ONE RULE: materials negotiate per material, with a per-material reconcile
// gate, never a campaign-wide gate.

import { describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Campaign, Material, normalizeCampaign, type CampaignDossier, type ContentAsset } from '../src/domain/types';
import { makeRegionReviewer } from '../src/agents/region-reviewer';
import { makeReconcile } from '../src/agents/reconcile';
import { SharedBoard } from '../src/board/shared';
import type { BoardEvent } from '../src/board/events';
import type { ModelClient } from '../src/models/client';
import type { Participant, RoomMessage, RoomTools } from '../src/band/types';
import { loadBrandDna, loadRulebook } from '../src/domain/load';
import { Store, assetToCampaign } from '../src/store/store';

const ASSETS = new URL('../assets/', import.meta.url).pathname;

function tools(): RoomTools {
  const participants: Participant[] = [
    { id: 'rec', name: 'Reconcile', handle: '@reconcile', type: 'agent' },
    { id: 'us', name: 'US Reviewer', handle: '@us', type: 'agent' },
  ];
  return {
    capabilities: { peers: false, contacts: false, memory: false },
    sendMessage: async () => {},
    sendEvent: async () => {},
    getParticipants: async () => participants,
    addParticipant: async () => {},
    lookupPeers: async () => participants,
  };
}

// An agent-authored recruit message (the reviewer reads the material off the board).
function recruitMsg(roomId: string): RoomMessage {
  return {
    id: 'm',
    roomId,
    content: 'Please review and report to @Reconcile.',
    senderId: 'coord',
    senderType: 'agent',
    senderName: 'Coordinator',
    messageType: 'chat',
    mentions: [],
    metadata: {},
    createdAt: new Date(),
  };
}

const DOSSIER: CampaignDossier = {
  approvedClaims: ['Clinically proven to support immunity'],
  substantiation: 'RCT n=240, data on file ref DF-2026-07.',
  approvedInfo: 'Always include the "as part of a balanced diet" line.',
  sources: [{ name: 'trial-summary', kind: 'text', content: 'Double-blind trial, primary endpoint met.' }],
};

describe('campaign domain: three tiers (campaign -> advertisements -> materials)', () => {
  it('parses a three-tier campaign whose material reuses ContentAsset fields plus kind', () => {
    const parsed = Campaign.parse({
      id: 'camp-1',
      name: 'Immune+ Q3',
      markets: ['US', 'EU'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      advertisements: [
        {
          id: 'ad-hero',
          name: 'Hero Launch',
          materials: [
            { id: 'm1', kind: 'video', channel: 'social', markets: ['US'], copy: 'hero copy', claim: 'feel better', videoUrl: 'https://x/v.mp4' },
          ],
        },
      ],
    });
    expect(parsed.advertisements[0]?.id).toBe('ad-hero');
    expect(parsed.advertisements[0]?.materials[0]?.kind).toBe('video');
    expect(parsed.advertisements[0]?.materials[0]?.copy).toBe('hero copy');
  });

  it('applies defaults for dossier, markets, and advertisements', () => {
    const parsed = Campaign.parse({ id: 'c', name: 'n', dossier: {} });
    expect(parsed.markets).toEqual([]);
    expect(parsed.advertisements).toEqual([]);
    expect(parsed.dossier.approvedClaims).toEqual([]);
    expect(parsed.dossier.sources).toEqual([]);
  });

  it('normalizes a legacy flat materials[] campaign into a single "Default" advertisement', () => {
    // Old data / old seeds had a flat materials[]; the schema preprocess (and the
    // exported normalizeCampaign) load it as one advertisement so nothing breaks.
    const legacy = {
      id: 'legacy-camp',
      name: 'Legacy',
      markets: ['US'],
      dossier: { approvedClaims: [], substantiation: '', approvedInfo: '', sources: [] },
      materials: [
        { id: 'm1', kind: 'post', channel: 'x', markets: ['US'], copy: 'c', claim: 'c' },
        { id: 'm2', kind: 'image', channel: 'ig', markets: ['US'], copy: 'c2', claim: 'c2' },
      ],
    };
    const viaParse = Campaign.parse(legacy);
    const viaNormalize = normalizeCampaign(legacy);
    for (const parsed of [viaParse, viaNormalize]) {
      expect(parsed.advertisements.length).toBe(1);
      expect(parsed.advertisements[0]?.id).toBe('default');
      expect(parsed.advertisements[0]?.name).toBe('Default');
      expect(parsed.advertisements[0]?.materials.map((m) => m.id)).toEqual(['m1', 'm2']);
      // The legacy `materials` key does not survive as a campaign field.
      expect((parsed as unknown as { materials?: unknown }).materials).toBeUndefined();
    }
  });

  it('a Material is a flat leaf: it has no attachments field any more', () => {
    const m = Material.parse({ id: 'v', kind: 'video', channel: 'social', markets: ['US'], copy: 'c', claim: 'c' });
    expect((m as unknown as { attachments?: unknown }).attachments).toBeUndefined();
    // The advertisement is the grouping, so an `attachments` array is dropped, not nested.
    const m2 = Material.parse({
      id: 'v2',
      kind: 'video',
      channel: 'social',
      markets: ['US'],
      copy: 'c',
      claim: 'c',
      attachments: [{ id: 'p', kind: 'post', channel: 'x', markets: ['US'], copy: 'd', claim: 'd' }],
    } as unknown as Record<string, unknown>);
    expect((m2 as unknown as { attachments?: unknown }).attachments).toBeUndefined();
  });
});

describe('dossier + perception cascade into the region reviewer prompt', () => {
  async function capturePrompt(opts: {
    dossier?: CampaignDossier;
    asset: ContentAsset;
  }): Promise<{ system: string; user: string }> {
    const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
    const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
    const board = new SharedBoard(() => {});
    board.startReview('r', opts.asset, opts.dossier ? { dossier: opts.dossier, campaignId: 'c', materialId: opts.asset.id } : undefined);
    let system = '';
    let user = '';
    const model: ModelClient = {
      model: 'capture',
      complete: async (req) => {
        system = req.system ?? '';
        const first = req.messages[0];
        user = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content);
        return { text: '', json: { findings: [] } };
      },
    };
    const handler = makeRegionReviewer({ board, region: 'US', reviewerName: 'US Reviewer', rulebook: usRules, brand, model, reportToHandle: '@reconcile' });
    await handler(recruitMsg('r'), tools(), { roomId: 'r', agentId: 'us', agentName: 'US Reviewer' });
    return { system, user };
  }

  it('injects the dossier (claims, substantiation, approved info, sources) into the system prompt', async () => {
    const asset: ContentAsset = { id: 'a1', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' };
    const { system } = await capturePrompt({ dossier: DOSSIER, asset });
    expect(system).toContain('Campaign dossier');
    expect(system).toContain('Clinically proven to support immunity');
    expect(system).toContain('DF-2026-07');
    expect(system).toContain('balanced diet');
    expect(system).toContain('trial-summary');
  });

  it('omits the dossier block entirely on a plain single-asset review (no regression)', async () => {
    const asset: ContentAsset = { id: 'a1', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' };
    const { system } = await capturePrompt({ asset });
    expect(system).not.toContain('Campaign dossier');
  });

  it('injects the material perception artifacts into the user prompt', async () => {
    // A Material is structurally a ContentAsset; attach perception at runtime.
    const material = {
      id: 'm-vid',
      channel: 'social',
      markets: ['US'],
      copy: 'watch this',
      claim: 'boosts immunity',
      perception: {
        transcript: 'In this video we say immunity is boosted overnight.',
        onScreenText: 'IMMUNITY BOOST',
        visualDescription: 'A person drinking a supplement.',
        detectedClaims: ['boosts immunity overnight'],
        frames: ['/api/images/f1.png'],
      },
    } as unknown as ContentAsset;
    const { user } = await capturePrompt({ dossier: DOSSIER, asset: material });
    expect(user).toContain('Perception');
    expect(user).toContain('immunity is boosted overnight');
    expect(user).toContain('IMMUNITY BOOST');
    expect(user).toContain('boosts immunity overnight');
  });
});

describe('THE ONE RULE: reconcile gates per material, not campaign-wide', () => {
  it('material A reconciles as soon as A\'s regions are in, while material B is still partial', async () => {
    const board = new SharedBoard(() => {});
    const roomA = 'room::matA';
    const roomB = 'room::matB';
    const assetA: ContentAsset = { id: 'matA', channel: 'post', markets: ['US', 'EU'], copy: 'a', claim: 'a' };
    const assetB: ContentAsset = { id: 'matB', channel: 'post', markets: ['US', 'EU'], copy: 'b', claim: 'b' };
    board.startReview(roomA, assetA, { campaignId: 'camp', materialId: 'matA' });
    board.startReview(roomB, assetB, { campaignId: 'camp', materialId: 'matB' });

    // Both materials expect US + EU. File: A=US, A=EU, B=US only.
    board.addReview(roomA, { region: 'US', reviewer: 'US', findings: [], materialId: 'matA' });
    board.addReview(roomA, { region: 'EU', reviewer: 'EU', findings: [], materialId: 'matA' });
    board.addReview(roomB, { region: 'US', reviewer: 'US', findings: [], materialId: 'matB' });

    const reconcile = makeReconcile({ board, expectedRegions: ['US', 'EU'] });

    // Ping reconcile on material A's key: both regions are in -> it must decide.
    await reconcile(recruitMsg(roomA), tools(), { roomId: roomA, agentId: 'rec', agentName: 'Reconcile' });
    expect(board.hasVerdicts(roomA)).toBe(true);

    // Ping reconcile on material B's key: only US is in -> it must NOT decide.
    // This is the proof there is no campaign-wide gate: A finishing did not
    // unblock B, and B being partial did not block A.
    await reconcile(recruitMsg(roomB), tools(), { roomId: roomB, agentId: 'rec', agentName: 'Reconcile' });
    expect(board.hasVerdicts(roomB)).toBe(false);

    // Verdicts on A carry A's material id (findings/verdicts tie to the material).
    const va = board.verdicts(roomA);
    expect(va.length).toBe(2);
  });
});

describe('campaign coordinates flow onto reviews, verdicts, and events', () => {
  it('tags ReviewResult and emitted events with campaignId/materialId', async () => {
    const captured: Array<{ key: string; event: BoardEvent }> = [];
    const board = new SharedBoard((key, event) => captured.push({ key, event }));
    const asset: ContentAsset = { id: 'm1', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' };
    board.startReview('k', asset, { campaignId: 'camp-9', materialId: 'm1', dossier: DOSSIER });
    board.addReview('k', { region: 'US', reviewer: 'US', findings: [], materialId: 'm1' });

    const intake = captured.find((c) => c.event.type === 'intake')!.event;
    expect(intake.campaignId).toBe('camp-9');
    expect(intake.materialId).toBe('m1');
    const review = captured.find((c) => c.event.type === 'review')!.event;
    expect(review.campaignId).toBe('camp-9');
    expect(review.materialId).toBe('m1');
    expect(board.dossier('k')?.substantiation).toContain('DF-2026-07');
    expect(board.materialId('k')).toBe('m1');
  });

  it('emits no campaign ids for a single-asset review (shape unchanged)', () => {
    const captured: BoardEvent[] = [];
    const board = new SharedBoard((_k, e) => captured.push(e));
    const asset: ContentAsset = { id: 'm1', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' };
    board.startReview('k', asset);
    const intake = captured.find((e) => e.type === 'intake')!;
    expect(intake.campaignId).toBeUndefined();
    expect(intake.materialId).toBeUndefined();
    expect(board.dossier('k')).toBeUndefined();
  });
});

describe('store: campaign persistence and legacy back-compat', () => {
  it('saves and reads back a campaign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'camp-store-'));
    try {
      const store = new Store(dir);
      const campaign = Campaign.parse({
        id: 'camp-1',
        name: 'Immune+ Q3',
        markets: ['US'],
        dossier: { approvedClaims: ['x'], substantiation: 's', approvedInfo: '', sources: [] },
        advertisements: [
          { id: 'ad-1', name: 'Hero', materials: [{ id: 'm1', kind: 'post', channel: 'x', markets: ['US'], copy: 'c', claim: 'c' }] },
        ],
      });
      store.saveCampaign(campaign);
      const got = store.getCampaign('camp-1');
      expect(got?.name).toBe('Immune+ Q3');
      expect(got?.advertisements[0]?.id).toBe('ad-1');
      expect(got?.advertisements[0]?.materials[0]?.id).toBe('m1');
      expect(store.listCampaigns().some((c) => c.id === 'camp-1')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a legacy single asset as a one-material campaign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'camp-legacy-'));
    try {
      const store = new Store(dir);
      store.saveAsset({ id: 'legacy-1', name: 'Old Asset', channel: 'post', markets: ['US', 'EU'], copy: 'c', claim: 'c', substantiation: 'on file' });
      const got = store.getCampaign('legacy-1');
      expect(got).toBeDefined();
      expect(got?.advertisements.length).toBe(1);
      expect(got?.advertisements[0]?.id).toBe('default');
      expect(got?.advertisements[0]?.materials.length).toBe(1);
      expect(got?.advertisements[0]?.materials[0]?.kind).toBe('post');
      // the asset's own substantiation carries into the dossier so the cascade has it
      expect(got?.dossier.substantiation).toBe('on file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assetToCampaign helper maps a single asset to a one-material campaign', () => {
    const camp = assetToCampaign({ id: 'a', channel: 'post', markets: ['US'], copy: 'c', claim: 'c' });
    expect(camp.id).toBe('a');
    expect(camp.advertisements[0]?.id).toBe('default');
    expect(camp.advertisements[0]?.materials[0]?.kind).toBe('post');
    expect(Campaign.safeParse(camp).success).toBe(true);
  });

  it('falls back to the bundled sample campaign when the library is empty (first-run demo seed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'camp-seed-'));
    try {
      // The store reads its seed from a sibling assets/ dir, mirroring the repo layout.
      const dataDir = join(root, 'data');
      const assetsDir = join(root, 'assets');
      mkdirSync(dataDir, { recursive: true });
      mkdirSync(assetsDir, { recursive: true });
      cpSync(`${ASSETS}sample-campaign.json`, join(assetsDir, 'sample-campaign.json'));

      const store = new Store(dataDir);
      const seeded = store.listCampaigns();
      expect(seeded.length).toBeGreaterThan(0);
      // The bundled seed parses and carries advertisements with materials (proves the real seed file is valid).
      expect(seeded[0]?.advertisements.length).toBeGreaterThan(0);
      expect(seeded[0]?.advertisements[0]?.materials.length).toBeGreaterThan(0);

      // Once a real campaign is saved, the seed no longer masks the saved library.
      store.saveCampaign(
        Campaign.parse({ id: 'saved-1', name: 'Saved', dossier: {}, advertisements: [] }),
      );
      const after = store.listCampaigns();
      expect(after.some((c) => c.id === 'saved-1')).toBe(true);
      expect(after.some((c) => c.id === seeded[0]?.id && c.id !== 'saved-1')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
