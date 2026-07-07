---
name: batch-issues
description: Group several small GitHub issues into one durable, assignable batch — mint a parent "batch" epic issue, wire the small issues as native sub-issues (+ optional dependency order), apply shared milestone/label/assignee, place the parent on the board, and print the ready /implement-batch invocation. Use when the user says "batch these issues", "/batch-issues", "group these into one epic", or wants one person to implement several small issues as a single unit.
argument-hint: <#,#,#> [--title "..."] [--slug edit-validation] [--milestone <name|number>] [--assignee <login>] [--order <#,#,...>] [--dry-run]
---

# Batch Issues

Turn a loose set of small GitHub issues into **one trackable unit** that a single
person implements end-to-end via `/implement-batch`. This is the **grouping**
step; `/implement-batch` is the **execution** step. Keep them separate: this skill
never writes code — it only creates the parent epic, wires the children, and hands
off a ready invocation.

> **When to reach for this.** Only when you want the group to be *durable* — a
> parent issue, a board row, a shared assignee, a record of *why* these issues
> cohere. For a throwaway ad-hoc batch, skip this entirely and hand the executor
> an explicit list: `/implement-batch 341,346,349`. `/implement-batch` already
> accepts a raw list — this skill earns its keep only by making the group real.

## Repo facts (resumelint)

- **Repo:** `resumelint-org/resumelint`, GitHub-only (no Linear). All grouping is
  native GitHub: sub-issues via `gh api .../sub_issues`, dependency order via
  `.../dependencies/blocked_by`, board via `gh project`.
- **This skill only creates/links issues** — no branch, no commit, no PR. The
  parent epic is a **tracking issue**, not something to implement directly; its
  children carry the actual work.
- **Sub-issue + dependency API gotcha (load-bearing):** both `sub_issue_id` and
  `issue_id` want the child's **internal REST `id`** (`gh api .../issues/<N> --jq
  .id`), **not** the issue number and **not** the node_id — and must be passed
  with **`-F`** (typed integer), never `-f` (string → `422 not of type integer`).

## Input

Parse `$ARGUMENTS` for an **explicit comma/space list** of child issue numbers
(e.g. `341,346,349` or `341 346 349`). If none is given, **stop and ask** which
issues to batch (optionally list open, un-milestoned, coherent-looking candidates).

**Flags:**
- `--title "..."` — the parent epic title. If omitted, propose one from the
  children's common theme and confirm with the user.
- `--slug <slug>` — kebab slug for the `batch:<slug>` grouping label. Defaults to
  a slug derived from the title.
- `--milestone <name|number>` — milestone to apply to the parent **and** every
  child. If omitted, infer from the children (see Step 2) and confirm.
- `--assignee <login>` — the one person who'll implement the batch; applied to the
  parent and all children. If omitted, leave unassigned and note it.
- `--order <#,#,...>` — explicit dependency order; wires `blocked_by` edges so
  `/implement-batch` builds them in sequence. If omitted, no edges (children are
  independent).
- `--dry-run` — print the plan (parent title/body, child links, metadata, the
  emitted invocation) **without** writing anything. Use to preview.

Resolve the repo once:
```bash
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"   # resumelint-org/resumelint
OWNER="${REPO%%/*}"
```

## Process

### Step 1 — Read the children and sanity-check cohesion

For each child number, read it and confirm it's a real, open, small issue:
```bash
gh issue view <N> --repo "$REPO" --json number,title,state,milestone,labels,assignees,url
```
- **Refuse to batch a closed issue** (e.g. a DUP like #377) — warn and drop it.
- **Warn on mixed milestones/labels** — if the children span different milestones
  or look thematically unrelated, surface that and confirm the group still makes
  sense before creating anything. Grouping unrelated work into one PR is exactly
  what makes review hard; this is the cohesion gate.
- Capture each child's internal `id` now (needed for linking):
  ```bash
  gh api "repos/$REPO/issues/<N>" --jq '.id'
  ```

### Step 2 — Settle the shared metadata

- **Milestone:** if `--milestone` given, use it. Else, if all children share one
  milestone, adopt it; if they're mixed or un-milestoned, propose one (read live
  milestones like `/triage-issue` does) and confirm.
