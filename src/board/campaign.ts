// Campaign session: runs a whole Campaign as MANY concurrent per-material
// reviews, never a sequential pipeline. Each material gets its own BoardSession
// under the board key `${roomId}::${materialId}`, carrying the shared campaign
// dossier and the campaign/material ids. Because the board, reviewer, reconcile,
// and remediation already key off a single string, every material negotiates the
// full US/EU/LATAM/BRAND + reconcile + remediation debate independently and in
// parallel: material B can reach a verdict while material A is still mid-review.
//
// THE ONE RULE: there is no campaign-wide gate. The only aggregation is the
// observational rollup computed AFTER each material reaches a terminal state
// (worst-case per region + the full material x region matrix). It blocks nothing.

import { BoardSession, type BoardModels } from './session';
import type { BoardEvent } from './events';
import type { Precedent } from '../agents/reconcile';
import type { BrandDna, Campaign, Material, RegionVerdict, Rulebook } from '../domain/types';

export interface CampaignSessionOptions {
  /** Room/campaign identifier; each material runs under `${roomId}::${materialId}`. */
  roomId: string;
  campaign: Campaign;
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: BoardModels;
  /** Every per-material event flows through here already tagged with campaignId/materialId. */
  onEvent: (event: BoardEvent) => void;
  onPrecedent?: (precedent: Precedent) => void;
  hostImage?: (url: string) => string;
  getPrecedents?: () => string[];
}

/** Worst-case decision per region across all materials, for the campaign badge. */
export interface RollupRegion {
  region: string;
  decision: RegionVerdict['decision'];
}

/** One cell of the material x region matrix. */
export interface RollupCell {
  materialId: string;
  region: string;
  decision: RegionVerdict['decision'];
  rationale: string;
}

/** The observational campaign rollup. It is derived, never a gate. */
export interface CampaignRollup {
  campaignId: string;
  /** Worst-case per region across every material (block beats adapt beats publish). */
  worstCaseByRegion: RollupRegion[];
  /** The full material x region verdict matrix. */
  matrix: RollupCell[];
  /** Per-material terminal verdicts, in completion order. */
  perMaterial: Array<{ materialId: string; verdicts: RegionVerdict[] }>;
}

// publish is clear; adapt and escalate are progressively "worse". Worst-case per
// region takes the highest rank seen for that region across all materials.
const DECISION_RANK: Record<RegionVerdict['decision'], number> = {
  publish: 0,
  adapt: 1,
  escalate: 2,
};

function worse(a: RegionVerdict['decision'], b: RegionVerdict['decision']): RegionVerdict['decision'] {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/** Fold per-material verdicts into the observational rollup (worst-case + matrix). */
export function computeRollup(
  campaignId: string,
  perMaterial: Array<{ materialId: string; verdicts: RegionVerdict[] }>,
): CampaignRollup {
  const worst = new Map<string, RegionVerdict['decision']>();
  const matrix: RollupCell[] = [];
  for (const { materialId, verdicts } of perMaterial) {
    for (const v of verdicts) {
      matrix.push({ materialId, region: v.region, decision: v.decision, rationale: v.rationale });
      const prior = worst.get(v.region);
      worst.set(v.region, prior ? worse(prior, v.decision) : v.decision);
    }
  }
  const worstCaseByRegion = [...worst.entries()].map(([region, decision]) => ({ region, decision }));
  return { campaignId, worstCaseByRegion, matrix, perMaterial };
}

/**
 * Run every material in a campaign concurrently. Returns when all materials have
 * reached a terminal state (complete / awaiting-decision / error), with the
 * computed rollup. Materials that escalate stop at awaiting-decision; the caller
 * can drive each material's decision via submitDecision(materialId, text).
 */
export class CampaignSession {
  private readonly sessions = new Map<string, BoardSession>();
  // Latest verdicts seen per material (a re-review replaces the prior round).
  private readonly verdictsByMaterial = new Map<string, RegionVerdict[]>();
  // Completion order, so the rollup and demo read deterministically.
  private readonly completionOrder: string[] = [];

  constructor(private readonly opts: CampaignSessionOptions) {}

  /** The material ids that will be reviewed, in declared order. */
  materialIds(): string[] {
    return this.opts.campaign.materials.map((m) => m.id);
  }

  /** Start one BoardSession per material and await them all (concurrently). */
  async run(): Promise<CampaignRollup> {
    const { campaign, roomId, brand, rulebooks, models } = this.opts;
    const runs = campaign.materials.map((material) => this.runMaterial(roomId, campaign, material, brand, rulebooks, models));
    await Promise.all(runs);
    return this.rollup();
  }

  private runMaterial(
    roomId: string,
    campaign: Campaign,
    material: Material,
    brand: BrandDna,
    rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook },
    models: BoardModels,
  ): Promise<void> {
    const session = new BoardSession({
      roomId: `${roomId}::${material.id}`,
      asset: material,
      brand,
      rulebooks,
      models,
      onEvent: (e) => this.onMaterialEvent(material.id, e),
      ...(this.opts.onPrecedent ? { onPrecedent: this.opts.onPrecedent } : {}),
      ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}),
      ...(this.opts.getPrecedents ? { getPrecedents: this.opts.getPrecedents } : {}),
      campaign: { campaignId: campaign.id, materialId: material.id, dossier: campaign.dossier },
    });
    this.sessions.set(material.id, session);
    return session.run();
  }

  // Tag-and-forward every per-material event, and snapshot verdicts/completion so
  // the rollup can be computed without re-reading the board.
  private onMaterialEvent(materialId: string, event: BoardEvent): void {
    if (event.type === 'verdict') this.verdictsByMaterial.set(materialId, event.verdicts);
    if (event.type === 'status' && event.status !== 'running' && !this.completionOrder.includes(materialId)) {
      this.completionOrder.push(materialId);
    }
    // The event already carries campaignId/materialId (stamped by the board), so
    // the consumer can route it to the right material lane with no extra work.
    this.opts.onEvent(event);
  }

  /** Record a human ruling on one material's escalation. */
  async submitDecision(materialId: string, text: string): Promise<void> {
    const session = this.sessions.get(materialId);
    if (!session) return;
    await session.submitDecision(text);
  }

  /** The observational rollup over the verdicts seen so far. */
  rollup(): CampaignRollup {
    const ordered = this.completionOrder.filter((id) => this.verdictsByMaterial.has(id));
    const seen = new Set(ordered);
    for (const id of this.verdictsByMaterial.keys()) if (!seen.has(id)) ordered.push(id);
    const perMaterial = ordered.map((materialId) => ({ materialId, verdicts: this.verdictsByMaterial.get(materialId) ?? [] }));
    return computeRollup(this.opts.campaign.id, perMaterial);
  }
}
