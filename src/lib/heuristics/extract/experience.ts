// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

import type { ResumeExperience } from "../../score/types.ts";
import type { PdfSection } from "../sections.ts";
import { parseEntryBlocks } from "../entry-blocks.ts";
import type { EntryBlock } from "../entry-blocks.ts";
import { finalizeEntries, looksLikeCompany } from "./shared.ts";
import {
  disambiguateCompanyTitle,
  splitRoleComma,
} from "./experience-disambiguate.ts";

// ── Experience ──────────────────────────────────────────────────────────────

/**
 * Split the experience section into entry blocks and extract a
 * `ResumeExperience` row per block. The grouping heuristic:
 *
 *   - A line containing a date range anchors an entry header.
 *   - Non-bullet lines in the 0..2 lines ABOVE the anchor = company / title.
 *   - Bullet lines after the anchor, until the next anchor or section end,
 *     = the description.
 *
 * Fallback for a DATELESS section (#309): when the section carries no date
 * ranges at all, the `date_range` anchor finds nothing and yields zero blocks
 * (the "no date range ⇒ []" contract in `parseEntryBlocks`), collapsing the
 * whole section to zero roles. Re-run with the date-optional `"first_line"`
 * anchor so each `header + bullets` group becomes one dateless role.
 *
 * Confidence is per-entry, then averaged: we report the average of the
 * per-entry confidence as the section-level `experience` confidence.
 */
export function extractExperience(
  experience: PdfSection | undefined,
): { value: ResumeExperience[]; confidence: number } {
  // Split the section into dated entry blocks using the shared primitive, then
  // map each block's header lines into title/company/team and score it. The
  // windowing, date parsing, and bullet-body collection live in
  // `parseEntryBlocks`; this function owns only the experience-specific field
  // mapping (`disambiguateCompanyTitle`) and scoring.
  let blocks = parseEntryBlocks(experience, {
    anchor: "date_range",
    collectBody: true,
    headerLookback: 2,
  });
  // A dateless experience section yields zero `date_range` blocks. Fall back to
  // the `"first_line"` anchor so each header-run + bullet-group is recovered as
  // one dateless role instead of the whole section collapsing to nothing (#309).
  // A résumé with ANY dated role produced ≥1 block above and never reaches here,
  // so `date_range` stays the primary path and dated résumés cannot regress. The
  // date-only-phantom drop and the `title || company` non-empty filter below
  // apply to both paths uniformly.
  if (blocks.length === 0) {
    blocks = parseEntryBlocks(experience, {
      anchor: "first_line",
      collectBody: true,
    });
  }
  // Detect a shared employer banner heading a run of "Title, Team" roles (#382):
  // one employer stated once above a group, each role below carrying only its
  // "Title, Team" header. The per-role blocks lack the banner (it sits above the
  // group, out of each follower's header window), so attribute it here before
  // mapping.
  const banners = detectSharedBanners(blocks);
  // Drop a date-only phantom — a block with neither title nor company (#145).
  // Experience has no single title axis, so we keep a role that has either.
  return finalizeEntries(
    blocks.map((block, i) => experienceFromBlock(block, banners.get(i))),
    (e) => e.title !== "" || e.company !== "",
  );
}

/**
 * The employer named by a block that HEADS a shared-employer banner group
 * (#382): its first header line is a standalone org (`looksLikeCompany`) sitting
 * ABOVE the date anchor (`anchorHeaderIndex >= 1`), and its own role header (the
 * anchor line) is itself a "Title, Team" comma shape — so the whole group is the
 * homogeneous "one banner over N × `Title, Team`" layout, not a coincidental
 * stacked "Company / Title" role above an unrelated comma role. Returns the
 * banner employer, or undefined when the block is not such a head.
 */
function bannerEmployerOf(block: EntryBlock): string | undefined {
  const idx = block.anchorHeaderIndex ?? -1;
  if (idx < 1) return undefined;
  const lead = block.headerLines[0];
  if (!lead || !looksLikeCompany(lead)) return undefined;
  const anchorLine = block.headerLines[idx];
  if (!anchorLine || !splitRoleComma(anchorLine)) return undefined;
  return lead;
}

