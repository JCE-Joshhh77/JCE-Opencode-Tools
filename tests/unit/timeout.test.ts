import { describe, expect, test } from "bun:test";
import { withTimeout, resolvePositiveEnvMs } from "../../src/lib/timeout.ts";

describe("shared withTimeout helper", () => {
  test("resolves with the original value when the promise settles before the timer", async () => {
    const value = await withTimeout(Promise.resolve("ok"), 1000, "fast op");
    expect(value).toBe("ok");
  });

  test("rejects with descriptive timeout error when the inner promise never resolves", async () => {
    let release: ((v: string) => void) | undefined;
    const deferred = new Promise<string>((resolve) => { release = resolve; });
    try {
      await withTimeout(deferred, 30, "slow op").then(
        () => { throw new Error("Should not resolve before timeout"); },
        (err) => {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message).toContain("slow op timed out after");
        },
      );
    } finally {
      release?.("late");
    }
  });

  test("propagates a real rejection unchanged when the inner promise rejects first", async () => {
    await withTimeout(Promise.reject(new Error("real failure")), 1000, "any op").then(
      () => { throw new Error("Should reject"); },
      (err) => {
        expect((err as Error).message).toBe("real failure");
      },
    );
  });

  test("envOverride beats the static fallback when the env var is a positive integer", async () => {
    const envName = "OPENCODE_JCE_TEST_TIMEOUT_MS";
    const previous = process.env[envName];
    process.env[envName] = "25";
    let release: ((v: string) => void) | undefined;
    const deferred = new Promise<string>((resolve) => { release = resolve; });
    try {
      const start = Date.now();
      await withTimeout(deferred, 10_000, "env-overridden op", { envOverride: envName }).then(
        () => { throw new Error("Should time out via env override"); },
        (err) => {
          const elapsed = Date.now() - start;
          expect((err as Error).message).toContain("25ms");
          // Must reject roughly at the env-overridden timeout, not the 10s default.
          expect(elapsed).toBeLessThan(1000);
        },
      );
    } finally {
      release?.("late");
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test("returns the original promise unchanged for non-positive timeouts", async () => {
    const value = await withTimeout(Promise.resolve(42), 0, "no-op");
    expect(value).toBe(42);
    const value2 = await withTimeout(Promise.resolve(43), -100, "no-op");
    expect(value2).toBe(43);
  });

  test("resolvePositiveEnvMs returns fallback when env is missing or invalid", () => {
    const name = "OPENCODE_JCE_TEST_INVALID_TIMEOUT_MS";
    delete process.env[name];
    expect(resolvePositiveEnvMs(name, 7000)).toBe(7000);
    process.env[name] = "not-a-number";
    expect(resolvePositiveEnvMs(name, 7000)).toBe(7000);
    process.env[name] = "0";
    expect(resolvePositiveEnvMs(name, 7000)).toBe(7000);
    process.env[name] = "-5";
    expect(resolvePositiveEnvMs(name, 7000)).toBe(7000);
    process.env[name] = "1500";
    expect(resolvePositiveEnvMs(name, 7000)).toBe(1500);
    delete process.env[name];
  });
});
