// Where an open Summary item is shown. Shared by the Summary list and the mail detail
// panel so both agree on what "in Summary" means. No I/O.
export type SummarySection = "today" | "upcoming" | "reply" | "manual";
export const SUMMARY_SECTIONS: readonly (readonly [SummarySection, string])[] = [["today", "Today"], ["upcoming", "Next 7 days or more"], ["reply", "Reply needed"], ["manual", "Added by you"]];

/** Today's date on this device, as YYYY-MM-DD. */
export function deviceDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * The section an open item belongs to, or null when it is no longer shown: an item whose
 * date has passed leaves the list unless a person still waits for a reply or the user
 * added it by hand.
 */
export function summarySection(todo: { dueDate: string | null; reasons: readonly string[] }, today: string): SummarySection | null {
  if (todo.dueDate && todo.dueDate >= today) return todo.dueDate === today ? "today" : "upcoming";
  if (todo.reasons.includes("reply")) return "reply";
  if (todo.reasons.includes("manual")) return "manual";
  return null;
}
