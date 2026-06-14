import { describe, expect, it } from 'vitest';
import { makeCoordinator } from '../src/agents/coordinator';
import { makeReconcile } from '../src/agents/reconcile';
import { nameMatchesHandle } from '../src/agents/handles';
import type { ContentAsset } from '../src/domain/types';
import type { Participant, RoomMessage, RoomTools } from '../src/band/types';
import { probeBoard } from './helpers';

// The band.ai SDK can only post as an agent, so room mode routes the asset and
// the human ruling through one intake/proxy agent. These tests pin the opt-in
// acceptance (and the local-mode default: agent posts stay ignored).

function mockTools(participants: Participant[]): {
  tools: RoomTools;
  sent: { messages: string[]; events: { content: string; type: string }[] };
} {
  const sent = { messages: [] as string[], events: [] as { content: string; type: string }[] };
  const tools: RoomTools = {
    capabilities: { peers: false, contacts: false, memory: false },
    sendMessage: async (content) => {
      sent.messages.push(content);
    },
    sendEvent: async (content, messageType) => {
      sent.events.push({ content, type: messageType });
    },
    getParticipants: async () => participants,
    addParticipant: async () => {},
    lookupPeers: async () => participants,
  };
  return { tools, sent };
}

function msg(partial: Partial<RoomMessage>): RoomMessage {
  return {
    id: 'm',
    roomId: 'r',
    content: '',
    senderId: 's',
    senderType: 'agent',
    senderName: null,
    messageType: 'chat',
    mentions: [],
    metadata: {},
    createdAt: new Date(),
    ...partial,
  };
}

const ASSET = JSON.stringify({ id: 'a1', channel: 'post', markets: ['EU'], copy: 'c', claim: 'c' });
const EU_ASSET: ContentAsset = { id: 'a1', channel: 'post', markets: ['EU'], copy: 'c', claim: 'c' };
const INTAKE = '@pablomanjarres/intake';

describe('band.ai room-mode opt-in tweaks', () => {
  it('nameMatchesHandle matches a handle last segment against a sender name', () => {
    expect(nameMatchesHandle('Intake', INTAKE)).toBe(true);
    expect(nameMatchesHandle('@pablomanjarres/intake', INTAKE)).toBe(true);
    expect(nameMatchesHandle('US Reviewer', INTAKE)).toBe(false);
    expect(nameMatchesHandle(null, INTAKE)).toBe(false);
  });

  it('coordinator accepts an asset from the configured intake agent and forwards it', async () => {
    const participants: Participant[] = [
      { id: 'coord', name: 'Coordinator', handle: '@coordinator', type: 'agent' },
      { id: 'us', name: 'US Reviewer', handle: '@us', type: 'agent' },
      { id: 'intake', name: 'Intake', handle: '@intake', type: 'agent' },
    ];
    const { tools, sent } = mockTools(participants);
    const { board } = probeBoard();
    const handler = makeCoordinator({ board, intakeAgentHandle: INTAKE });
    await handler(msg({ senderName: 'Intake', senderId: 'intake', content: ASSET }), tools, { roomId: 'r', agentId: 'coord', agentName: 'Coordinator' });
    expect(sent.messages.length).toBe(1);
    expect(sent.events.some((e) => e.type === 'intake')).toBe(true);
    // the recruit goes to the reviewer; the intake relay is excluded from it.
    expect(sent.messages[0]).toContain('@us');
    expect(sent.messages[0]!.toLowerCase()).not.toContain('intake');
  });

  it('coordinator without intake config still ignores agent posts (local-mode default)', async () => {
    const participants: Participant[] = [
      { id: 'coord', name: 'Coordinator', handle: '@coordinator', type: 'agent' },
      { id: 'us', name: 'US Reviewer', handle: '@us', type: 'agent' },
    ];
    const { tools, sent } = mockTools(participants);
    const { board } = probeBoard();
    const handler = makeCoordinator({ board });
    await handler(msg({ senderName: 'Intake', senderId: 'intake', content: ASSET }), tools, { roomId: 'r', agentId: 'coord', agentName: 'Coordinator' });
    expect(sent.messages.length).toBe(0);
  });

  it('reconcile accepts a human ruling relayed by the proxy agent after an escalation', async () => {
    const participants: Participant[] = [
      { id: 'coord', name: 'Coordinator', handle: '@coordinator', type: 'agent' },
      { id: 'lead', name: 'Lead', handle: '@compliance-lead', type: 'user' },
      { id: 'intake', name: 'Intake', handle: '@intake', type: 'agent' },
    ];
    const { tools, sent } = mockTools(participants);
    const precedents: { decision: string }[] = [];
    const { board } = probeBoard();
    // The campaign and the EU review live on the board; reconcile reads them there.
    board.startReview('r', EU_ASSET);
    board.addReview('r', {
      region: 'EU',
      reviewer: 'EU',
      findings: [{ category: 'health_claim', severity: 'block', claim: 'x', rationale: 'unauthorised', ruleId: 'eu-health-preauth' }],
    });
    const handler = makeReconcile({
      board,
      expectedRegions: ['EU'],
      coordinatorHandle: '@coordinator',
      humanHandle: '@compliance-lead',
      humanProxyHandle: INTAKE,
      logPrecedent: (p) => precedents.push({ decision: p.decision }),
    });

    // The EU reviewer's plain-English report triggers reconcile; the finding is read off the board.
    await handler(msg({ senderName: 'EU Reviewer', senderId: 'eu', content: 'EU is blocking on an unauthorised health claim.' }), tools, { roomId: 'r', agentId: 'rec', agentName: 'Reconcile' });
    expect(sent.events.some((e) => e.type === 'escalation')).toBe(true);

    await handler(msg({ senderName: 'Intake', senderId: 'intake', content: 'Reject EU.' }), tools, { roomId: 'r', agentId: 'rec', agentName: 'Reconcile' });
    expect(precedents).toEqual([{ decision: 'Reject EU.' }]);
    expect(sent.events.some((e) => e.type === 'decision')).toBe(true);
  });
});
