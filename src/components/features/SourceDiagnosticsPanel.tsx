// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

/**
 * SourceDiagnosticsPanel — the "Source & diagnostics" primary tab body (#263).
 *
 * Collapses the three former evidence tabs (Source PDF, Extracted text, Layout
 * flags) into one primary tab. A nested segmented control switches between the
 * three views; the panels themselves are unchanged (SourcePdfPanel,
 * ExtractedTextPanel, LayoutFlagsList) — this only adds the one nesting level.
 *
 * The control is a peer toggle (segmented control), not a second <Tabs>: these
 * are peer views of the same source, visually subordinate to the primary tab
 * strip. It is built from the <Button> primitive (no raw <button>), active state
 * via semantic tokens. Render-vs-hide: simple conditional render — none of the
 * three evidence panels hold cross-switch local state worth preserving.
 */

import { useState } from "react";
import type { CascadeResult, LayoutTrigger } from "../../lib/heuristics/types.ts";
import { Button } from "@design-system";
import { LayoutFlagsList } from "./LayoutFlagsList.tsx";
import { SourcePdfPanel, ExtractedTextPanel } from "./EvidencePanel.tsx";

type SourceKind = "pdf" | "docx";
type Segment = "pdf" | "extracted" | "flags";

interface SourceDiagnosticsPanelProps {
  result: CascadeResult;
  bytes?: ArrayBuffer;
  sourceKind: SourceKind;
}

export function SourceDiagnosticsPanel({
  result,
  bytes,
  sourceKind,
}: SourceDiagnosticsPanelProps) {
  // Default segment is PDF (#263); the parent tab defaults to reconstructed.
  const [segment, setSegment] = useState<Segment>("pdf");
  const triggerCount = result.triggers.length;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Source & diagnostics views"
        className="inline-flex gap-1 self-start rounded-md border border-border-light bg-surface-subtle p-1"
      >
        <SegmentButton
          isActive={segment === "pdf"}
          onClick={() => setSegment("pdf")}
        >
          PDF
        </SegmentButton>
        <SegmentButton
          isActive={segment === "extracted"}
          onClick={() => setSegment("extracted")}
        >
          Extracted text
        </SegmentButton>
        <SegmentButton
          isActive={segment === "flags"}
          onClick={() => setSegment("flags")}
          count={triggerCount}
        >
          Layout flags
        </SegmentButton>
      </div>

      {segment === "pdf" && (
        <SourcePdfPanel bytes={bytes} sourceKind={sourceKind} />
      )}
      {segment === "extracted" && <ExtractedTextPanel result={result} />}
      {segment === "flags" && (
        <LayoutFlagsList
          triggers={result.triggers as readonly LayoutTrigger[]}
        />
      )}
    </div>
  );
}

function SegmentButton({
  isActive,
  onClick,
  count,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  const activeCls = isActive
    ? "bg-surface-card text-content-primary font-semibold shadow-xs"
    : "text-content-secondary font-medium hover:text-content-primary hover:bg-transparent";

  return (
    <Button
      variant="ghost"
      aria-pressed={isActive}
      onClick={onClick}
      className={`rounded px-3 py-1 text-sm ${activeCls}`}
    >
      {children}
      {count != null && count > 0 && (
        <span className="ml-1.5 rounded-full bg-surface-subtle px-1.5 text-xs text-content-secondary">
          {count}
        </span>
      )}
    </Button>
  );
}
