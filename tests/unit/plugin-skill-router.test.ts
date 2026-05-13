import { describe, expect, test } from "bun:test";
import { routeJceWorkerIntent } from "../../src/plugin/lib/skill-router.ts";

describe("JCE-Worker skill router", () => {
  test("routes bugs and failing tests to debugging and TDD", () => {
    const route = routeJceWorkerIntent("fix this failing test and debug the crash");

    expect(route.intent).toBe("bugfix");
    expect(route.skills).toEqual(["jce-worker-operating-system", "verification-discipline", "systematic-debugging", "test-driven-development"]);
    expect(route.reason).toContain("bug or failing test");
  });

  test("routes capitalized bugfix markers to debugging and TDD", () => {
    const route = routeJceWorkerIntent("FIX failing test");

    expect(route.intent).toBe("bugfix");
    expect(route.skills).toContain("verification-discipline");
  });

  test("does not treat fixtures as fix intent", () => {
    const route = routeJceWorkerIntent("explain fixtures in the test suite");

    expect(route.intent).toBe("general");
    expect(route.skills).toEqual(["jce-worker-operating-system"]);
  });

  test("routes feature work to brainstorming planning and TDD", () => {
    const route = routeJceWorkerIntent("add a new workflow runtime behavior");

    expect(route.intent).toBe("feature");
    expect(route.skills).toEqual(["jce-worker-operating-system", "codebase-intelligence", "brainstorming", "writing-plans", "test-driven-development"]);
  });

  test("does not treat address as add intent", () => {
    const route = routeJceWorkerIntent("address the architecture notes");

    expect(route.intent).toBe("general");
    expect(route.skills).toEqual(["jce-worker-operating-system"]);
  });

  test("routes completion claims to verification before completion", () => {
    const route = routeJceWorkerIntent("done, this is complete and ready");

    expect(route.intent).toBe("completion_claim");
    expect(route.skills).toEqual(["verification-discipline", "verification-before-completion"]);
  });

  test("routes review requests to requesting code review", () => {
    const route = routeJceWorkerIntent("please review this implementation");

    expect(route.intent).toBe("review");
    expect(route.skills).toEqual(["codebase-intelligence", "verification-discipline", "requesting-code-review"]);
  });

  test("routes mixed review and completion intent to review", () => {
    const route = routeJceWorkerIntent("please review this completed implementation");

    expect(route.intent).toBe("review");
    expect(route.skills).toContain("requesting-code-review");
  });

  test("routes branch wrap-up to finishing development branch", () => {
    const route = routeJceWorkerIntent("finish this branch and prepare merge");

    expect(route.intent).toBe("branch_completion");
    expect(route.skills).toEqual(["release-engineering", "verification-discipline", "finishing-a-development-branch"]);
  });

  test("routes mixed audit and finished branch intent to branch completion", () => {
    const route = routeJceWorkerIntent("audit the finished branch before merge");

    expect(route.intent).toBe("branch_completion");
    expect(route.skills).toContain("release-engineering");
  });

  test("routes parallel work to parallel agent workflow", () => {
    const route = routeJceWorkerIntent("run independent research tasks in parallel");

    expect(route.intent).toBe("parallel_work");
    expect(route.skills).toEqual(["delegation-quality", "dispatching-parallel-agents"]);
    expect(route.agentHint).toBe("explorer");
  });

  test("defaults to general planning when no specific intent matches", () => {
    const route = routeJceWorkerIntent("explain the current architecture");

    expect(route.intent).toBe("general");
    expect(route.skills).toEqual(["jce-worker-operating-system"]);
    expect(route.reason).toContain("operating protocol");
  });

  test("routes audits through codebase intelligence and verification discipline", () => {
    const route = routeJceWorkerIntent("audit full plugin saya ini");

    expect(route.intent).toBe("review");
    expect(route.skills).toContain("codebase-intelligence");
    expect(route.skills).toContain("verification-discipline");
  });

  test("routes release requests through release engineering", () => {
    const route = routeJceWorkerIntent("prepare release, commit, push, and tag");

    expect(route.intent).toBe("branch_completion");
    expect(route.skills).toContain("release-engineering");
  });
});
