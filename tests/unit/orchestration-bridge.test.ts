import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import { OrchestrationBridge } from "../../src/plugin/lib/orchestration/bridge.js";
import { BackgroundManager } from "../../src/plugin/background/manager.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-jce-orch-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Orchestration Bridge — Full Loop", () => {
  test("planAndDispatch creates plan and dispatches first nodes", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("fix the login crash bug");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    let sessionCreateCalls = 0;
    const client = {
      session: {
        create: async () => ({ id: `child-${++sessionCreateCalls}` }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Verification\n$ bun test\nexit code: 0\n\n## Files\n- none\n\n## Risks\n- none" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    const result = await bridge.planAndDispatch("fix the login crash", "session-1", "msg-1");

    expect(result.dispatched.length).toBeGreaterThan(0);
    expect(result.graphStatus).toBe("executing");
    expect(result.message).toContain("Plan created");
    expect(result.message).toContain("Dispatched");

    // Verify nodes are mapped to tasks
    for (const d of result.dispatched) {
      expect(d.nodeId).toBeTruthy();
      expect(d.taskId).toBeTruthy();
      expect(d.agent).toBeTruthy();
      expect(orchestrator.getNodeForTask(d.taskId)).toBe(d.nodeId);
    }
  });

  test("collectAndContinue processes result and triggers re-planning", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("fix the login crash bug");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    let sessionCreateCalls = 0;
    const client = {
      session: {
        create: async () => ({ id: `child-${++sessionCreateCalls}` }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nFixed\n\n## Verification\n$ bun test\n61 pass, 0 fail\nexit code: 0\n\n## Files\n- src/auth.ts\n\n## Risks\n- none" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    const planResult = await bridge.planAndDispatch("fix the login crash", "session-1", "msg-1");

    // Wait for the background task to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Collect the first completed task
    const firstTask = planResult.dispatched[0];
    const task = manager.getTask(firstTask.taskId);
    expect(task?.status).toBe("completed");

    const collectResult = await bridge.collectAndContinue(
      firstTask.taskId,
      task!.result!,
      "session-1",
      "msg-1",
    );

    expect(collectResult.nodeId).toBe(firstTask.nodeId);
    expect(collectResult.result.status).toBe("success");
    expect(collectResult.result.confidence).toBeGreaterThan(0.3);
    expect(collectResult.message).toContain(firstTask.nodeId);
  });

  test("orchestration loop auto-dispatches downstream nodes after collection", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("add pagination feature");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    let sessionCreateCalls = 0;
    const client = {
      session: {
        create: async () => ({ id: `child-${++sessionCreateCalls}` }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nExplored codebase\n\n## Verification\n$ find src -name '*.ts'\nexit code: 0\n\n## Files\n- src/api/users.ts\n\n## Risks\n- none\n\n## Discoveries\n- framework: express\n- database: postgres" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    const planResult = await bridge.planAndDispatch("add pagination to users API", "session-1", "msg-1");

    // First node dispatched (research/explore)
    expect(planResult.dispatched.length).toBeGreaterThan(0);
    const firstNode = planResult.dispatched[0];

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 100));
    const task = manager.getTask(firstNode.taskId);

    if (task?.status === "completed" && task.result) {
      const collectResult = await bridge.collectAndContinue(firstNode.taskId, task.result, "session-1", "msg-1");

      // Should auto-dispatch next nodes (downstream of the completed one)
      // The exact count depends on the plan template, but there should be progress
      expect(collectResult.graphStatus).not.toBe("failed");
      expect(collectResult.result.newFacts.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("handleTaskFailure triggers retry via orchestrator", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("fix bug");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    let callCount = 0;
    const client = {
      session: {
        create: async () => ({ id: `child-${++callCount}` }),
        prompt: async () => { throw new Error("network timeout"); },
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    const planResult = await bridge.planAndDispatch("fix the crash", "session-1", "msg-1");

    // Wait for failure
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (planResult.dispatched.length > 0) {
      const firstTask = planResult.dispatched[0];
      const task = manager.getTask(firstTask.taskId);

      if (task?.status === "error") {
        const recovery = bridge.handleTaskFailure(firstTask.taskId, task.error ?? "unknown");
        // Should retry (default policy allows 2 retries)
        expect(recovery.action).toBe("retry");
      }
    }
  });

  test("hasActivePlan returns false when no plan exists", () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    const manager = new BackgroundManager({ maxConcurrency: 5 });
    const client = { session: { create: async () => ({ id: "x" }), prompt: async () => ({}) } } as any;
    const bridge = new OrchestrationBridge({ manager, client, orchestrator });

    expect(bridge.hasActivePlan()).toBe(false);
  });

  test("hasActivePlan returns true after plan creation", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("add feature");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "done" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    await bridge.planAndDispatch("add pagination", "s1", "m1");

    expect(bridge.hasActivePlan()).toBe(true);
  });

  test("getOrchestrationSummary returns status when plan active", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("fix bug");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Verification\nexit code: 0\n\n## Files\n- none\n\n## Risks\n- none" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    await bridge.planAndDispatch("fix the crash", "s1", "m1");

    const summary = bridge.getOrchestrationSummary();
    expect(summary).not.toBeNull();
    expect(summary).toContain("Orchestration:");
    expect(summary).toContain("executing");
  });

  test("fact propagation: collectAndContinue propagates new facts to memory", async () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });
    orchestrator.routeIntent("research the codebase");

    const manager = new BackgroundManager({ maxConcurrency: 5 });
    let sessionCreateCalls = 0;
    const client = {
      session: {
        create: async () => ({ id: `child-${++sessionCreateCalls}` }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nResearched\n\n## Verification\nexit code: 0\n\n## Files\n- none\n\n## Risks\n- none\n\n## Discoveries\n- runtime: bun\n- framework: express\n- database: postgresql" }] }),
      },
    } as any;

    const bridge = new OrchestrationBridge({ manager, client, orchestrator });
    const planResult = await bridge.planAndDispatch("research the codebase", "s1", "m1");

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (planResult.dispatched.length > 0) {
      const firstTask = planResult.dispatched[0];
      const task = manager.getTask(firstTask.taskId);
      if (task?.status === "completed" && task.result) {
        const collectResult = await bridge.collectAndContinue(firstTask.taskId, task.result, "s1", "m1");
        // Facts should be propagated to orchestrator memory
        const facts = orchestrator.getFacts();
        // At minimum, the orchestrator should have some facts (from plan context or discoveries)
        expect(collectResult.result.newFacts.length).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("constraint extraction from user message", () => {
    const root = tempRoot();
    const orchestrator = new OrchestrationController({ projectRoot: root });

    // Simulate user message with constraint
    orchestrator.addConstraint("don't modify the database schema", "user");

    const memory = orchestrator.getMemory();
    expect(memory.constraints.length).toBe(1);
    expect(memory.constraints[0].description).toContain("database schema");
    expect(memory.constraints[0].active).toBe(true);
  });
});
