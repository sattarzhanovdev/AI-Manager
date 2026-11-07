export const TABS = ["company", "branches", "notifications", "numbers", "api", "webhooks", "data", "security"] as const;
export type Tab = (typeof TABS)[number];
