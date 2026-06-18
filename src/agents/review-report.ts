// src/agents/review-report.ts
// Composes the human-facing review report the Risk Adjudicator posts: the one
// self-contained message that explains the verdict, every claim that was flagged
// (by which reviewer, against which rule, and why), the proposed fixes, and links
// to the materials. It is posted both as the permission ask (decision 'asking')
// and as the FINAL word at a terminal, so the verdict never gets buried mid-thread.

import type { Finding } from '../domain/types';

export interface ReportSource {
  /** Friendly reviewer label, e.g. 'Claims', 'Brand', 'US', 'EU', 'LATAM'. */
  source: string;
  findings: Finding[];
}

export interface ReportFix {
  /** Market this version targets, or 'all' for a single shared rewrite. */
  region: string;
  copy: string;
  imageUrl?: string;
}

export type ReportDecision = 'asking' | 'published' | 'spiked' | 'escalated';

export interface ReportInput {
  asset: { id: string; name?: string; markets?: string[]; imageUrl?: string };
  /** Per-reviewer findings (the original review, captured before any fix). */
  sources: ReportSource[];
  decision: ReportDecision;
  /** Proposed rewrites: one entry for a shared fix, several for per-market versions. */
  fixes?: ReportFix[];
  /** Extra material links to surface (e.g. regenerated promo images). */
  materialLinks?: { label: string; url: string }[];
}

const SEV_RANK: Record<string, number> = { block: 0, warn: 1, info: 2 };

const HEAD: Record<ReportDecision, (name: string) => string> = {
  asking: (n) => `REVIEW REPORT - ${n} (awaiting your decision)`,
  published: (n) => `FINAL REPORT - ${n}: PUBLISHED`,
  spiked: (n) => `FINAL REPORT - ${n}: SPIKED`,
  escalated: (n) => `FINAL REPORT - ${n}: ESCALATED to you`,
};

// Group findings by the exact claim span across reviewers, so each violation shows
// every region/rule that flagged it in one place (the "where + which rule" view).
function groupByClaim(sources: ReportSource[]): { claim: string; rows: { source: string; f: Finding }[] }[] {
  const byClaim = new Map<string, { claim: string; rows: { source: string; f: Finding }[] }>();
  for (const { source, findings } of sources) {
    for (const f of findings ?? []) {
      const key = (f.claim ?? '').trim().toLowerCase();
      if (!key) continue;
      let g = byClaim.get(key);
      if (!g) { g = { claim: f.claim.trim(), rows: [] }; byClaim.set(key, g); }
      g.rows.push({ source, f });
    }
  }
  const hasBlock = (g: { rows: { f: Finding }[] }): boolean => g.rows.some((r) => r.f.severity === 'block');
  return [...byClaim.values()].sort((a, b) => Number(hasBlock(b)) - Number(hasBlock(a)) || a.claim.localeCompare(b.claim));
}

export function composeReport(input: ReportInput): string {
  const name = input.asset.name ?? input.asset.id;
  const groups = groupByClaim(input.sources);
  const blockCount = groups.filter((g) => g.rows.some((r) => r.f.severity === 'block')).length;

  const lines: string[] = [HEAD[input.decision](name)];
  if (input.asset.markets?.length) lines.push(`Markets: ${input.asset.markets.join(', ')}`);
  lines.push('');

  if (groups.length === 0) {
    lines.push('Findings: none. Every claim is supported and on-brand across all reviewers.');
  } else {
    lines.push(`Findings: ${groups.length} claim(s) flagged, ${blockCount} blocking.`);
    let i = 1;
    for (const g of groups) {
      lines.push(`${i}. "${g.claim}"`);
      const rows = [...g.rows].sort((a, b) => (SEV_RANK[a.f.severity] ?? 9) - (SEV_RANK[b.f.severity] ?? 9));
      for (const { source, f } of rows) {
        const rule = f.ruleId ? ` (${f.ruleId})` : '';
        const disc = f.requiredDisclosure ? ` Required disclosure: "${f.requiredDisclosure}".` : '';
        lines.push(`   - ${source} [${f.severity}]${rule}: ${f.rationale}${disc}`);
      }
      i += 1;
    }
  }

  // Images are emitted as markdown ![label](url) so the report viewer renders them
  // inline (the regenerated promo, the campaign image). Non-image links stay as links.
  const isImg = (u: string): boolean => /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(u) || u.includes('/api/images/');
  if (input.fixes?.length) {
    lines.push('');
    lines.push(input.fixes.length > 1 ? 'Proposed market-tailored versions:' : 'Proposed fix:');
    for (const fx of input.fixes) {
      lines.push(`- ${fx.region}: "${fx.copy}"`);
      if (fx.imageUrl) lines.push(`![${fx.region} new image](${fx.imageUrl})`);
    }
  }

  // Material links, minus any image already shown as a fix's new image (so a
  // regenerated promo is not listed twice).
  const fixUrls = new Set((input.fixes ?? []).map((fx) => fx.imageUrl).filter(Boolean));
  const links = [...(input.materialLinks ?? [])].filter((l) => !fixUrls.has(l.url));
  if (input.asset.imageUrl && !fixUrls.has(input.asset.imageUrl)) links.unshift({ label: 'campaign image', url: input.asset.imageUrl });
  if (links.length) {
    lines.push('');
    lines.push('Materials:');
    for (const l of links) lines.push(isImg(l.url) ? `![${l.label}](${l.url})` : `- ${l.label}: ${l.url}`);
  }

  lines.push('');
  lines.push('This is a compliance demo, not legal advice.');
  return lines.join('\n');
}
