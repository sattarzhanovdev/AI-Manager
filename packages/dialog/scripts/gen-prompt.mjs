import { readFileSync, writeFileSync } from "node:fs";
const t = readFileSync(new URL("../prompts/assistant.ru.md", import.meta.url), "utf8");
writeFileSync(
  new URL("../src/prompt-template.ts", import.meta.url),
  `// Сгенерировано из prompts/assistant.ru.md: pnpm --filter @all/dialog gen:prompt\nexport const ASSISTANT_RU = ${JSON.stringify(t)};\n`,
);
