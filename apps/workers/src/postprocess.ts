type Turn = { speaker: "ai" | "caller" | "operator"; text: string };

/**
 * Резюме и классификация звонка. В проде — LLM (LLM_PRIMARY) с JSON-схемой ответа;
 * здесь детерминированный разбор как резервный путь и для тестов.
 */
export function classify(turns: Turn[]) {
  const caller = turns.filter((t) => t.speaker === "caller").map((t) => t.text.toLowerCase()).join(" ");
  const ai = turns.filter((t) => t.speaker === "ai").map((t) => t.text.toLowerCase()).join(" ");
  const type =
    /(жалоб|недовол|безобраз|испортил)/.test(caller) ? "complaint" :
    /(перенес|перенос)/.test(caller) ? "reschedule" :
    /(запис|записать)/.test(caller) || /записал/.test(ai) ? "booking" :
    /(реклам|продвижен|seo)/.test(caller) ? "spam" :
    caller.length < 20 ? "irrelevant" : "consultation";
  const transferred = turns.some((t) => t.speaker === "operator");
  const outcome = transferred ? "transferred" : /записал|заявк|передам/.test(ai) ? "lead_created" : turns.length <= 2 ? "dropped" : "no_result";
  const flags: string[] = [];
  const unanswered: string[] = [];
  turns.forEach((t, i) => {
    if (t.speaker === "ai" && /уточнит администратор/i.test(t.text)) {
      flags.push("unanswered");
      const q = turns.slice(0, i).reverse().find((x) => x.speaker === "caller");
      if (q) unanswered.push(q.text);
    }
  });
  return { type, outcome, flags: Array.from(new Set(flags)), unanswered };
}

export function summarize(turns: Turn[]): string {
  const first = turns.find((t) => t.speaker === "caller")?.text ?? "";
  const lastAi = [...turns].reverse().find((t) => t.speaker === "ai")?.text ?? "";
  return `${first.replace(/[.?!]*$/, "")}. ${lastAi}`.slice(0, 400);
}
