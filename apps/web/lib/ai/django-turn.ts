import "server-only";
import { buildSnapshot, respondOffline, initialState, type DialogState, type SnapshotInput } from "@all/dialog";
import { djangoFetch } from "../django";
import type { AssistantReply } from "../actions";

export async function djangoAssistantTurn(input: { conversationId?: string; message: string; channel?: "voice" | "chat" }): Promise<AssistantReply> {
  const ctx = await djangoFetch<{ conversationId: string; state: DialogState; snapshot: Omit<SnapshotInput, "version">; version: number; revision: string }>("/commands/assistantContext/", { method: "POST", body: JSON.stringify({ args: [input.conversationId] }) });
  const snapshot = buildSnapshot({ ...ctx.snapshot, version: ctx.version });
  const reply = respondOffline(snapshot, input.message, Object.keys(ctx.state).length ? ctx.state : initialState(), { channel: input.channel ?? "chat", mode: "consult", phase: "1a" });
  return djangoFetch<AssistantReply>("/commands/assistantCommit/", { method: "POST", body: JSON.stringify({ args: [{ conversationId: ctx.conversationId, revision: ctx.revision, message: input.message, reply }] }) });
}
