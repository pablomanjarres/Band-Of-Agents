// src/board/pod-board.ts
import type { BandTransport } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import { makeConductor } from '../agents/conductor';
import { makePodLead } from '../agents/pod-lead';
import { makeRegionReviewer } from '../agents/pod-region-reviewer';
import { makeScout, makeClaimEvidence, makePrecedent, makeDisclosure, makeBrandVoice, makeChannel, makeVisual } from '../agents/pod-members';
import { makeMediator } from '../agents/mediator';
import { makeRemediation } from '../agents/pod-remediation';
import { makeRiskAdjudicator } from '../agents/risk-adjudicator';
import { modelFor, imageClientFor } from '../models/route';
import { PodHub } from './pod-hub';

export interface PodBoardModels {
  scout: ModelClient; claim: ModelClient; precedent: ModelClient; disclosure: ModelClient;
  us: ModelClient; eu: ModelClient; latam: ModelClient;
  brand: ModelClient; channel: ModelClient; visual: ModelClient;
  mediator: ModelClient; remediationCopy: ModelClient; image: ModelClient;
}

// Build the per-role clients for the pods cast from the active MODEL_MODE (aiml main / dev).
export function realPodBoardModels(): PodBoardModels {
  return {
    scout: modelFor('scout'), claim: modelFor('claim'), precedent: modelFor('precedent'), disclosure: modelFor('disclosure'),
    us: modelFor('us'), eu: modelFor('eu'), latam: modelFor('latam'),
    brand: modelFor('brand'), channel: modelFor('channel'), visual: modelFor('visual'),
    mediator: modelFor('mediator'), remediationCopy: modelFor('remediation'), image: imageClientFor(),
  };
}

export interface PodBoardConfig {
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: PodBoardModels;
  hostImage?: (url: string) => string;
  logPrecedent?: (p: { claim: string; decision: string; note: string }) => void;
  /** Resolve a human's free-text reference to a saved campaign (for the Conductor). */
  lookupCampaign?: (query: string) => ContentAsset | undefined;
  /** Read the live rulebook per region (UI overrides) so edits apply to the next review. */
  getRulebook?: (region: string) => Rulebook | undefined;
  /** Recent human-ruling precedents fed into the region reviewers' prompts. */
  getPrecedents?: () => string[];
}

// Connects the full pods -> board -> spine cast to any transport (fake or real).
export async function connectPodBoardAgents(t: BandTransport, cfg: PodBoardConfig): Promise<void> {
  const m = cfg.models;
  // Shared in-process data hub: agents keep structured data here and post prose.
  const hub = new PodHub();

  await t.connectAgent({ agentId: 'cond', name: 'Conductor', handle: '@conductor', onMessage: makeConductor({ podLeadHandles: ['@claims-lead', '@reg-lead', '@brand-lead'], primeHandles: ['@remediation'], hub, ...(cfg.lookupCampaign ? { lookupCampaign: cfg.lookupCampaign } : {}) }) });

  // Claims pod
  await t.connectAgent({ agentId: 'claimslead', name: 'Claims Lead', handle: '@claims-lead', onMessage: makePodLead({ pod: 'claims', members: ['@scout', '@claim-evidence', '@precedent', '@disclosure'], memberKeys: ['scout', 'claim-evidence', 'precedent', 'disclosure'], reportToHandle: '@adjudicator', debate: false, hub }) });
  await t.connectAgent({ agentId: 'scout', name: 'Scout', handle: '@scout', onMessage: makeScout(m.scout, hub) });
  await t.connectAgent({ agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence', onMessage: makeClaimEvidence(m.claim, hub) });
  await t.connectAgent({ agentId: 'prec', name: 'Precedent', handle: '@precedent', onMessage: makePrecedent(m.precedent, hub) });
  await t.connectAgent({ agentId: 'disc', name: 'Disclosure', handle: '@disclosure', onMessage: makeDisclosure(m.disclosure, hub) });

  // Regulatory pod (debates)
  await t.connectAgent({ agentId: 'reglead', name: 'Reg Lead', handle: '@reg-lead', onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer', '@latam-reviewer'], memberKeys: ['US', 'EU', 'LATAM'], reportToHandle: '@adjudicator', debate: true, hub }) });
  const precedents = cfg.getPrecedents ? { precedents: cfg.getPrecedents } : {};
  await t.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: cfg.rulebooks.us, brand: cfg.brand, model: m.us, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('US') ?? cfg.rulebooks.us, hub, ...precedents }) });
  await t.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: cfg.rulebooks.eu, brand: cfg.brand, model: m.eu, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('EU') ?? cfg.rulebooks.eu, hub, ...precedents }) });
  await t.connectAgent({ agentId: 'latam', name: 'LATAM Reviewer', handle: '@latam-reviewer', onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: cfg.rulebooks.latam, brand: cfg.brand, model: m.latam, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('LATAM') ?? cfg.rulebooks.latam, hub, ...precedents }) });

  // Brand pod
  await t.connectAgent({ agentId: 'brandlead', name: 'Brand Lead', handle: '@brand-lead', onMessage: makePodLead({ pod: 'brand', members: ['@brand-voice', '@channel', '@visual'], memberKeys: ['brand-voice', 'channel', 'visual'], reportToHandle: '@adjudicator', debate: false, hub }) });
  await t.connectAgent({ agentId: 'bv', name: 'Brand Voice', handle: '@brand-voice', onMessage: makeBrandVoice(m.brand, hub) });
  await t.connectAgent({ agentId: 'ch', name: 'Channel Fit', handle: '@channel', onMessage: makeChannel(m.channel, hub) });
  await t.connectAgent({ agentId: 'vis', name: 'Visual', handle: '@visual', onMessage: makeVisual(m.visual, hub) });

  // Board resolvers
  await t.connectAgent({ agentId: 'med', name: 'Mediator', handle: '@mediator', onMessage: makeMediator({ model: m.mediator, reportToHandle: '@adjudicator' }) });
  await t.connectAgent({ agentId: 'rem', name: 'Remediation', handle: '@remediation', onMessage: makeRemediation({ brand: cfg.brand, copyModel: m.remediationCopy, imageModel: m.image, reportToHandle: '@conductor', podHub: hub, ...(cfg.hostImage ? { hostImage: cfg.hostImage } : {}) }) });

  // Decision spine
  await t.connectAgent({ agentId: 'adj', name: 'Risk Adjudicator', handle: '@adjudicator', onMessage: makeRiskAdjudicator({ expectedPods: ['claims', 'regulatory', 'brand'], mediatorHandle: '@mediator', remediationHandle: '@remediation', humanHandle: '@compliance-lead', maxRecommits: 1, ...(cfg.logPrecedent ? { logPrecedent: cfg.logPrecedent } : {}) }) });
}
