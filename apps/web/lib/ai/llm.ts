import "server-only";
import type { LlmConfig } from "../env";

/**
 * Минимальный клиент LLM с вызовом функций. Ключ хранится только на сервере.
 * Внутренний формат сообщений — как у Anthropic Messages API; для OpenAI конвертируется.
 */
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Msg { role: "user" | "assistant"; content: string | Block[] }
export interface LlmResult { text: string; toolUses: { id: string; name: string; input: Record<string, unknown> }[]; content: Block[]; usage: { input: number; output: number } }

export class LlmError extends Error {}

const TIMEOUT_MS = 25_000;

export async function callLlm(cfg: NonNullable<LlmConfig>, req: { system: string; messages: Msg[]; tools: ToolDef[]; maxTokens: number }): Promise<LlmResult> {
  return cfg.provider === "anthropic" ? anthropic(cfg, req) : openai(cfg, req);
}

async function anthropic(cfg: NonNullable<LlmConfig>, req: { system: string; messages: Msg[]; tools: ToolDef[]; maxTokens: number }): Promise<LlmResult> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages, tools: req.tools, temperature: 0.3 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => { throw new LlmError(e instanceof Error ? e.name : "network"); });
  if (!r.ok) throw new LlmError(`anthropic_${r.status}`);
  const j = (await r.json()) as { content: Block[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const content = j.content ?? [];
  return {
    content,
    text: content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim(),
    toolUses: content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} })),
    usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 },
  };
}

type OaMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function openai(cfg: NonNullable<LlmConfig>, req: { system: string; messages: Msg[]; tools: ToolDef[]; maxTokens: number }): Promise<LlmResult> {
  const messages: OaMsg[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (typeof m.content === "string") { messages.push({ role: m.role, content: m.content }); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = m.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const b of m.content) {
        if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
        else if (b.type === "text") messages.push({ role: "user", content: b.text });
      }
    }
  }
  const { OPENAI_BASE_URL } = (await import("../env")).env;
  const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model, max_tokens: req.maxTokens, temperature: 0.3, messages,
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => { throw new LlmError(e instanceof Error ? e.name : "network"); });
  if (!r.ok) throw new LlmError(`openai_${r.status}`);
  const j = (await r.json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const msg = j.choices[0]?.message;
  const toolUses = (msg?.tool_calls ?? []).map((c) => {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function.arguments) as Record<string, unknown>; } catch { /* пустые аргументы */ }
    return { id: c.id, name: c.function.name, input };
  });
  const text = (msg?.content ?? "").trim();
  const content: Block[] = [...(text ? [{ type: "text" as const, text }] : []), ...toolUses.map((t) => ({ type: "tool_use" as const, ...t }))];
  return { content, text, toolUses, usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
}