/**
 * True when a block is a FOLLOWER under a shared employer banner (#382): a single
 * "Title, Team" header line (the anchor), where the post-comma segment is NOT
 * itself an employer (`!looksLikeCompany`) — i.e. the role names no company of
 * its own, so the group banner above supplies it. A role whose header carries its
 * own employer ("Engineer, Globex Inc") reads as `looksLikeCompany` on the
 * post-comma segment and is left alone (the issue's "last role maps correctly"
 * case).
 */
function isCommaFollower(block: EntryBlock): boolean {
  if (block.headerLines.length !== 1) return false;
  const rc = splitRoleComma(block.headerLines[0]);
  return rc !== null && !looksLikeCompany(rc[1]);
}

/**
 * Map each block index to its shared-employer banner (#382). A banner head
 * (`bannerEmployerOf`) claims the contiguous run of comma-follower blocks
 * (`isCommaFollower`) directly below it; the run stops at the first block that is
 * not a follower (its own employer, a differently-shaped role, or a new banner).
 * Only activates when at least one follower exists, so a lone banner-shaped role
 * is untouched.
 */
function detectSharedBanners(blocks: EntryBlock[]): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < blocks.length; i++) {
    const employer = bannerEmployerOf(blocks[i]);
    if (!employer) continue;
    const followers: number[] = [];
    for (let j = i + 1; j < blocks.length; j++) {
      if (!isCommaFollower(blocks[j])) break;
      followers.push(j);
    }
    for (const j of followers) out.set(j, employer);
  }
  return out;
}

/** Resolve a block's title/company/team/location. Runs the shared header
 *  disambiguation, then — for a shared-banner follower (#382) — overrides: the
 *  lone "Title, Team" header names no company of its own, so route the pre-comma
 *  segment to title, the post-comma segment to team, and take the company from
 *  the group banner. */
function resolveBlockFields(
  block: EntryBlock,
  bannerEmployer: string | undefined,
): { title?: string; company?: string; team?: string; location?: string } {
  const mapped = disambiguateCompanyTitle(
    block.headerLines,
    block.anchorHeaderIndex,
  );
  if (!bannerEmployer) return mapped;
  const rc = splitRoleComma(block.headerLines[0] ?? "");
  return {
    title: rc ? rc[0] : mapped.title,
    company: bannerEmployer,
    team: rc ? rc[1] : mapped.team,
    location: mapped.location,
  };
}

/** Map one dated entry block to a `ResumeExperience` and its confidence score.
 *  Extracted from `extractExperience` to keep each function below the
 *  complexity threshold; mirrors `projectFromBlock` / `achievementFromBlock`.
 *  `bannerEmployer` (set for a shared-banner follower, #382) overrides the
 *  employer: the role's single "Title, Team" header supplies title + team and the
 *  group banner supplies the company. */
function experienceFromBlock(
  block: EntryBlock,
  bannerEmployer?: string,
): {
  entry: ResumeExperience;
  score: number;
} {
  const { dates } = block;
  const { title, company, team, location } = resolveBlockFields(
    block,
    bannerEmployer,
  );
  const description = block.body;

  // Score the entry.
  let score = 0;
  if (dates.start_date) score += 0.25;
  if (dates.end_date || dates.is_current) score += 0.15;
  if (company) score += 0.25;
  if (title) score += 0.2;
  if (block.bulletCount >= 1) score += 0.15;

  return {
    entry: {
      title: title ?? "",
      company: company ?? "",
      ...(team ? { team } : {}),
      ...(location ? { location } : {}),
      ...(dates.start_date ? { start_date: dates.start_date } : {}),
      ...(dates.end_date ? { end_date: dates.end_date } : {}),
      ...(dates.is_current ? { is_current: true } : {}),
      description: description || undefined,
    },
    score: Math.min(score, 1),
  };
}
