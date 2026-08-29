export type Priority = "normal" | "high" | "urgent";

export const VALID_PRIORITIES: Priority[] = ["normal", "high", "urgent"];

export function sanitizePriority(value: unknown): Priority {
  return VALID_PRIORITIES.includes(value as Priority) ? (value as Priority) : "normal";
}
