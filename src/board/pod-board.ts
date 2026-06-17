// src/board/pod-board.ts
import type { BandTransport } from '../band/types';
import type { ModelClient } from '../models/client';
import type { BrandDna, ContentAsset, Rulebook } from '../domain/types';
import type { NewArtifact } from '../domain/artifact';
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
  hostImage?: (url: string) => string | Promise<string>;
  /** Publish a report/artifact and get back a viewer URL the Adjudicator links in chat. */
  publishArtifact?: (input: NewArtifact) => { id: string; url: string } | Promise<{ id: string; url: string }>;
  logPrecedent?: (p: { claim: string; decision: string; note: string }) => void;
  /** Resolve a human's free-text reference to a saved campaign (for the Conductor). */
  lookupCampaign?: (query: string) => (ContentAsset | undefined) | Promise<ContentAsset | undefined>;
  /** Resolve a campaign / advertisement to its materials so the Conductor reviews each in turn. */
  lookupMaterials?: (query: string) => Promise<{ name: string; materials: ContentAsset[] } | undefined> | ({ name: string; materials: ContentAsset[] } | undefined);
  /** Ms the Conductor waits after self-assembling the cast before the first dispatch (live: ~9000; tests: 0). */
  settleMs?: number;
  /** Read the live rulebook per region (UI overrides) so edits apply to the next review. */
  getRulebook?: (region: string) => Rulebook | undefined;
  /** Recent human-ruling precedents fed into the region reviewers' prompts. */
  getPrecedents?: () => string[];
  /**
   * Compact cast: collapse the Claims and Brand pods to a single solo reviewer each
   * (one agent that reviews and files its pod finding), keeping the Regulatory pod's
   * debate multi-agent. Takes the cast from 17 agents to 10, to fit a smaller Band.ai
   * room. Default is the full cast.
   */
  compact?: boolean;
}

// Findings schema for the solo (compact) pod reviewers.
const FINDINGS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'claim', 'rationale'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'] },
          claim: { type: 'string' },
          rationale: { type: 'string' },
          ruleId: { type: 'string' },
          requiredDisclosure: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

// One solo reviewer carries the whole Claims pod's concerns: evidence, precedent,
// and required disclosures.
const CLAIMS_SOLO_SYSTEM = [
  'You are the Claims reviewer for a marketing-compliance board. This is a demo, NOT legal advice.',
  'Check every claim in the asset against its own evidence: flag claims unsupported by the asset substantiation, claims that need a disclosure (put the exact disclosure text in requiredDisclosure), and note relevant precedent as info findings. Quote the exact offending claim span.',
  'Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?,"requiredDisclosure"?}]}. If every claim is supported, return {"findings":[]}.',
].join('\n\n');

// One solo reviewer carries the whole Brand pod's concerns: voice, channel, visual.
const brandSoloSystem = (brand: BrandDna): string =>
  [
    'You are the Brand reviewer for a marketing-compliance board.',
    `Check the asset against the brand DNA: off-voice or forbidden phrasing, channel and format fit, and visual/image compliance. Brand voice: ${brand.voice.join(', ')}. Forbidden phrases: ${brand.forbiddenPhrases.join(', ')}. Quote the exact offending span.`,
    'Return JSON {"findings":[{"category","severity":"block"|"warn"|"info","claim","rationale","ruleId"?}]}. If on-brand, return {"findings":[]}.',
  ].join('\n\n');

