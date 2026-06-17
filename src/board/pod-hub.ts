// src/board/pod-hub.ts
// In-process shared data hub for the pods topology. Every pod agent runs in one
// process (connectPodBoardAgents on one transport), so they keep their structured
// data here, keyed by roomId, and post only plain English to the room. This keeps
// the Band chat readable instead of a stream of raw JSON payloads.

import type { ContentAsset, Finding } from '../domain/types';
import type { ConflictItem, MediationResult, PodFinding } from '../domain/board';

export interface PodChallenge {
  claim: string;
  peerRegion: string;
  peerRationale: string;
}

/** One market-tailored version produced when regulations collide irreconcilably. */
export interface SplitVersion {
  region: string;
  copy: string;
  imageUrl?: string;
}

interface RoomState {
  asset?: ContentAsset;
  findings: Map<string, Finding[]>; // source/region key -> findings
  podFindings: Map<string, PodFinding>; // pod -> consolidated finding
  conflicts: ConflictItem[];
  mediation?: MediationResult;
  challenges: Map<string, PodChallenge>; // region -> pending challenge
  revised?: ContentAsset;
  // Market-split: the per-market plan the Adjudicator hands Remediation, and the
  // tailored versions Remediation hands back, when one shared version is impossible.
  splitPlan?: { region: string; findings: Finding[] }[];
  splitVersions?: SplitVersion[];
}

export class PodHub {
  private readonly rooms = new Map<string, RoomState>();

  private state(roomId: string): RoomState {
    let s = this.rooms.get(roomId);
    if (!s) {
      s = { findings: new Map(), podFindings: new Map(), conflicts: [], challenges: new Map() };
      this.rooms.set(roomId, s);
    }
    return s;
  }

  // Asset under review (set by the conductor; read by leads, members, remediation).
  setAsset(roomId: string, asset: ContentAsset): void { this.state(roomId).asset = asset; }
  asset(roomId: string): ContentAsset | undefined { return this.state(roomId).asset; }

  // Member findings, keyed by the member's source/region.
  setFinding(roomId: string, key: string, findings: Finding[]): void { this.state(roomId).findings.set(key, findings); }
  finding(roomId: string, key: string): Finding[] { return this.state(roomId).findings.get(key) ?? []; }

  // A pod's consolidated finding (set by the lead; read by the adjudicator).
  setPodFinding(roomId: string, pod: string, pf: PodFinding): void { this.state(roomId).podFindings.set(pod, pf); }
  podFinding(roomId: string, pod: string): PodFinding | undefined { return this.state(roomId).podFindings.get(pod); }
  clearPodFindings(roomId: string): void { this.state(roomId).podFindings.clear(); }

  // Conflicts handed to the mediator, and the mediation result handed back.
  setConflicts(roomId: string, conflicts: ConflictItem[]): void { this.state(roomId).conflicts = conflicts; }
  conflicts(roomId: string): ConflictItem[] { return this.state(roomId).conflicts; }
  setMediation(roomId: string, m: MediationResult | undefined): void { this.state(roomId).mediation = m; }
  mediation(roomId: string): MediationResult | undefined { return this.state(roomId).mediation; }

  // A pending debate challenge for a region, read by the region reviewer.
  setChallenge(roomId: string, region: string, c: PodChallenge): void { this.state(roomId).challenges.set(region, c); }
  challenge(roomId: string, region: string): PodChallenge | undefined { return this.state(roomId).challenges.get(region); }
  clearChallenge(roomId: string, region: string): void { this.state(roomId).challenges.delete(region); }

  // Remediation's rewritten asset, read by the conductor on the recommit loop.
  setRevised(roomId: string, revised: ContentAsset): void { this.state(roomId).revised = revised; }
  revised(roomId: string): ContentAsset | undefined { return this.state(roomId).revised; }

  // Market-split plan (Adjudicator -> Remediation): one entry per blocking market.
  setSplitPlan(roomId: string, plan: { region: string; findings: Finding[] }[] | undefined): void { this.state(roomId).splitPlan = plan; }
  splitPlan(roomId: string): { region: string; findings: Finding[] }[] | undefined { return this.state(roomId).splitPlan; }

  // Tailored per-market versions (Remediation -> Adjudicator).
  setSplitVersions(roomId: string, versions: SplitVersion[] | undefined): void { this.state(roomId).splitVersions = versions; }
  splitVersions(roomId: string): SplitVersion[] | undefined { return this.state(roomId).splitVersions; }
}
