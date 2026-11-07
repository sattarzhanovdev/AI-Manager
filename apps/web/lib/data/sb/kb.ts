import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, completeness, type FieldValues, type KbSnapshot } from "@all/dialog";
import type { Branch, Faq, QuestionnaireVersion, Service, StaffMember } from "@all/db";
import type { QuestionnaireState } from "../types";
import { toBranch, toFaq, toService, toStaff, toUnanswered } from "./map";

/**
 * База знаний (анкета) в Supabase.
 * Черновик — questionnaires.status = 'draft' (один на компанию): поля, услуги, сотрудники, FAQ привязаны к нему.
 * Публикация (RPC publish_questionnaire) делает черновик опубликованной версией, пишет неизменяемый снимок kb_snapshots
 * и создаёт новый черновик-копию. AI-ассистент отвечает по последнему снимку.
 */
type Sb = SupabaseClient;

export class KbError extends Error {}

function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new KbError(r.error.message);
  return r.data;
}

export async function draftId(sb: Sb, companyId: string): Promise<string> {
  const r = await sb.from("questionnaires").select("id").eq("company_id", companyId).eq("status", "draft").maybeSingle();
  const row = check(r);
  if (!row) throw new KbError("Черновик базы знаний не найден. Запустите provisioning демо-компании.");
  return String(row.id);
}

export interface DraftContent { qid: string; fields: FieldValues; sources: Record<string, string>; services: Service[]; staff: StaffMember[]; faq: Faq[] }

export async function loadQuestionnaire(sb: Sb, qid: string) {
  const [f, sv, st, fq] = await Promise.all([
    sb.from("questionnaire_fields").select("field_key, value, source").eq("questionnaire_id", qid),
    sb.from("services").select("*").eq("questionnaire_id", qid).order("created_at").order("name"),
    sb.from("staff").select("*").eq("questionnaire_id", qid).order("created_at").order("name"),
    sb.from("faq").select("*").eq("questionnaire_id", qid).order("created_at").order("question"),
  ]);
  const fields: FieldValues = {};
  const sources: Record<string, string> = {};
  for (const row of check(f) ?? []) { fields[String(row.field_key)] = row.value; sources[String(row.field_key)] = String(row.source); }
  return { qid, fields, sources, services: (check(sv) ?? []).map(toService), staff: (check(st) ?? []).map(toStaff), faq: (check(fq) ?? []).map(toFaq) } satisfies DraftContent;
}

export async function loadBranches(sb: Sb, companyId: string): Promise<Branch[]> {
  return (check(await sb.from("branches").select("*").eq("company_id", companyId).order("created_at")) ?? []).map(toBranch);
}

export const counts = (c: Pick<DraftContent, "services" | "staff" | "faq">) => ({
  services: c.services.filter((s) => s.active).length, staff: c.staff.length, faq: c.faq.filter((f) => f.active).length,
});

/** Снимок для AI из содержимого версии — тот же формат, что держат голос и чаты */
export function snapshotFrom(c: DraftContent, branches: Branch[], version: number): KbSnapshot {
  return buildSnapshot({
    version,
    fields: c.fields,
    branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, landmarks: b.landmarks, hours: b.hours, phones: b.phones })),
    services: c.services.filter((s) => s.active).map((s) => ({
      id: s.id, name: s.name, synonyms: s.synonyms, priceType: s.priceType, priceMin: s.priceMin, priceMax: s.priceMax,
      currency: s.currency, durationMin: s.durationMin, staff: s.staffIds.map((id) => c.staff.find((x) => x.id === id)?.name ?? "").filter(Boolean),
    })),
    staff: c.staff.map((s) => ({ id: s.id, name: s.name, specialties: s.specialties, transferPhone: s.transferPhone })),
    faq: c.faq.filter((f) => f.active).map((f) => ({ id: f.id, question: f.question, synonyms: f.synonyms, shortAnswer: f.shortAnswer, longAnswer: f.longAnswer })),
  });
}

/** Последний опубликованный снимок (его использует AI-ассистент) */
export async function publishedSnapshot(sb: Sb, companyId: string): Promise<KbSnapshot | null> {
  const r = await sb.from("kb_snapshots").select("version, payload").eq("company_id", companyId).order("version", { ascending: false }).limit(1).maybeSingle();
  const row = check(r);
  if (!row) return null;
  return { ...(row.payload as KbSnapshot), version: Number(row.version) };
}

export async function draftSnapshot(sb: Sb, companyId: string): Promise<KbSnapshot> {
  const qid = await draftId(sb, companyId);
  const [c, branches, v] = await Promise.all([
    loadQuestionnaire(sb, qid), loadBranches(sb, companyId),
    sb.from("questionnaires").select("version").eq("id", qid).single(),
  ]);
  return snapshotFrom(c, branches, Number(check(v)!.version));
}

export async function questionnaireState(sb: Sb, companyId: string): Promise<QuestionnaireState> {
  const qs = check(await sb.from("questionnaires").select("id, version, status, published_at, completeness").eq("company_id", companyId).order("version", { ascending: false })) ?? [];
  const draftRow = qs.find((q) => q.status === "draft");
  if (!draftRow) throw new KbError("Черновик базы знаний не найден. Запустите provisioning демо-компании.");
  const pubRow = qs.find((q) => q.status === "published");
  const [draft, published, branches, unanswered] = await Promise.all([
    loadQuestionnaire(sb, String(draftRow.id)),
    pubRow ? loadQuestionnaire(sb, String(pubRow.id)) : Promise.resolve(null),
    loadBranches(sb, companyId),
    sb.from("unanswered_questions").select("*").eq("company_id", companyId).eq("resolved", false).order("count", { ascending: false }).limit(50),
  ]);
  const cnt = counts(draft);
  const changed = published
    ? Object.keys({ ...draft.fields, ...published.fields }).filter((k) => JSON.stringify(draft.fields[k]) !== JSON.stringify(published.fields[k]))
    : Object.keys(draft.fields);
  const version = (q: (typeof qs)[number], status: QuestionnaireVersion["status"]): QuestionnaireVersion => ({
    version: Number(q.version), status, publishedAt: q.published_at ? String(q.published_at) : undefined, completeness: Number(q.completeness ?? 0),
  });
  return {
    draft: { version: Number(draftRow.version), status: "draft", completeness: completeness(draft.fields, cnt) },
    published: pubRow && published ? { ...version(pubRow, "published"), completeness: completeness(published.fields, counts(published)) } : undefined,
    versions: qs.filter((q) => q.status !== "draft").map((q) => version(q, q.status === "published" ? "published" : "archived")),
    fields: draft.fields,
    fieldSources: draft.sources,
    changedSincePublish: changed,
    services: draft.services,
    staff: draft.staff,
    faq: draft.faq,
    unanswered: (check(unanswered) ?? []).map(toUnanswered),
    branches,
  };
}
