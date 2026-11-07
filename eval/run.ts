// Eval-набор диалогов: pnpm eval. Метрики не должны падать больше чем на 2 п.п. от прошлого прогона.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DEMO_SNAPSHOT, initialState, respondOffline, PROMPT_VERSION, type AiModeKey, type EngineReply } from "@all/dialog";

interface Scenario {
  id: string;
  mode?: AiModeKey;
  turns: string[];
  expect: {
    contains?: string; notContains?: string; notContainsLast?: string; noDigits?: boolean; noDigitsWithCurrency?: boolean;
    handoff?: string; tool?: string; unanswered?: boolean; maxTurns?: number;
  };
}

const scenarios: Scenario[] = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url), "utf8"));
const results: { id: string; ok: boolean; why: string[]; transcript: string[] }[] = [];

for (const sc of scenarios) {
  let state = initialState();
  const replies: EngineReply[] = [];
  for (const t of sc.turns) {
    const r = respondOffline(DEMO_SNAPSHOT, t, state, { channel: "voice", mode: sc.mode ?? "consult" });
    replies.push(r);
    state = r.state;
  }
  const all = replies.map((r) => r.text).join(" ").toLowerCase();
  const last = replies.at(-1)?.text.toLowerCase() ?? "";
  const e = sc.expect;
  const why: string[] = [];
  if (e.contains && !all.includes(e.contains.toLowerCase())) why.push(`нет «${e.contains}»`);
  if (e.notContains && all.includes(e.notContains.toLowerCase())) why.push(`есть «${e.notContains}»`);
  if (e.notContainsLast && last.includes(e.notContainsLast.toLowerCase())) why.push(`переспросил: «${e.notContainsLast}»`);
  if (e.noDigits && /\d/.test(all)) why.push("назвал число");
  if (e.noDigitsWithCurrency && /\d[\d\s]*\s*(сом|тенге|руб)/.test(all)) why.push("назвал цену");
  if (e.handoff && !replies.some((r) => r.handoff?.reason === e.handoff)) why.push(`нет передачи ${e.handoff}`);
  if (e.tool && !replies.some((r) => r.toolCalls.some((t) => t.name === e.tool && t.status === "ok"))) why.push(`нет вызова ${e.tool}`);
  if (e.unanswered && !replies.some((r) => r.unanswered)) why.push("не отмечен вопрос без ответа");
  if (e.maxTurns && !replies.slice(0, e.maxTurns).some((r) => r.toolCalls.some((t) => t.name === "create_lead"))) why.push("заявка не за 1 реплику");
  results.push({ id: sc.id, ok: why.length === 0, why, transcript: sc.turns.flatMap((t, i) => [`> ${t}`, `< ${replies[i]?.text}`]) });
}

const passed = results.filter((r) => r.ok).length;
const score = Math.round((passed / results.length) * 1000) / 10;
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id}${r.ok ? "" : " — " + r.why.join("; ")}`);
  if (!r.ok) console.log("   " + r.transcript.join("\n   "));
}
console.log(`\n${PROMPT_VERSION}: ${passed}/${results.length} (${score}%)`);

const baselinePath = new URL("./baseline.json", import.meta.url);
if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as { score: number };
  if (score < base.score - 2) {
    console.error(`Регрессия: ${score}% против ${base.score}% в базовом прогоне`);
    process.exit(1);
  }
}
if (process.argv.includes("--update-baseline")) writeFileSync(baselinePath, JSON.stringify({ score, at: new Date().toISOString() }, null, 2));
