// JSON-схемы функций LLM — единые для голоса и чатов (раздел 27).

export type Phase = "0" | "1a" | "1b";
export type AiModeKey = "leads" | "consult" | "booking" | "semi" | "demo";

export interface ToolSchema {
  name: string;
  description: string;
  phase: Phase;
  parameters: Record<string, unknown>;
}

export const TOOLS: ToolSchema[] = [
  {
    name: "search_kb", phase: "0",
    description: "Найти ответ в анкете компании. Вызывай перед любым ответом о фактах компании.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "get_service", phase: "0",
    description: "Получить цену (тип, от, до, валюта), длительность и исполнителей услуги. Цены называй только отсюда.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "get_hours", phase: "0",
    description: "График работы филиала на дату с учётом праздников.",
    parameters: { type: "object", properties: { branch: { type: "string" }, date: { type: "string", format: "date" } } },
  },
  {
    name: "create_lead", phase: "1a",
    description: "Создать заявку, когда клиент хочет записаться, заказать, перезвонить или пожаловаться и обязательные поля собраны.",
    parameters: {
      type: "object",
      properties: {
        type: { enum: ["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"] },
        fields: {
          type: "object",
          properties: {
            name: { type: "string" }, phone: { type: "string" }, service: { type: "string" },
            preferred_time: { type: "string" }, comment: { type: "string" },
          },
          required: ["phone"],
        },
        priority: { enum: ["normal", "urgent"] },
      },
      required: ["type", "fields"],
    },
  },
  {
    name: "transfer_to_human", phase: "1a",
    description: "Перевести звонок сотруднику по правилам передачи.",
    parameters: { type: "object", properties: { reason: { type: "string" }, target: { type: "string" } }, required: ["reason"] },
  },
  {
    name: "end_call", phase: "0",
    description: "Завершить звонок после прощания.",
    parameters: { type: "object", properties: { outcome: { enum: ["lead_created", "transferred", "no_result", "consultation"] } }, required: ["outcome"] },
  },
  {
    name: "switch_demo_role", phase: "0",
    description: "Сменить роль демо-компании по просьбе звонящего.",
    parameters: { type: "object", properties: { role: { enum: ["autoservice", "clinic", "salon", "dental", "polyclinic"] } }, required: ["role"] },
  },
  {
    name: "send_demo_summary", phase: "0",
    description: "Отправить SMS со ссылкой на результат демо, только с согласия звонящего.",
    parameters: { type: "object", properties: { consent: { type: "boolean" } }, required: ["consent"] },
  },
  {
    name: "find_slots", phase: "1b",
    description: "Найти свободные слоты для записи.",
    parameters: { type: "object", properties: { service: { type: "string" }, staff: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["service"] },
  },
  {
    name: "book_slot", phase: "1b",
    description: "Записать клиента в выбранный слот.",
    parameters: { type: "object", properties: { slot_id: { type: "string" }, contact: { type: "object" } }, required: ["slot_id", "contact"] },
  },
  {
    name: "add_to_waitlist", phase: "1b",
    description: "Добавить клиента в лист ожидания.",
    parameters: { type: "object", properties: { specialty: { type: "string" }, contact: { type: "object" } }, required: ["specialty", "contact"] },
  },
];

const MODE_TOOLS: Record<AiModeKey, string[]> = {
  leads: ["search_kb", "get_hours", "create_lead", "transfer_to_human", "end_call"],
  consult: ["search_kb", "get_service", "get_hours", "create_lead", "transfer_to_human", "end_call"],
  booking: ["search_kb", "get_service", "get_hours", "create_lead", "transfer_to_human", "end_call", "find_slots", "book_slot", "add_to_waitlist"],
  semi: ["search_kb", "get_service", "get_hours", "create_lead", "transfer_to_human", "end_call"],
  demo: ["search_kb", "get_service", "get_hours", "create_lead", "end_call", "switch_demo_role", "send_demo_summary"],
};

const PHASE_ORDER: Phase[] = ["0", "1a", "1b"];

export function allowedTools(mode: AiModeKey, phase: Phase = "1a"): ToolSchema[] {
  const maxIdx = PHASE_ORDER.indexOf(phase);
  return TOOLS.filter((t) => MODE_TOOLS[mode].includes(t.name) && PHASE_ORDER.indexOf(t.phase) <= maxIdx);
}
