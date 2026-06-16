// Campaign session: runs a whole Campaign as MANY concurrent per-material
// reviews, never a sequential pipeline. A Campaign holds Advertisements; each
// Advertisement holds Materials. Every material (across every advertisement) gets
// its own BoardSession under the board key `${roomId}::${adId}::${materialId}`,
// carrying the shared campaign dossier and the campaign / advertisement / material
// ids. Because the board, reviewer, reconcile, and remediation already key off a
// single string, every material negotiates the full US/EU/LATAM/BRAND + reconcile
// + remediation debate independently and in parallel: a material in advertisement
// B can reach a verdict while a material in advertisement A is still mid-review.
//
// THE ONE RULE: there is no advertisement-wide or campaign-wide gate. Reconcile
// fires per material (per board key). The only aggregation is the observational
// rollup computed AFTER each material reaches a terminal state: worst-case per
// region per advertisement, the per-ad material x region matrix, and the same
// rolled up across the whole campaign. It blocks nothing.

import { BoardSession, type BoardModels } from './session';
import type { BoardEvent } from './events';
import type { Precedent } from '../agents/reconcile';
import type { ModelClient, SttClient } from '../models/client';
import type { Advertisement, BrandDna, Campaign, Material, RegionVerdict, Rulebook } from '../domain/types';

export interface CampaignSessionOptions {
  /** Room/campaign identifier; each material runs under `${roomId}::${adId}::${materialId}`. */
  roomId: string;
  campaign: Campaign;
  /**
   * Optional scope: when set, the session reviews ONLY this advertisement's
   * materials (still one concurrent per-material BoardSession each, still no
   * gate). When unset, every advertisement's materials are reviewed (the default,
   * unchanged). A scoped run simply has fewer materials in flight; the rollup then
   * naturally covers just this advertisement.
   */
  advertisementId?: string;
  brand: BrandDna;
  rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook };
  models: BoardModels;
  /** Every per-material event flows through here already tagged with campaignId/advertisementId/materialId. */
  onEvent: (event: BoardEvent) => void;
  onPrecedent?: (precedent: Precedent) => void;
  hostImage?: (url: string) => string;
  getPrecedents?: () => string[];
  /**
   * Multimodal perception clients applied per material (concurrently): each
   * material's BoardSession "sees"/"hears" it once before its reviewers run. Both
   * optional; when omitted, materials review text-only (no regression). Concurrency
   * is preserved: perception happens inside each material's own BoardSession.run.
   */
  perception?: {
    vision?: ModelClient;
    stt?: SttClient;
    resolveVideoPath?: (videoUrl: string) => string | undefined;
    maxFrames?: number;
  };
}

/** Worst-case decision per region (for a badge), across some set of materials. */
export interface RollupRegion {
  region: string;
  decision: RegionVerdict['decision'];
}

/** One cell of a material x region matrix. */
export interface RollupCell {
  advertisementId: string;
  materialId: string;
  region: string;
  decision: RegionVerdict['decision'];
  rationale: string;
}

/** The observational rollup for one advertisement (worst-case + its own matrix). */
export interface AdvertisementRollup {
  advertisementId: string;
  name: string;
  /** Worst-case per region across this advertisement's materials. */
  worstCaseByRegion: RollupRegion[];
  /** This advertisement's material x region verdict matrix. */
  matrix: RollupCell[];
}

/** The observational campaign rollup. It is derived, never a gate. */
export interface CampaignRollup {
  campaignId: string;
  /** Worst-case per region across EVERY material in EVERY advertisement. */
  worstCaseByRegion: RollupRegion[];
  /** Per-advertisement rollups (worst-case per region + that ad's matrix). */
  perAdvertisement: AdvertisementRollup[];
  /** The full campaign-wide material x region verdict matrix. */
  matrix: RollupCell[];
  /** Per-material terminal verdicts, in completion order (advertisement-tagged). */
  perMaterial: Array<{ advertisementId: string; materialId: string; verdicts: RegionVerdict[] }>;
}

// publish is clear; adapt and escalate are progressively "worse". Worst-case per
// region takes the highest rank seen for that region across the materials folded.
const DECISION_RANK: Record<RegionVerdict['decision'], number> = {
  publish: 0,
  adapt: 1,
  escalate: 2,
};

