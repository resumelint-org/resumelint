// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

import { describe, it, expect } from "vitest";
import { extractJdTerms, stripBoilerplate } from "./extract-jd-terms.ts";

const SAMPLE_JD = `
Senior Backend Engineer

About the role:
You'll build distributed systems on Kubernetes (k8s) backing our Postgres
and Redis clusters. We use Go, TypeScript, and gRPC across the stack. ETL
pipelines run on Airflow and Spark.

What we look for:
- 5+ years writing production Go or Python
- Hands-on experience with AWS or GCP
- Comfort owning CI/CD pipelines

Benefits we offer:
- 401(k) match
- Health insurance, dental insurance, vision insurance
- Unlimited PTO

Equal opportunity employer:
We are an equal opportunity employer and do not discriminate on the basis of
race, color, religion, or any other protected characteristic.
`;

describe("stripBoilerplate", () => {
  it("removes EEO block until the next blank line", () => {
    const body = stripBoilerplate(SAMPLE_JD);
    const lower = body.toLowerCase();
    expect(lower).not.toContain("equal opportunity");
    expect(lower).not.toContain("do not discriminate");
  });

  it("removes benefits block including individual benefit anchors", () => {
    const body = stripBoilerplate(SAMPLE_JD);
    const lower = body.toLowerCase();
    expect(lower).not.toContain("401(k)");
    expect(lower).not.toContain("health insurance");
  });

  it("keeps the technical body intact", () => {
    const body = stripBoilerplate(SAMPLE_JD);
    expect(body).toContain("Kubernetes");
    expect(body).toContain("Postgres");
    expect(body).toContain("Airflow");
  });
});

describe("extractJdTerms", () => {
  it("picks up skill aliases via the curated dictionary", () => {
    const { skills } = extractJdTerms(SAMPLE_JD);
    const ids = skills.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "kubernetes",
        "postgresql",
        "redis",
        "typescript",
        "grpc",
        "airflow",
        "spark",
        "python",
        "aws",
        "gcp",
        "ci-cd",
      ]),
    );
  });

  it("excludes skills that only appeared inside boilerplate sections", () => {
    const jd = `
We need Python.

Benefits we offer:
We also do a lot of Kotlin here.
`;
    const { skills } = extractJdTerms(jd);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("python");
    // Kotlin only appears in the benefits block — must be stripped.
    expect(ids).not.toContain("kotlin");
  });

  it("emits a snippet that anchors the term in JD context", () => {
    const { skills } = extractJdTerms("We build with Kubernetes for orchestration.");
    const k8s = skills.find((s) => s.id === "kubernetes");
    expect(k8s).toBeDefined();
    expect(k8s!.snippet.toLowerCase()).toContain("kubernetes");
  });

  it("dedupes a skill that appears under multiple aliases", () => {
    const { skills } = extractJdTerms("React, ReactJS, and React.js are all listed.");
    const reactHits = skills.filter((s) => s.id === "react");
    expect(reactHits).toHaveLength(1);
  });

  it("includes a noun-phrase pass and drops any noun that also matched a skill", () => {
    const jd = `
We work on Distributed Systems and Event Sourcing patterns.
Kubernetes is a core piece of the platform.
`;
    const { skills, nouns } = extractJdTerms(jd);
    const skillIds = skills.map((s) => s.id);
    expect(skillIds).toContain("kubernetes");
    const nounDisplays = nouns.map((n) => n.display);
    expect(nounDisplays).toEqual(
      expect.arrayContaining(["Distributed Systems", "Event Sourcing"]),
    );
    // Kubernetes is a skill — must not also show up as a noun-pass hit.
    expect(nouns.find((n) => n.display.toLowerCase() === "kubernetes")).toBeUndefined();
  });

  it("returns an empty result for an empty JD", () => {
    const out = extractJdTerms("");
    expect(out.all).toHaveLength(0);
  });
});
