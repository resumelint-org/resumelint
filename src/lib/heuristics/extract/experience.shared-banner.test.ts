// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

/**
 * Regression for #382 — a single employer banner heading a run of roles, each
 * role header a bare "Title, Team" with the employer named ONCE above the group
 * (not repeated per role):
 *
 *   Acme Corporation
 *     Staff Engineer, Platform Infrastructure    Aug 2024 - Present
 *     Senior Engineer, Payments Core             Jul 2022 - Aug 2024
 *     Engineer, Identity Services                Aug 2020 - Jul 2022
 *
 * The employer banner sits above the group and is out of each follower role's
 * header window (`headerLookback: 2` reaches only the first role), so roles 2..N
 * had no company at all — and the "Title, Team" comma split mislabeled the
 * team/sub-org as the company. Every role must map to `company = "Acme
 * Corporation"`, `title = <role>`, `team = <post-comma segment>`.
 *
 * Synthetic personas only, per the fixtures PII policy.
 */

import { describe, it, expect } from "vitest";
import { groupIntoLines, splitIntoSections, findSection } from "../sections.ts";
import { extractExperience } from "../extract-fields.ts";
import { mkItems } from "../__test-utils__/mkItem.ts";

function rolesFrom(specs: Array<{ text: string; fontSize?: number }>) {
  const sections = splitIntoSections(groupIntoLines(mkItems(specs)));
  const experience = findSection(sections, "experience");
  expect(experience).toBeDefined();
  return extractExperience(experience).value;
}

describe("shared employer banner over 'Title, Team' roles (#382)", () => {
  it("attributes the banner employer to every role under it", () => {
    const roles = rolesFrom([
      { text: "Experience", fontSize: 13 },
      { text: "Acme Corporation", fontSize: 12 },
      { text: "Staff Engineer, Platform Infrastructure  Aug 2024 - Present", fontSize: 11 },
      { text: "• Led platform work.", fontSize: 11 },
      { text: "Senior Engineer, Payments Core  Jul 2022 - Aug 2024", fontSize: 11 },
      { text: "• Ran payments.", fontSize: 11 },
      { text: "Engineer, Identity Services  Aug 2020 - Jul 2022", fontSize: 11 },
      { text: "• Built identity.", fontSize: 11 },
    ]);

    expect(roles.length).toBe(3);
    for (const role of roles) {
      expect(role.company).toBe("Acme Corporation");
    }
    expect(roles[0]).toMatchObject({
      title: "Staff Engineer",
      company: "Acme Corporation",
      team: "Platform Infrastructure",
    });
    expect(roles[1]).toMatchObject({
      title: "Senior Engineer",
      company: "Acme Corporation",
      team: "Payments Core",
    });
    expect(roles[2]).toMatchObject({
      title: "Engineer",
      company: "Acme Corporation",
      team: "Identity Services",
    });
    // The team/sub-org must never be mislabeled as the company.
    expect(roles.map((r) => r.company)).not.toContain("Payments Core");
    expect(roles.map((r) => r.company)).not.toContain("Identity Services");
  });

  it("does NOT propagate to a role that names its own employer (no false positive)", () => {
    // Same banner + two followers, then a role whose header carries its OWN
    // employer ("Consultant, Globex LLC" — post-comma reads as a company). The
    // run stops at it: it keeps its own company, not the banner.
    const roles = rolesFrom([
      { text: "Experience", fontSize: 13 },
      { text: "Acme Corporation", fontSize: 12 },
      { text: "Staff Engineer, Platform Infrastructure  Aug 2024 - Present", fontSize: 11 },
      { text: "• Led platform work.", fontSize: 11 },
      { text: "Senior Engineer, Payments Core  Jul 2022 - Aug 2024", fontSize: 11 },
      { text: "• Ran payments.", fontSize: 11 },
      { text: "Consultant, Globex LLC  Aug 2020 - Jul 2022", fontSize: 11 },
      { text: "• Advised on architecture.", fontSize: 11 },
    ]);

    expect(roles.length).toBe(3);
    expect(roles[0].company).toBe("Acme Corporation");
    expect(roles[1].company).toBe("Acme Corporation");
    // The self-employed role keeps its own employer, NOT the banner.
    expect(roles[2].company).toBe("Globex LLC");
    expect(roles[2].company).not.toBe("Acme Corporation");
  });

  it("leaves a single standalone 'Title, Company' role unchanged (no banner)", () => {
    // No banner above → no propagation. A lone comma role keeps its prior
    // mapping (regression guard on the isolated comma-split path).
    const roles = rolesFrom([
      { text: "Experience", fontSize: 13 },
      { text: "Office manager, Nod Publishing  March 2023 - December 2024", fontSize: 11 },
      { text: "• Ran the front office.", fontSize: 11 },
    ]);

    expect(roles.length).toBe(1);
    expect(roles[0].title.toLowerCase()).toContain("office manager");
    expect(roles[0].company).toBe("Nod Publishing");
  });
});
