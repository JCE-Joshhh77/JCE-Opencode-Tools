import { describe, expect, test } from "bun:test";
import golden from "../fixtures/skill-routing-golden.json";
import { explainSkillRouting, SKILL_REGISTRY } from "../../src/plugin/lib/skill-loader.ts";

describe("skill routing golden corpus", () => {
  test("registry sample prompts stay routable", () => {
    for (const [skill, entry] of Object.entries(SKILL_REGISTRY)) {
      if (entry.routingMode !== "auto") continue;
      const report = explainSkillRouting(entry.samplePrompts[0] ?? "");
      expect(report.selected.map((item) => item.skill)).toContain(skill);
      expect(report.confidence).toBeGreaterThan(0);
    }
  });

  test("golden corpus keeps required selections and suppressions", () => {
    for (const item of golden) {
      const report = explainSkillRouting(item.prompt);
      const selected = report.selected.map((entry) => entry.skill);
      for (const skill of item.mustSelect) expect(selected).toContain(skill);
      for (const skill of item.mustReject) expect(selected).not.toContain(skill);
      expect(report.confidence).toBeGreaterThan(0);
    }
  });
});
