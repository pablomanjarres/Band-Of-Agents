// src/agents/pod-members.ts
// Pod members and board specialists, all configs over the knowledge-source shell.
import type { AgentHandler } from '../band/types';
import type { ModelClient } from '../models/client';
import { makeKnowledgeSource } from './knowledge-source';
import { SCOUT_OUTPUT_JSON_SCHEMA } from '../domain/board';

// Shared output schema for finding-producing members.
export const FINDINGS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'] },
          claim: { type: 'string' },
          rationale: { type: 'string' },
          ruleId: { type: 'string' },
          requiredDisclosure: { type: ['string', 'null'] },
        },
        required: ['category', 'severity', 'claim', 'rationale'],
      },
    },
  },
  required: ['findings'],
} as const;

// Claims pod ------------------------------------------------------------
export const makeScout = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'scout', reviewerName: 'Scout', model, reportToHandle, eventType: 'workitem',
    jsonSchema: SCOUT_OUTPUT_JSON_SCHEMA,
    system: 'You are the Scout. Read the marketing asset and extract the discrete risky surfaces (factual or efficacy claims, comparative claims, calls to action, the image) as work-items. Return JSON { workItems: [{ id, kind, text, surfaces }] }.',
  });

export const makeClaimEvidence = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'claim-evidence', reviewerName: 'Claim & Evidence', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Claim & Evidence reviewer. For each factual or efficacy claim, decide if it is substantiated by the asset\'s evidence. Flag unsupported claims as a finding with severity "warn" and rationale demanding a source. Return JSON { findings: [...] }. This is not legal advice.',
  });

export const makePrecedent = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'precedent', reviewerName: 'Precedent Librarian', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Precedent Librarian. Attach any relevant prior ruling to the claims as informational findings (category "precedent", severity "info"). Return JSON { findings: [...] }.',
  });

export const makeDisclosure = (model: ModelClient, reportToHandle = '@claims-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'disclosure', reviewerName: 'Disclosure Drafter', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Disclosure Drafter. If a claim requires a mandatory disclosure (for example a typical-results statement or an EU Article 10(2) accompanying statement), produce a finding with severity "info", category "disclosure", and the exact required text in requiredDisclosure. Return JSON { findings: [...] }.',
  });

// Brand pod -------------------------------------------------------------
export const makeBrandVoice = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'brand-voice', reviewerName: 'Brand Voice', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Brand Voice reviewer. Flag copy that is off-voice or uses forbidden phrasing as findings (severity "warn"). Keep the asset bold and on-brand. Return JSON { findings: [...] }.',
  });

export const makeChannel = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'channel', reviewerName: 'Channel Fit', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    system: 'You are the Channel Fit reviewer. Check hook, length, and format against the asset\'s channel norms. Flag misfits as findings (severity "warn"). Return JSON { findings: [...] }.',
  });

export const makeVisual = (model: ModelClient, reportToHandle = '@brand-lead'): AgentHandler =>
  makeKnowledgeSource({
    role: 'visual', reviewerName: 'Visual / Image', model, reportToHandle,
    jsonSchema: FINDINGS_JSON_SCHEMA,
    images: (a) => (a.imageUrl ? [a.imageUrl] : []),
    system: 'You are the Visual reviewer. When the campaign image is attached, review the actual image for brand fit and visual compliance; otherwise assess the intended image from imagePrompt. Flag issues as findings. Return JSON { findings: [...] }.',
  });