- **Label:** ensure the grouping label exists, then reuse it:
  ```bash
  gh label create "batch:<slug>" --repo "$REPO" \
    --color BFD4F2 --description "Grouped for single-batch implementation" 2>/dev/null || true
  ```
- **Assignee:** `--assignee` if given, else leave unassigned (note it in the report
  so the user assigns before handing to an intern).

### Step 3 — Create the parent epic (tracking issue)

Write the body to a tempfile (never inline `--body "$(...)"` — quoting bites), then
create. The body records **why these cohere** and a checklist of children:

```markdown
## Batch epic — <title>

Groups the small issues below for **single-batch implementation** by one person
via `/implement-batch`. This is a tracking issue; the work lives in the children.

**Why grouped:** <one line — the shared theme / same subsystem / same reviewer context>

### Children
- [ ] #341 — <title>
- [ ] #346 — <title>
- [ ] #349 — <title>

**Implement with:** `/implement-batch <THIS#>`
```

```bash
gh issue create --repo "$REPO" \
  --title "<title>" \
  --body-file "$BODY" \
  --label "batch:<slug>" \
  ${MILESTONE:+--milestone "$MILESTONE"} \
  ${ASSIGNEE:+--assignee "$ASSIGNEE"}
# capture the new parent number → PARENT
```

### Step 4 — Wire children as native sub-issues

For each child, POST its **internal id** to the parent's `sub_issues` (typed `-F`):
```bash
CHILD_ID="$(gh api "repos/$REPO/issues/<N>" --jq .id)"
gh api -X POST "repos/$REPO/issues/$PARENT/sub_issues" -F sub_issue_id="$CHILD_ID"
```
Verify the link read back:
```bash
gh api "repos/$REPO/issues/$PARENT/sub_issues" --jq '.[].number'   # should list all children
```

### Step 5 — Apply shared metadata + optional order to children

Stamp each child with the batch label (and milestone/assignee if the child lacks
them — don't clobber a child that's already correctly milestoned unless it
conflicts with the batch milestone, in which case warn):
```bash
gh issue edit <N> --repo "$REPO" --add-label "batch:<slug>" \
  ${MILESTONE:+--milestone "$MILESTONE"} ${ASSIGNEE:+--add-assignee "$ASSIGNEE"}
```

If `--order A,B,C` given, wire `blocked_by` so B is blocked by A, C by B (each
edge uses the **blocking** issue's internal id, typed `-F`):
```bash
BLOCKER_ID="$(gh api "repos/$REPO/issues/<A>" --jq .id)"
gh api -X POST "repos/$REPO/issues/<B>/dependencies/blocked_by" -F issue_id="$BLOCKER_ID"
```

### Step 6 — Place the parent on the board

Don't re-implement project logic — **delegate to the repo's `/triage-issue`**:

> Run `/triage-issue <PARENT>` to put the epic on the "ResumeLint v1" board and
> set its Phase/milestone.

Invoke it (or tell the user to) so the batch shows up on the roadmap as one row.

### Step 7 — Hand off

Print the ready execution invocation and a one-line summary:

```
Batch epic #<PARENT> created — <title>
  children: #341, #346, #349   (sub-issues linked ✓)
  milestone: <name> · label: batch:<slug> · assignee: <login|unassigned>
  order: <sequential edges | independent>

Implement it:  /implement-batch <PARENT>
```

## Rules

- **Grouping only — never implement here.** No branch, no commit, no code. This
  skill produces a parent epic + linked children + a `/implement-batch`
  invocation; that other skill does the building.
- **Cohesion gate is real.** Warn (and confirm) before batching issues that span
  milestones or look unrelated — an incoherent batch produces an unreviewable PR.
- **Never batch a closed issue.** Drop DUPs/closed with a warning.
- **Typed `-F` for every id.** Sub-issue and dependency links use the child's
  internal REST `id` with `-F` (integer), never the number, never `-f`.
- **Don't clobber good child metadata.** Add the batch label/assignee; only change
  a child's milestone when it conflicts with the batch milestone, and warn.
- **`--dry-run` writes nothing.** Use it to preview the plan before creating.
- **Board placement is `/triage-issue`'s job** — delegate, don't duplicate.
```