// Connects the full pods -> board -> spine cast to any transport (fake or real).
export async function connectPodBoardAgents(t: BandTransport, cfg: PodBoardConfig): Promise<void> {
  const m = cfg.models;
  // Shared in-process data hub: agents keep structured data here and post prose.
  const hub = new PodHub();

  // The full cast minus the Conductor itself. On kickoff the Conductor pulls any of
  // these not already present into the room (add_participant), so a human only adds
  // the Conductor and posts; it self-assembles the rest.
  // Exact registered agent NAMES (add_participant resolves by name, not handle).
  const ensureAgents = cfg.compact
    ? ['Claims Lead', 'Regulatory Lead', 'US Reviewer', 'EU Reviewer', 'LATAM Reviewer', 'Brand Lead', 'Mediator', 'Remediation', 'Adjudicator']
    : ['Claims Lead', 'Scout', 'Claim Evidence', 'Precedent', 'Disclosure', 'Regulatory Lead', 'US Reviewer', 'EU Reviewer', 'LATAM Reviewer', 'Brand Lead', 'Brand Voice', 'Channel Fit', 'Visual', 'Mediator', 'Remediation', 'Adjudicator'];
  await t.connectAgent({ agentId: 'cond', name: 'Conductor', handle: '@conductor', onMessage: makeConductor({ podLeadHandles: ['@claims-lead', '@reg-lead', '@brand-lead'], primeHandles: ['@remediation'], hub, ensureAgents, ...(cfg.lookupCampaign ? { lookupCampaign: cfg.lookupCampaign } : {}), ...(cfg.lookupMaterials ? { lookupMaterials: cfg.lookupMaterials } : {}), ...(cfg.settleMs !== undefined ? { settleMs: cfg.settleMs } : {}) }) });

  // Claims pod: full (lead + 4 members) or, when compact, one solo reviewer.
  if (cfg.compact) {
    await t.connectAgent({ agentId: 'claimslead', name: 'Claims Reviewer', handle: '@claims-lead', onMessage: makePodLead({ pod: 'claims', members: [], memberKeys: [], reportToHandle: '@adjudicator', debate: false, hub, solo: { model: m.claim, system: CLAIMS_SOLO_SYSTEM, jsonSchema: FINDINGS_JSON_SCHEMA } }) });
  } else {
    await t.connectAgent({ agentId: 'claimslead', name: 'Claims Lead', handle: '@claims-lead', onMessage: makePodLead({ pod: 'claims', members: ['@scout', '@claim-evidence', '@precedent', '@disclosure'], memberKeys: ['scout', 'claim-evidence', 'precedent', 'disclosure'], reportToHandle: '@adjudicator', debate: false, hub }) });
    await t.connectAgent({ agentId: 'scout', name: 'Scout', handle: '@scout', onMessage: makeScout(m.scout, hub) });
    await t.connectAgent({ agentId: 'ce', name: 'Claim & Evidence', handle: '@claim-evidence', onMessage: makeClaimEvidence(m.claim, hub) });
    await t.connectAgent({ agentId: 'prec', name: 'Precedent', handle: '@precedent', onMessage: makePrecedent(m.precedent, hub) });
    await t.connectAgent({ agentId: 'disc', name: 'Disclosure', handle: '@disclosure', onMessage: makeDisclosure(m.disclosure, hub) });
  }

  // Regulatory pod (debates)
  await t.connectAgent({ agentId: 'reglead', name: 'Reg Lead', handle: '@reg-lead', onMessage: makePodLead({ pod: 'regulatory', members: ['@us-reviewer', '@eu-reviewer', '@latam-reviewer'], memberKeys: ['US', 'EU', 'LATAM'], reportToHandle: '@adjudicator', debate: true, hub }) });
  const precedents = cfg.getPrecedents ? { precedents: cfg.getPrecedents } : {};
  await t.connectAgent({ agentId: 'us', name: 'US Reviewer', handle: '@us-reviewer', onMessage: makeRegionReviewer({ region: 'US', reviewerName: 'US Reviewer', rulebook: cfg.rulebooks.us, brand: cfg.brand, model: m.us, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('US') ?? cfg.rulebooks.us, hub, ...precedents }) });
  await t.connectAgent({ agentId: 'eu', name: 'EU Reviewer', handle: '@eu-reviewer', onMessage: makeRegionReviewer({ region: 'EU', reviewerName: 'EU Reviewer', rulebook: cfg.rulebooks.eu, brand: cfg.brand, model: m.eu, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('EU') ?? cfg.rulebooks.eu, hub, ...precedents }) });
  await t.connectAgent({ agentId: 'latam', name: 'LATAM Reviewer', handle: '@latam-reviewer', onMessage: makeRegionReviewer({ region: 'LATAM', reviewerName: 'LATAM Reviewer', rulebook: cfg.rulebooks.latam, brand: cfg.brand, model: m.latam, reportToHandle: '@reg-lead', getRulebook: () => cfg.getRulebook?.('LATAM') ?? cfg.rulebooks.latam, hub, ...precedents }) });

  // Brand pod: full (lead + 3 members) or, when compact, one solo reviewer.
  if (cfg.compact) {
    await t.connectAgent({ agentId: 'brandlead', name: 'Brand Reviewer', handle: '@brand-lead', onMessage: makePodLead({ pod: 'brand', members: [], memberKeys: [], reportToHandle: '@adjudicator', debate: false, hub, solo: { model: m.brand, system: brandSoloSystem(cfg.brand), jsonSchema: FINDINGS_JSON_SCHEMA } }) });
  } else {
    await t.connectAgent({ agentId: 'brandlead', name: 'Brand Lead', handle: '@brand-lead', onMessage: makePodLead({ pod: 'brand', members: ['@brand-voice', '@channel', '@visual'], memberKeys: ['brand-voice', 'channel', 'visual'], reportToHandle: '@adjudicator', debate: false, hub }) });
    await t.connectAgent({ agentId: 'bv', name: 'Brand Voice', handle: '@brand-voice', onMessage: makeBrandVoice(m.brand, hub) });
    await t.connectAgent({ agentId: 'ch', name: 'Channel Fit', handle: '@channel', onMessage: makeChannel(m.channel, hub) });
    await t.connectAgent({ agentId: 'vis', name: 'Visual', handle: '@visual', onMessage: makeVisual(m.visual, hub) });
  }

  // Board resolvers
  await t.connectAgent({ agentId: 'med', name: 'Mediator', handle: '@mediator', onMessage: makeMediator({ model: m.mediator, reportToHandle: '@adjudicator', hub }) });
  await t.connectAgent({ agentId: 'rem', name: 'Remediation', handle: '@remediation', onMessage: makeRemediation({ brand: cfg.brand, copyModel: m.remediationCopy, imageModel: m.image, reportToHandle: '@conductor', podHub: hub, ...(cfg.hostImage ? { hostImage: cfg.hostImage } : {}) }) });

  // Decision spine
  await t.connectAgent({ agentId: 'adj', name: 'Risk Adjudicator', handle: '@adjudicator', onMessage: makeRiskAdjudicator({ expectedPods: ['claims', 'regulatory', 'brand'], mediatorHandle: '@mediator', remediationHandle: '@remediation', humanHandle: '@compliance-lead', maxRecommits: 1, hub, notifyHandle: '@conductor', ...(cfg.logPrecedent ? { logPrecedent: cfg.logPrecedent } : {}), ...(cfg.publishArtifact ? { publishArtifact: cfg.publishArtifact } : {}) }) });
}
