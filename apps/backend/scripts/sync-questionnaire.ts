import { BLOCKS } from "../../../packages/dialog/src/questionnaire";
import { readFileSync, writeFileSync } from "node:fs";
const path = new URL("../core/questionnaire.json", import.meta.url);
const content = JSON.stringify(BLOCKS, null, 2);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== content) throw new Error("Questionnaire schema changed: regenerate core/questionnaire.json");
} else writeFileSync(path, content);
