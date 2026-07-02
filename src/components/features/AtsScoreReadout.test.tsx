// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

// @vitest-environment jsdom

/**
 * Anchor-resolution regression test for the score tiles (#153).
 *
 * The three dimension tiles (Specificity / Structure / Completeness) each link
 * to a section id via `<a href="#…">`. Two of them used to point at
 * `#per-bullet-feedback`, an id no element renders — so clicking them was a
 * silent no-op (only Completeness, on `#contact`, scrolled).
 *
 * This renders `<AtsScoreReadout>`, collects every tile anchor from the DOM, and
 * asserts each resolves to a known scroll target in the typed `SECTION_IDS`
 * contract. The target components (`ContactCard`, `ReconstructedResume`) render
 * their `id` from that same constant, so contract membership guarantees a live
 * target — a dead link like `#per-bullet-feedback` fails here immediately.
 *
 * Runs in jsdom with raw `createRoot`, matching `ContactCard.test.tsx`.
 */

import { describe, expect, it, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { AtsScoreReadout } from "./AtsScoreReadout.tsx";
import { SECTION_IDS } from "../../lib/anchors.ts";
import type { AnonymousAtsScore } from "../../lib/score/score.ts";

function makeScore(): AnonymousAtsScore {
  return {
    overall: 72,
    preLayoutOverall: 72,
    specificity: {
      score: 30,
      max: 40,
      gradable: true,
      metricBullets: 6,
      totalBullets: 10,
    },
    structure: {
      score: 24,
      max: 30,
      gradable: true,
      goodBullets: 8,
      totalBullets: 10,
    },
    completeness: {
      score: 18,
      max: 30,
      gradable: true,
      missing: ["phone"],
    },
    layout: { triggers: [], multiplier: 1, scanned: false },
    algoVersion: "test",
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(score: AnonymousAtsScore): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(AtsScoreReadout, { score }));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

/** Every hash href the rendered tiles link to. */
function tileAnchors(el: HTMLDivElement): string[] {
  return Array.from(el.querySelectorAll("a[href^='#']")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

describe("AtsScoreReadout tile anchors", () => {
  it("points every dimension tile at a known scroll target", () => {
    const anchors = tileAnchors(render(makeScore()));

    // All three tiles render as anchors.
    expect(anchors).toHaveLength(3);

    const validTargets = new Set<string>(
      Object.values(SECTION_IDS).map((id) => `#${id}`),
    );
    for (const href of anchors) {
      expect(validTargets.has(href)).toBe(true);
    }
  });

  it("does not resurrect the dead #per-bullet-feedback anchor", () => {
    expect(tileAnchors(render(makeScore()))).not.toContain(
      "#per-bullet-feedback",
    );
  });
});
