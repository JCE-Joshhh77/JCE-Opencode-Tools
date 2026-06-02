import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  CONTEXT_INDEX_SESSION,
  inferContextBucket,
  listContextBuckets,
  readContextIndex,
  writeContextIndex,
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

    const releaseIndex = await readContextIndex(root, "release");
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
});
