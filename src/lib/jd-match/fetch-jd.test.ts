// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The resumelint Authors

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAtsUrl, htmlToPlaintext, fetchJdFromUrl } from "./fetch-jd.ts";

describe("parseAtsUrl", () => {
  it("parses a Greenhouse URL", () => {
    const result = parseAtsUrl(
      "https://boards.greenhouse.io/acmecorp/jobs/7654321",
    );
    expect(result).toEqual({
      platform: "greenhouse",
      company: "acmecorp",
      jobId: "7654321",
    });
  });

  it("parses a Lever URL", () => {
    const result = parseAtsUrl(
      "https://jobs.lever.co/acmecorp/abcd1234-ef56-7890-abcd-ef1234567890",
    );
    expect(result).toEqual({
      platform: "lever",
      company: "acmecorp",
      jobId: "abcd1234-ef56-7890-abcd-ef1234567890",
    });
  });

  it("parses a Workable URL", () => {
    const result = parseAtsUrl(
      "https://apply.workable.com/acmecorp/j/AB12CD34EF",
    );
    expect(result).toEqual({
      platform: "workable",
      company: "acmecorp",
      jobId: "AB12CD34EF",
    });
  });

  it("parses a Recruitee URL", () => {
    const result = parseAtsUrl(
      "https://acmecorp.recruitee.com/o/senior-software-engineer",
    );
    expect(result).toEqual({
      platform: "recruitee",
      company: "acmecorp",
      jobId: "senior-software-engineer",
    });
  });

  it("parses an Ashby URL", () => {
    const result = parseAtsUrl(
      "https://jobs.ashbyhq.com/acmecorp/12345678-90ab-cdef-1234-567890abcdef",
    );
    expect(result).toEqual({
      platform: "ashby",
      company: "acmecorp",
      jobId: "12345678-90ab-cdef-1234-567890abcdef",
    });
  });

  it("does not match an Ashby URL with a non-UUID jobId", () => {
    expect(
      parseAtsUrl("https://jobs.ashbyhq.com/acmecorp/not-a-uuid"),
    ).toBeNull();
  });

  it("returns null for a non-ATS URL", () => {
    const result = parseAtsUrl(
      "https://www.linkedin.com/jobs/view/1234567890",
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAtsUrl("")).toBeNull();
  });
});

describe("htmlToPlaintext", () => {
  it("strips tags and decodes entities", () => {
    const html = "<p>Hello&amp;</p><ul><li>A</li><li>B</li></ul>";
    const text = htmlToPlaintext(html);
    expect(text).toContain("Hello&");
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it("removes <style> and <script> blocks", () => {
    const html =
      "<style>body{color:red}</style><p>Content</p><script>alert(1)</script>";
    const text = htmlToPlaintext(html);
    expect(text).toContain("Content");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("alert");
  });

  it("converts <br> and block-end tags to newlines", () => {
    const html = "<p>First</p><p>Second</p><br/><p>Third</p>";
    const text = htmlToPlaintext(html);
    expect(text).toContain("First");
    expect(text).toContain("Second");
    expect(text).toContain("Third");
    // No consecutive runs of 3+ newlines
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("decodes &lt; &gt; &quot; &#39; &nbsp;", () => {
    const html = "<p>&lt;tag&gt; &quot;quoted&quot; it&#39;s&nbsp;fine</p>";
    const text = htmlToPlaintext(html);
    expect(text).toContain("<tag>");
    expect(text).toContain('"quoted"');
    expect(text).toContain("it's");
    expect(text).toContain("fine");
  });

  it("trims and collapses excess newlines", () => {
    const html = "<p>A</p>\n\n\n\n<p>B</p>";
    const text = htmlToPlaintext(html);
    expect(text.startsWith("A")).toBe(true);
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe("fetchJdFromUrl — Ashby", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hits the public job-board API and returns the matched posting as plaintext", async () => {
    const targetId = "12345678-90ab-cdef-1234-567890abcdef";
    const fakeResponse = {
      jobBoard: { name: "Acme Corp" },
      jobPostings: [
        {
          id: "00000000-0000-0000-0000-000000000000",
          title: "Other Role",
          descriptionHtml: "<p>not this one</p>",
        },
        {
          id: targetId,
          title: "Staff Engineer",
          descriptionHtml: "<p>Build distributed systems with Kubernetes.</p>",
        },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.ashbyhq.com/posting-api/job-board/acmecorp",
      );
      return new Response(JSON.stringify(fakeResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJdFromUrl(
      `https://jobs.ashbyhq.com/acmecorp/${targetId}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("ashby");
    expect(result!.title).toBe("Staff Engineer");
    expect(result!.company).toBe("Acme Corp");
    expect(result!.text).toContain("Build distributed systems with Kubernetes.");
    expect(result!.text).not.toMatch(/<[^>]+>/);
  });

  it("returns null when the posting id isn't in the board listing", async () => {
    const fakeResponse = {
      jobBoard: { name: "Acme Corp" },
      jobPostings: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Unrelated Role",
          descriptionHtml: "<p>nope</p>",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(fakeResponse), { status: 200 }),
      ),
    );

    const result = await fetchJdFromUrl(
      "https://jobs.ashbyhq.com/acmecorp/22222222-2222-2222-2222-222222222222",
    );
    expect(result).toBeNull();
  });

  it("returns null when the API call fails (non-2xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );

    const result = await fetchJdFromUrl(
      "https://jobs.ashbyhq.com/missingco/12345678-90ab-cdef-1234-567890abcdef",
    );
    expect(result).toBeNull();
  });
});
