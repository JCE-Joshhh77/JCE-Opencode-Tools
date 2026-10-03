import { describe, expect, test } from "bun:test";
import { fetchRefSha } from "../../src/commands/update.ts";

describe("update integrity ref resolution", () => {
  test("prefers peeled tag SHA for annotated tags", async () => {
    const originalSpawn = Bun.spawn;
    const lsRemoteOutput = [
      "1111111111111111111111111111111111111111\trefs/tags/v3.6.0",
      "2222222222222222222222222222222222222222\trefs/tags/v3.6.0^{}",
    ].join("\n");

    Bun.spawn = ((cmd: string[]) => {
      if (cmd[0] === "git" && cmd[1] === "ls-remote") {
        return {
          exited: Promise.resolve(0),
          stdout: new Blob([lsRemoteOutput]).stream(),
          stderr: new Blob([""]).stream(),
        } as ReturnType<typeof Bun.spawn>;
      }
      throw new Error(`Unexpected command: ${cmd.join(" ")}`);
    }) as typeof Bun.spawn;

    try {
      await expect(fetchRefSha("owner/repo", "v3.6.0")).resolves.toBe("2222222222222222222222222222222222222222");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("prefers branch SHA when branch and tag share same ref name", async () => {
    const originalSpawn = Bun.spawn;
    const lsRemoteOutput = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/main",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/main",
    ].join("\n");

    Bun.spawn = ((cmd: string[]) => {
      if (cmd[0] === "git" && cmd[1] === "ls-remote") {
        return {
          exited: Promise.resolve(0),
          stdout: new Blob([lsRemoteOutput]).stream(),
          stderr: new Blob([""]).stream(),
        } as ReturnType<typeof Bun.spawn>;
      }
      throw new Error(`Unexpected command: ${cmd.join(" ")}`);
    }) as typeof Bun.spawn;

    try {
      await expect(fetchRefSha("owner/repo", "main")).resolves.toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("release resolution ignores a same-named branch", async () => {
    const originalSpawn = Bun.spawn;
    const lsRemoteOutput = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v3.6.0",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v3.6.0^{}",
      "cccccccccccccccccccccccccccccccccccccccc\trefs/heads/v3.6.0",
    ].join("\n");
    Bun.spawn = (() => ({
      exited: Promise.resolve(0),
      stdout: new Blob([lsRemoteOutput]).stream(),
      stderr: new Blob([""]).stream(),
    }) as ReturnType<typeof Bun.spawn>) as typeof Bun.spawn;
    try {
      await expect(fetchRefSha("owner/repo", "v3.6.0", true)).resolves.toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("installers and updater refuse main or missing-SHA fallback", async () => {
    const root = process.cwd();
    const [updateText, shText, psText] = await Promise.all([
      Bun.file(`${root}/src/commands/update.ts`).text(),
      Bun.file(`${root}/install.sh`).text(),
      Bun.file(`${root}/install.ps1`).text(),
    ]);
    expect(updateText).not.toContain('cloneRef = "main"');
    expect(updateText).toContain("has no resolvable commit SHA");
    expect(shText).not.toContain('git clone --depth 1 --branch "main"');
    expect(shText).toContain("refusing unverified install");
    expect(psText).not.toContain('git clone --depth 1 --branch "main"');
    expect(psText).toContain("refusing unverified install");
  });
});
