import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  CONTEXT_INDEX_SESSION,
  CONTEXT_INDEX_DIR,
  CONTEXT_NOTES_DIR,
  inferContextBucket,
  listContextBuckets,
  readContextIndex,
  writeContextIndex,
  pruneContextIndexNotes,
  getContextIndexStats,
} from "../../src/lib/context-index.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jce-context-index-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("context index", () => {
  test("infers release bucket from release signals", () => {
    expect(inferContextBucket({ summary: "Bumped version and pushed release tag" })).toBe("release");
  });

  test("writes master index, bucket index, and detailed note", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, {
      summary: "Released v3.4.0 with context index support",
      changedFiles: ["CHANGELOG.md", "package.json"],
      verification: ["bun test", "bun run typecheck"],
      agent: "JCE-Worker",
    });

    expect(result).not.toBeNull();
    expect(result!.bucket).toBe("release");
    expect(result!.sessionPath).toBe(CONTEXT_INDEX_SESSION);

    const session = await readContextIndex(root);
    expect(session).toContain("# JCE Context Index");
    expect(session).toContain("`release`");

    const releaseIndex = await readContextIndex(root, { bucket: "release" });
    expect(releaseIndex).toContain("Released v3.4.0");
    expect(releaseIndex).toContain("../notes/");
    const link = result!.entry.split(" -> ")[1];
    expect(normalize(join(root, dirname(result!.indexPath), link))).toBe(normalize(join(root, result!.notePath!)));

    const note = await readFile(join(root, result!.notePath!), "utf8");
    expect(note).toContain("## Files");
    expect(note).toContain("CHANGELOG.md");
    expect(note).toContain("## Verification");
    expect(note).toContain("bun run typecheck");
  });

  test("lists created buckets", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "agents", summary: "Updated agent handoff rules" });
    await writeContextIndex(root, { bucket: "testing", summary: "Recorded test matrix" });

    await expect(listContextBuckets(root)).resolves.toEqual(["agents", "testing"]);
  });

  test("sanitizes custom bucket names", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, { bucket: "Release Notes!!", summary: "Recorded release notes" });

    expect(result!.bucket).toBe("release-notes");
    await expect(readContextIndex(root, { bucket: "Release Notes!!" })).resolves.toContain("Recorded release notes");
    await expect(listContextBuckets(root)).resolves.toEqual(["release-notes"]);
  });

  test("deduplicates by summary text, not full entry", async () => {
    const root = await tempRoot();
    const first = await writeContextIndex(root, { bucket: "testing", summary: "Smoke verified context index" });
    const second = await writeContextIndex(root, { bucket: "testing", summary: "Smoke verified context index" });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const index = await readContextIndex(root, { bucket: "testing" });
    expect(index.match(/Smoke verified context index/g)?.length).toBe(1);
  });

  test("allows different summaries in same bucket", async () => {
    const root = await tempRoot();
    const first = await writeContextIndex(root, { bucket: "testing", summary: "First verification run" });
    const second = await writeContextIndex(root, { bucket: "testing", summary: "Second verification run" });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const index = await readContextIndex(root, { bucket: "testing" });
    expect(index).toContain("First verification run");
    expect(index).toContain("Second verification run");
  });

  test("noise filter rejects empty summary and no verification", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, { summary: "short" });
    expect(result).toBeNull();
  });

  test("noise filter accepts meaningful verification", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, { verification: ["bun test passed"] });
    expect(result).not.toBeNull();
  });

  test("noise filter accepts meaningful summary", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, { summary: "Released v3.4.2 with context index reliability fixes" });
    expect(result).not.toBeNull();
  });

  test("search filter by keyword", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "testing", summary: "Verified context index works correctly" });
    await writeContextIndex(root, { bucket: "testing", summary: "Verified release pipeline runs" });

    const filtered = await readContextIndex(root, { bucket: "testing", keyword: "release" });
    expect(filtered).toContain("release pipeline");
    expect(filtered).not.toContain("context index works");
  });

  test("search filter by agent", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "testing", summary: "First test run completed", agent: "OpenCode" });
    await writeContextIndex(root, { bucket: "testing", summary: "Second test run completed", agent: "JCE-Worker" });

    const filtered = await readContextIndex(root, { bucket: "testing", agent: "JCE-Worker" });
    expect(filtered).toContain("Second test run");
    expect(filtered).not.toContain("First test run");
  });

  test("stats returns correct counts", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "testing", summary: "Verified test suite one" });
    await writeContextIndex(root, { bucket: "testing", summary: "Verified test suite two" });
    await writeContextIndex(root, { bucket: "release", summary: "Released version one" });

    const stats = await getContextIndexStats(root);
    expect(stats.totalNotes).toBe(3);
    expect(stats.totalEntries).toBe(3);
    expect(stats.buckets.length).toBe(2);
    const testing = stats.buckets.find((b) => b.name === "testing");
    expect(testing!.entryCount).toBe(2);
    expect(testing!.noteCount).toBe(2);
  });

  test("prune deletes old notes by age", async () => {
    const root = await tempRoot();
    const result = await writeContextIndex(root, { bucket: "testing", summary: "Old test note for pruning" });
    expect(result).not.toBeNull();

    // Prune with maxAge=0 (delete everything older than now)
    const pruned = await pruneContextIndexNotes(root, "testing", { maxAge: 0 });
    expect(pruned.deletedNotes.length).toBe(1);
    expect(pruned.bucket).toBe("testing");
  });

  test("prune dryRun does not delete files", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "testing", summary: "Dry run test note for pruning" });

    const pruned = await pruneContextIndexNotes(root, "testing", { maxAge: 0, dryRun: true });
    expect(pruned.deletedNotes.length).toBe(1);

    // File should still exist
    const notes = await readContextIndex(root, { bucket: "testing" });
    expect(notes).toContain("Dry run test note");
  });

  test("prune by maxNotes keeps newest", async () => {
    const root = await tempRoot();
    await writeContextIndex(root, { bucket: "testing", summary: "Note alpha for pruning" });
    await writeContextIndex(root, { bucket: "testing", summary: "Note beta for pruning" });
    await writeContextIndex(root, { bucket: "testing", summary: "Note gamma for pruning" });

    const pruned = await pruneContextIndexNotes(root, "testing", { maxNotes: 1 });
    expect(pruned.deletedNotes.length).toBe(2);

    const index = await readContextIndex(root, { bucket: "testing" });
    expect(index).toContain("Note gamma");
  });

  test("bucket inference uses weighted scoring for files", () => {
    expect(inferContextBucket({
      summary: "Updated config",
      changedFiles: ["install.ps1", "install.sh"],
    })).toBe("release");

    expect(inferContextBucket({
      summary: "Updated config",
      changedFiles: ["src/lib/context-index.ts"],
    })).toBe("config");
  });

  test("bucket inference falls back to general for weak signals", () => {
    expect(inferContextBucket({ summary: "Did some stuff" })).toBe("general");
  });
});
