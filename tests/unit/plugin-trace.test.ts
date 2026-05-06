import { describe, expect, test } from "bun:test";
import { appendTraceEvent, createTraceEvent, pruneTraceEvents } from "../../src/plugin/lib/trace.ts";

describe("plugin trace", () => {
  test("creates trace events with type, task id, message, and timestamp", () => {
    const event = createTraceEvent({
      type: "task.created",
      taskId: "bg-1",
      message: "Task created",
      at: "2026-05-06T00:00:00.000Z",
    });

    expect(event.type).toBe("task.created");
    expect(event.taskId).toBe("bg-1");
    expect(event.message).toBe("Task created");
    expect(event.at).toBe("2026-05-06T00:00:00.000Z");
  });

  test("appends and prunes trace events to the newest max entries", () => {
    const events = Array.from({ length: 3 }, (_, index) =>
      createTraceEvent({
        type: "task.created",
        taskId: `bg-${index}`,
        message: `event ${index}`,
        at: `2026-05-06T00:00:0${index}.000Z`,
      }),
    );

    const appended = appendTraceEvent(events.slice(0, 2), events[2], 2);
    expect(appended.map((event) => event.taskId)).toEqual(["bg-1", "bg-2"]);
    expect(pruneTraceEvents(events, 1).map((event) => event.taskId)).toEqual(["bg-2"]);
  });
});
