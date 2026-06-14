// Local end-to-end demo of the pods -> board -> spine topology on the in-process
// fake transport. Runs the whole deliberation with stub models (no API keys):
// the Conductor fans the asset to three pods, the Regulatory pod debates (US
// passes, EU blocks and holds on rebuttal), each pod files one PodFinding, the
// Risk Adjudicator consults the Mediator, runs one remediation cycle that still
// fails, escalates to the human, and the human reject yields a terminal spiked.
// Swap in the real Band transport and real model clients (pnpm agents) once
// credentials are wired.
//
//   pnpm local

import { FakeBandTransport } from '../band/fake';
import { connectPodBoardAgents, type PodBoardModels } from '../board/pod-board';
import { translateActivity } from '../board/events';
import { StubModelClient, type ModelClient } from '../models/client';
import { loadAsset, loadBrandDna, loadRulebook } from '../domain/load';

const ASSETS = new URL('../../assets/', import.meta.url).pathname;

function findings(severity: 'block' | 'warn' | 'info', claim: string): { text: string; json: { findings: unknown[] } } {
  return { text: '', json: { findings: [{ category: 'claim', severity, claim, rationale: 'r' }] } };
}

async function main(): Promise<void> {
  const brand = loadBrandDna(`${ASSETS}brand-dna.json`);
  const usRules = loadRulebook(`${ASSETS}rulebook.us.json`);
  const euRules = loadRulebook(`${ASSETS}rulebook.eu.json`);
  const latamRules = loadRulebook(`${ASSETS}rulebook.latam.json`);
  const asset = loadAsset(`${ASSETS}sample-asset.json`);
  const claim = asset.claim;

  // Stub models so the full debate runs with no keys. Real runs route through
  // AIML (main) or Bedrock/Vertex/Featherless (dev) via the ModelClient seam.
  const pass: ModelClient = new StubModelClient(() => findings('info', claim));
  const empty: ModelClient = new StubModelClient(() => ({ text: '', json: { findings: [] } }));
  // EU blocks on review, then holds on rebuttal: a two-phase model keyed on call count.
  let euCall = 0;
  const euModel: ModelClient = new StubModelClient(() => (euCall++ % 2 === 0
    ? findings('block', claim)
    : { text: '', json: { stance: 'hold', rationale: 'unlawful' } }));
  const mediator: ModelClient = new StubModelClient(() => ({ text: '', json: { resolved: false, note: 'no movement', requiredDisclosure: null } }));
  const revised: ModelClient = new StubModelClient(() => ({ text: JSON.stringify({ ...asset, copy: 'softened' }) }));
  const image: ModelClient = { model: 'stub-image', complete: async () => ({ text: '' }), generateImage: async () => ({ url: 'https://cdn.aimlapi.com/lumavida.png' }) };

  const models: PodBoardModels = {
    scout: empty, claim: empty, precedent: empty, disclosure: empty,
    us: pass, eu: euModel, latam: pass,
    brand: empty, channel: empty, visual: empty,
    mediator, remediationCopy: revised, image,
  };

  const room = new FakeBandTransport('demo-room', {
    onActivity: (a) => {
      const e = translateActivity(a);
      if (e) console.log(`  [event] ${e.type} (${a.fromName}): ${a.content}`);
    },
  });
  room.addUser('lead', 'Compliance Lead', '@compliance-lead');
  await connectPodBoardAgents(room, { brand, rulebooks: { us: usRules, eu: euRules, latam: latamRules }, models });

  console.log(`\n# Pods -> board -> spine review (local fake-Band demo, NOT legal advice)`);
  console.log(`# Asset: ${asset.id}; markets US/EU/LATAM + brand consistency\n`);

  room.post('lead', JSON.stringify(asset), [{ id: 'cond' }]);
  await room.drain();

  room.post('lead', 'Reject: cannot publish in EU without authorization. US may publish with the typical-results disclosure.', [{ id: 'adj' }]);
  await room.drain();

  printTranscript(room);
}

function printTranscript(room: FakeBandTransport): void {
  console.log('\n--- room transcript ---');
  for (const t of room.transcript) {
    if (t.kind === 'event') {
      console.log(`  · ${t.fromName} (${t.messageType}): ${t.content}`);
    } else {
      const to = t.mentions.map((m) => m.handle ?? m.id).join(', ');
      const body = t.content.length > 150 ? `${t.content.slice(0, 150)}…` : t.content;
      console.log(`→ ${t.fromName} -> [${to}]: ${body}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
