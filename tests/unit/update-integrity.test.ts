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
});
