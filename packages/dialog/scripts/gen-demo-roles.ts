import { DEMO_ROLE_KEYS, demoSnapshot } from "../src/demo-roles";
import { writeFileSync } from "node:fs";
writeFileSync(new URL("../generated/demo-roles.json", import.meta.url), JSON.stringify(Object.fromEntries(DEMO_ROLE_KEYS.map((role) => [role, demoSnapshot(role)])), null, 2) + "\n");
