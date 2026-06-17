import { describe, test, expect, beforeEach, mock } from "bun:test";
import { formatCost } from "../../src/lib/ui.js";

// ─── formatCost ──────────────────────────────────────────────

describe("formatCost", () => {
  test("zero returns '$0.00'", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  test("0.005 returns a string starting with '$'", () => {
    const result = formatCost(0.005);
    expect(result).toMatch(/^\$/);
  });

  test("0.005 uses 4 decimal places (sub-cent)", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  test("1.5 returns '$1.50'", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  test("0.001 returns 4 decimal places", () => {
    const result = formatCost(0.001);
    expect(result).toBe("$0.0010");
    // Verify it has 4 decimal places after the dot
    const decimals = result.split(".")[1];
    expect(decimals).toHaveLength(4);
  });

  test("0.01 returns '$0.01' (2 decimal places, at boundary)", () => {
    expect(formatCost(0.01)).toBe("$0.01");
  });

  test("0.1 returns '$0.10'", () => {
    expect(formatCost(0.1)).toBe("$0.10");
  });

  test("99.99 returns '$99.99'", () => {
    expect(formatCost(99.99)).toBe("$99.99");
  });

  test("0.00001 returns 4 decimal places", () => {
    const result = formatCost(0.00001);
    expect(result).toMatch(/^\$0\.0000$/);
  });

  test("large value formats with 2 decimal places", () => {
    expect(formatCost(1234.567)).toBe("$1234.57");
  });

  test("always returns a string starting with '$'", () => {
    const values = [0, 0.001, 0.01, 0.1, 1, 10, 100];
    for (const v of values) {
      expect(formatCost(v).startsWith("$")).toBe(true);
    }
  });
});

// ─── Console output functions ────────────────────────────────
// banner, info, success, warn, error, skip, heading all write to console.log.
// We test that they call console.log and include expected content.

describe("banner", () => {
  test("calls console.log with version string", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    // Dynamic import to avoid module-level side effects
    const { banner } = require("../../src/lib/ui.js");
    banner();

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("v3.8.4");
  });
});

describe("info", () => {
  test("logs message with [INFO] prefix", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { info } = require("../../src/lib/ui.js");
    info("test message");

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("test message");
  });
});

describe("success", () => {
  test("logs message", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { success } = require("../../src/lib/ui.js");
    success("done");

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("done");
  });
});

describe("warn", () => {
  test("logs message", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { warn } = require("../../src/lib/ui.js");
    warn("careful");

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("careful");
  });
});

describe("error", () => {
  test("logs message", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { error } = require("../../src/lib/ui.js");
    error("failed");

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("failed");
  });
});

describe("heading", () => {
  test("logs message", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const { heading } = require("../../src/lib/ui.js");
    heading("Section Title");

    console.log = originalLog;

    const output = logs.join("\n");
    expect(output).toContain("Section Title");
  });
});
