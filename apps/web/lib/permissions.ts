import type { MemberRole, Permission } from "@all/db";

// Матрица прав (раздел 05). Интерфейс скрывает или блокирует недоступное с пояснением.
export type Action =
  | "view_ops" | "listen_audio" | "edit_leads" | "edit_questionnaire" | "publish"
  | "toggle_ai" | "manage_team" | "manage_integrations" | "view_billing" | "export_delete";

const MATRIX: Record<Action, Partial<Record<MemberRole, true | Permission>>> = {
  view_ops: { owner: true, admin: true, staff: true },
  listen_audio: { owner: true, admin: true, staff: true },
  edit_leads: { owner: true, admin: true, staff: true },
  edit_questionnaire: { owner: true, admin: "edit_questionnaire" },
  publish: { owner: true },
  toggle_ai: { owner: true, admin: true },
  manage_team: { owner: true },
  manage_integrations: { owner: true, admin: "integrations" },
  view_billing: { owner: true, accountant: true },
  export_delete: { owner: true },
};

export function can(role: MemberRole, action: Action, permissions: Partial<Record<Permission, boolean>> = {}): boolean {
  const rule = MATRIX[action][role];
  if (rule === true) return true;
  if (typeof rule === "string") return permissions[rule] === true;
  return false;
}

/** Сотрудник видит только «свои» записи */
export const seesOnlyOwn = (role: MemberRole) => role === "staff";