function worse(a: RegionVerdict['decision'], b: RegionVerdict['decision']): RegionVerdict['decision'] {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/** Fold a set of matrix cells into worst-case-per-region (block beats adapt beats publish). */
function worstCaseOf(cells: RollupCell[]): RollupRegion[] {
  const worst = new Map<string, RegionVerdict['decision']>();
  for (const c of cells) {
    const prior = worst.get(c.region);
    worst.set(c.region, prior ? worse(prior, c.decision) : c.decision);
  }
  return [...worst.entries()].map(([region, decision]) => ({ region, decision }));
}

/**
 * Fold per-material verdicts into the observational rollup: a campaign-wide
 * worst-case + matrix, plus a per-advertisement worst-case + matrix. The
 * advertisement order follows `adOrder` (the declared order) when provided, so
 * the rollup reads deterministically; any ad seen only in the verdicts is
 * appended.
 */
export function computeRollup(
  campaignId: string,
  perMaterial: Array<{ advertisementId: string; materialId: string; verdicts: RegionVerdict[] }>,
  adOrder?: Array<{ id: string; name: string }>,
): CampaignRollup {
  const matrix: RollupCell[] = [];
  const cellsByAd = new Map<string, RollupCell[]>();
  for (const { advertisementId, materialId, verdicts } of perMaterial) {
    for (const v of verdicts) {
      const cell: RollupCell = { advertisementId, materialId, region: v.region, decision: v.decision, rationale: v.rationale };
      matrix.push(cell);
      const list = cellsByAd.get(advertisementId) ?? [];
      list.push(cell);
      cellsByAd.set(advertisementId, list);
    }
  }

  // Per-advertisement rollups, in declared order first, then any extras seen.
  const nameById = new Map((adOrder ?? []).map((a) => [a.id, a.name]));
  const orderedAdIds = [
    ...(adOrder ?? []).map((a) => a.id).filter((id) => cellsByAd.has(id)),
    ...[...cellsByAd.keys()].filter((id) => !nameById.has(id)),
  ];
  const perAdvertisement: AdvertisementRollup[] = orderedAdIds.map((advertisementId) => {
    const cells = cellsByAd.get(advertisementId) ?? [];
    return {
      advertisementId,
      name: nameById.get(advertisementId) ?? advertisementId,
      worstCaseByRegion: worstCaseOf(cells),
      matrix: cells,
    };
  });

  return {
    campaignId,
    worstCaseByRegion: worstCaseOf(matrix),
    perAdvertisement,
    matrix,
    perMaterial,
  };
}

// Composite board/verdict key: a material id is only unique WITHIN an
// advertisement, so the campaign session keys everything by (adId, materialId).
function compositeKey(advertisementId: string, materialId: string): string {
  return `${advertisementId}::${materialId}`;
}

/**
 * Run every material in a campaign concurrently (across every advertisement).
 * Returns when all materials have reached a terminal state (complete /
 * awaiting-decision / error), with the computed rollup. Materials that escalate
 * stop at awaiting-decision; the caller can drive a material's decision via
 * submitDecision(materialId, text) (or submitDecisionFor(adId, materialId, text)
 * when material ids are not unique across advertisements).
 *
 * Pass `advertisementId` in the options to SCOPE the run to a single
 * advertisement: only that ad's materials are reviewed (still concurrently, still
 * one BoardSession per material, still no gate) and the rollup naturally covers
 * just that ad. Omit it for the unchanged whole-campaign behavior.
 */
export class CampaignSession {
  private readonly sessions = new Map<string, BoardSession>();
  // Which advertisement each composite key belongs to (for the rollup).
  private readonly adOfKey = new Map<string, string>();
  private readonly materialOfKey = new Map<string, string>();
  // Latest verdicts seen per composite key (a re-review replaces the prior round).
  private readonly verdictsByKey = new Map<string, RegionVerdict[]>();
  // Completion order, so the rollup and demo read deterministically.
  private readonly completionOrder: string[] = [];

  constructor(private readonly opts: CampaignSessionOptions) {}

  /**
   * The advertisements actually in scope for this run. Unscoped (the default) this
   * is every advertisement; with `advertisementId` set it is just that one ad (or
   * none, if the id is not in the campaign). Everything downstream (the material
   * fan-out, the material ids, the rollup's declared order) derives from this, so
   * a scoped review simply runs fewer materials, still concurrently, still per
   * material, with no new gate.
   */
  private scopedAdvertisements(): Advertisement[] {
    const all = this.opts.campaign.advertisements;
    if (this.opts.advertisementId === undefined) return all;
    return all.filter((ad) => ad.id === this.opts.advertisementId);
  }

  /** The material ids that will be reviewed, in declared order (flattened across the scoped ads). */
  materialIds(): string[] {
    return this.scopedAdvertisements().flatMap((ad) => ad.materials.map((m) => m.id));
  }

  /** Start one BoardSession per material (across the scoped ads) and await them all (concurrently). */
  async run(): Promise<CampaignRollup> {
    const { campaign, roomId, brand, rulebooks, models } = this.opts;
    const runs = this.scopedAdvertisements().flatMap((ad) =>
      ad.materials.map((material) => this.runMaterial(roomId, campaign, ad, material, brand, rulebooks, models)),
    );
    await Promise.all(runs);
    return this.rollup();
  }

  private runMaterial(
    roomId: string,
    campaign: Campaign,
    ad: Advertisement,
    material: Material,
    brand: BrandDna,
    rulebooks: { us: Rulebook; eu: Rulebook; latam: Rulebook },
    models: BoardModels,
  ): Promise<void> {
    const key = compositeKey(ad.id, material.id);
    this.adOfKey.set(key, ad.id);
    this.materialOfKey.set(key, material.id);
    const session = new BoardSession({
      roomId: `${roomId}::${ad.id}::${material.id}`,
      asset: material,
      brand,
      rulebooks,
      models,
      onEvent: (e) => this.onMaterialEvent(key, e),
      ...(this.opts.onPrecedent ? { onPrecedent: this.opts.onPrecedent } : {}),
      ...(this.opts.hostImage ? { hostImage: this.opts.hostImage } : {}),
      ...(this.opts.getPrecedents ? { getPrecedents: this.opts.getPrecedents } : {}),
      ...(this.opts.perception ? { perception: this.opts.perception } : {}),
      campaign: { campaignId: campaign.id, advertisementId: ad.id, materialId: material.id, dossier: campaign.dossier },
    });
    this.sessions.set(key, session);
    return session.run();
  }

  // Tag-and-forward every per-material event, and snapshot verdicts/completion so
  // the rollup can be computed without re-reading the board.
  private onMaterialEvent(key: string, event: BoardEvent): void {
    if (event.type === 'verdict') this.verdictsByKey.set(key, event.verdicts);
    if (event.type === 'status' && event.status !== 'running' && !this.completionOrder.includes(key)) {
      this.completionOrder.push(key);
    }
    // The event already carries campaignId/advertisementId/materialId (stamped by
    // the board), so the consumer can route it to the right lane with no extra work.
    this.opts.onEvent(event);
  }

  /**
   * Record a human ruling on one material's escalation, addressed by material id.
   * Resolves the first material with that id (material ids are unique in the
   * seeded campaigns); use submitDecisionFor when an id repeats across ads.
   */
  async submitDecision(materialId: string, text: string): Promise<void> {
    for (const [key, mid] of this.materialOfKey) {
      if (mid === materialId) {
        await this.sessions.get(key)?.submitDecision(text);
        return;
      }
    }
  }

  /** Record a human ruling on one material's escalation, addressed by (adId, materialId). */
  async submitDecisionFor(advertisementId: string, materialId: string, text: string): Promise<void> {
    await this.sessions.get(compositeKey(advertisementId, materialId))?.submitDecision(text);
  }

  /** The observational rollup over the verdicts seen so far. */
  rollup(): CampaignRollup {
    const ordered = this.completionOrder.filter((key) => this.verdictsByKey.has(key));
    const seen = new Set(ordered);
    for (const key of this.verdictsByKey.keys()) if (!seen.has(key)) ordered.push(key);
    const perMaterial = ordered.map((key) => ({
      advertisementId: this.adOfKey.get(key) ?? '',
      materialId: this.materialOfKey.get(key) ?? key,
      verdicts: this.verdictsByKey.get(key) ?? [],
    }));
    // The declared order is scoped too: a single-advertisement run yields a rollup
    // whose perAdvertisement covers only that ad. (computeRollup already drops ads
    // with no verdicts, so this is belt-and-suspenders, and keeps the order right.)
    const adOrder = this.scopedAdvertisements().map((ad) => ({ id: ad.id, name: ad.name }));
    return computeRollup(this.opts.campaign.id, perMaterial, adOrder);
  }
}
