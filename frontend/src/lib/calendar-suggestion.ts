export type CalendarSuggestion = {
  title: string; kind: "appointment" | "deadline"; date: string;
  startTime: string | null; endTime: string | null; timeZone: string | null;
  location: string; evidence: string; reason: string;
  supportingEvidence?: string[]; warnings?: string[]; notes?: string[];
};

export function grounded(quote: unknown, source: string): quote is string {
  const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
  return typeof quote === "string" && normalize(quote).length >= 2 && normalize(source).includes(normalize(quote));
}

export const candidateProperties = {
  title: { type: "string" }, kind: { type: "string", enum: ["appointment", "deadline"] },
  date: { type: "string" }, dateEvidence: { type: "string" },
  startTime: { type: ["string", "null"] }, timeEvidence: { type: "string" },
  endTime: { type: ["string", "null"] }, endTimeEvidence: { type: "string" },
  timeZone: { type: ["string", "null"] }, timeZoneEvidence: { type: "string" },
  location: { type: "string" }, locationEvidence: { type: "string" },
  evidence: { type: "string" }, reason: { type: "string" },
  confirmed: { type: "boolean" }, personallyRelevant: { type: "boolean" },
  relevance: { type: "string", enum: ["required", "optional", "unrelated", "unclear"] },
  status: { type: "string", enum: ["confirmed", "tentative", "cancelled", "changed"] },
  notes: { type: "array", items: { type: "object", properties: { text: { type: "string" }, evidence: { type: "string" } }, required: ["text", "evidence"] } },
};
export const candidateSchema = { type: "object", properties: candidateProperties, required: Object.keys(candidateProperties), additionalProperties: false };
export const suggestionSchema = { type: "object", properties: { candidates: { type: "array", items: candidateSchema } }, required: ["candidates"], additionalProperties: false };

