// Экспорт JSON-схем функций и снимка демо для голосового сервиса (Python читает packages/dialog/generated/*.json)
import { writeFileSync } from "node:fs";
import { TOOLS, DEMO_SNAPSHOT } from "../src/index.ts";
writeFileSync(new URL("../generated/tools.json", import.meta.url), JSON.stringify(TOOLS, null, 2));
writeFileSync(new URL("../generated/demo-snapshot.json", import.meta.url), JSON.stringify(DEMO_SNAPSHOT, null, 2));
console.log("ok");
