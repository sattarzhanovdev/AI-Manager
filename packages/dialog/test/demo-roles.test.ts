import { it, expect } from "vitest";
import { demoSnapshot, detectDemoRole, DEMO_ROLE_KEYS } from "../src/demo-roles";
it("detects all six roles including DTMF and clinic/poly-clinic ambiguity", () => {
  expect(DEMO_ROLE_KEYS.map((_, i) => detectDemoRole(String(i + 1)))).toEqual([...DEMO_ROLE_KEYS]);
  expect(detectDemoRole("А теперь поликлиника")).toBe("polyclinic");
  expect(detectDemoRole("Как будто звоню в шиномонтаж")).toBe("autoservice");
  expect(detectDemoRole("Давайте стоматологию")).toBe("dental");
});
it("medical demo roles have isolated facts and no repair prices", () => {
  for (const role of ["clinic", "dental", "polyclinic"] as const) {
    const s = demoSnapshot(role);
    expect(JSON.stringify(s.services)).not.toMatch(/масл|колодк|двигател/i);
    expect(s.company.sphere).toBe(role);
    expect(s.stop.topics).toContain("Диагноз");
  }
});