// Retain forwarded material when the new message consists of a forwarding note;
// quoted history is context only and must never override the latest instructions.
export function latestEmailText(text: string) {
  return text.split(/\n(?:On .{0,250}wrote:|[-_]{3,}\s*Original Message|보낸 사람:)/i)[0]
    .split("\n").filter((line) => !/^\s*>/.test(line)).join("\n").slice(0, 40000);
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const dateString = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function resolveEmailDate(phrase: string, sentAt: string, referenceZone?: string): { date: string | null; warnings: string[] } {
  const text = phrase.normalize("NFKC").trim();
  const reference = new Date(sentAt);
  if (!Number.isFinite(reference.getTime())) return { date: null, warnings: ["The email's reference date could not be established."] };
  let referenceDay = reference.toISOString().slice(0, 10);
  if (referenceZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: referenceZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(reference).map((part) => [part.type, part.value]));
    referenceDay = `${parts.year}-${parts.month}-${parts.day}`;
  }
  const year = Number(referenceDay.slice(0, 4));
  const warnings: string[] = [];
  if (/\b\d{1,2}[/.]\d{1,2}[/.]\d{2}\b/.test(text)) return { date: null, warnings: ["A two-digit year needs manual confirmation."] };
  let date: string | null = null;
  let inferredYear = false;
  let match = text.match(/\b(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
  if (match) date = dateString(+match[1], +match[2], +match[3]);
  if (!date && (match = text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일?/))) {
    date = dateString(+(match[1] || year), +match[2], +match[3]); inferredYear = !match[1];
  }
  if (!date) {
    const monthPattern = '(Jan\\w*|Feb\\w*|Mar\\w*|Apr\\w*|May|Jun\\w*|Jul\\w*|Aug\\w*|Sep\\w*|Oct\\w*|Nov\\w*|Dec\\w*)';
    match = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'));
    if (match) { date = dateString(+(match[3] || year), months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, +match[2]); inferredYear = !match[3]; }
    if (!date) {
      match = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}(?:,?\\s+(\\d{4}))?\\b`, 'i'));
      if (match) { date = dateString(+(match[3] || year), months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, +match[1]); inferredYear = !match[3]; }
    }
  }
  if (!date && (match = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?\b/))) {
    const first = +match[1], second = +match[2];
    if (first <= 12 && second <= 12 && first !== second) return { date: null, warnings: ["Ambiguous numeric date: confirm the month and day."] };
    date = dateString(+(match[3] || year), first > 12 ? second : first, first > 12 ? first : second); inferredYear = !match[3];
  }
  if (!date) {
    const relative = /\bday after tomorrow\b|모레/i.test(text) ? 2 : /\btomorrow\b|내일/i.test(text) ? 1 : /\btoday\b|오늘/i.test(text) ? 0 : null;
    const inDays = text.match(/\bin\s+(\d{1,2})\s+days?\b|(\d{1,2})일\s*후/i);
    const offset = relative ?? (inDays ? Number(inDays[1] ?? inDays[2]) : null);
    if (offset !== null) {
      const resolved = new Date(`${referenceDay}T00:00:00Z`); resolved.setUTCDate(resolved.getUTCDate() + offset);
      date = resolved.toISOString().slice(0, 10);
      warnings.push(`Relative date resolved from the email date (${referenceDay}, ${referenceZone ?? "UTC"}); please confirm.`);
    }
  }
  if (date && inferredYear) {
    if (validDate(date) && Date.parse(referenceDay) - Date.parse(date) > 180 * 86400000) date = dateString(year + 1, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
    warnings.push("Year inferred from the email date; please confirm.");
  }
  return { date: date && validDate(date) ? date : null, warnings: date ? warnings : ["The date needs manual clarification."] };
}

export function supportedEmailTime(time: unknown, evidence: string): time is string {
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const text = evidence.normalize("NFKC");
  const [hour, minute] = time.split(":").map(Number);
  if (hour === 12 && minute === 0 && /\bnoon\b|정오/i.test(text)) return true;
  if (hour === 0 && minute === 0 && /\bmidnight\b|자정/i.test(text)) return true;
  for (const match of text.matchAll(/(오전|오후)\s*(\d{1,2})(?:\s*시\s*(?:(\d{1,2})\s*분|(반))?|:(\d{2}))/g)) {
    const h = (+match[2] % 12) + (match[1] === "오후" ? 12 : 0);
    if (+match[2] <= 12 && h === hour && Number(match[3] ?? (match[4] ? 30 : match[5] ?? 0)) === minute) return true;
  }
  for (const match of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)) {
    if (+match[1] <= 12 && (+match[1] % 12) + (/^p/i.test(match[3]) ? 12 : 0) === hour && Number(match[2] ?? 0) === minute) return true;
  }
  // Bare 1–12 o'clock lacks AM/PM; do not silently select one half of the day.
  if (hour > 12 || hour === 0 || !/\b(am|pm|a\.m|p\.m)\b|오전|오후/i.test(text)) {
    for (const match of text.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g)) {
      if (+match[1] === hour && +match[2] === minute && (+match[1] > 12 || +match[1] === 0 || /^0\d$/.test(match[1]))) return true;
    }
  }
  // Korean 24-hour notation: 14시 30분. Values 1–12 still need an explicit meridiem.
  return [...text.matchAll(/(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/g)].some((match) => +match[1] > 12 && +match[1] === hour && Number(match[2] ?? 0) === minute);
}

export function validateSuggestions(input: unknown, source: string, sentAt: string, now = new Date(), referenceZone?: string): CalendarSuggestion[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as { candidates?: unknown }).candidates)) throw new Error("Invalid calendar analysis response.");
  const result: CalendarSuggestion[] = [];
  for (const value of (input as { candidates: unknown[] }).candidates.slice(0, 5)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (item.confirmed !== true || item.personallyRelevant !== true || !["appointment", "deadline"].includes(String(item.kind))) continue;
    if (item.relevance !== "required" || item.status !== "confirmed") continue;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 200 || !grounded(item.evidence, source) || item.evidence.length > 1600 || !grounded(item.dateEvidence, source)) continue;
    const resolved = resolveEmailDate(item.dateEvidence, sentAt, referenceZone);
    if (!resolved.date || resolved.date !== item.date) continue;
    const timestamp = Date.parse(resolved.date);
    // Keep today's early appointments visible with a warning, rather than silently
    // dropping the entire message because the reader opened it later that day.
    if (timestamp < now.getTime() - 36 * 3600000 || timestamp > now.getTime() + 2 * 366 * 86400000) continue;
    const warnings = [...resolved.warnings];
    const timeEvidence = grounded(item.timeEvidence, source) ? item.timeEvidence : item.evidence;
    const endEvidence = grounded(item.endTimeEvidence, source) ? item.endTimeEvidence : item.evidence;
    const startTime = supportedEmailTime(item.startTime, timeEvidence) ? item.startTime : null;
    const endTime = supportedEmailTime(item.endTime, endEvidence) && startTime && item.endTime > startTime ? item.endTime : null;
    if (!startTime) warnings.push(item.kind === "deadline" ? "No exact deadline time was established." : "Start time needs confirmation.");
    if (!endTime && item.kind === "appointment") warnings.push("End time is not specified; no duration has been assumed.");
    if (timestamp < Date.parse(now.toISOString().slice(0, 10))) warnings.push("This date may already have passed. Check before saving.");
    else if (resolved.date === now.toISOString().slice(0, 10) && startTime) warnings.push("Check whether this start time has already passed today.");
    let timeZone: string | null = null;
    const zoneEvidence = grounded(item.timeZoneEvidence, source) ? item.timeZoneEvidence : item.evidence;
    if (typeof item.timeZone === "string") {
      const aliases: Record<string, string> = { KST: "Asia/Seoul", UTC: "UTC", GMT: "UTC", JST: "Asia/Tokyo", 한국시간: "Asia/Seoul", 한국표준시: "Asia/Seoul" };
      const verified = zoneEvidence.includes(item.timeZone) || Object.entries(aliases).some(([name, zone]) => zone === item.timeZone && zoneEvidence.includes(name));
      try { if (verified) { new Intl.DateTimeFormat("en", { timeZone: item.timeZone }); timeZone = item.timeZone; } } catch { /* Review required. */ }
    }
    if (!timeZone) warnings.push("Time zone is not stated. Choose it explicitly before saving.");
    const supportingEvidence = [item.dateEvidence, timeEvidence, endEvidence, zoneEvidence].filter((quote, index, all) => quote && quote !== item.evidence && all.indexOf(quote) === index);
    const notes = Array.isArray(item.notes) ? item.notes.filter((note) => note && typeof note === "object" && grounded(note.evidence, source) && typeof note.text === "string").slice(0, 6).map((note) => `${note.text.slice(0, 300)} — ${note.evidence.slice(0, 500)}`) : [];
    const location = typeof item.location === "string" && item.location.length <= 500 && grounded(item.locationEvidence, source) && item.locationEvidence.includes(item.location) ? item.location : "";
    if (result.some((prior) => prior.date === item.date && prior.startTime === startTime && prior.title === item.title)) continue;
    result.push({ title: item.title.trim(), kind: item.kind as CalendarSuggestion["kind"], date: resolved.date, startTime, endTime, timeZone, location, evidence: item.evidence, supportingEvidence, warnings, notes, reason: typeof item.reason === "string" ? item.reason.slice(0, 300) : "A dated commitment was found in this message." });
  }
  return result;
}
