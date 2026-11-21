// The "About you" details a user may enter in Settings. All five are optional.
// Kept free of I/O so the form and the API validate with the same rules.

export const ABOUT_ROLES = ["undergraduate", "graduate", "faculty", "staff", "other"] as const;
export type AboutRole = (typeof ABOUT_ROLES)[number];
export const ABOUT_ROLE_LABELS: Record<AboutRole, string> = {
  undergraduate: "Undergraduate student", graduate: "Graduate student", faculty: "Faculty", staff: "Staff", other: "Other",
};
export const ABOUT_TEXT_LIMIT = 100;

export type UserAbout = { role: AboutRole | ""; organization: string; department: string; interests: string; notes: string };
export const EMPTY_ABOUT: UserAbout = { role: "", organization: "", department: "", interests: "", notes: "" };
const TEXT_FIELDS = ["organization", "department", "interests", "notes"] as const;

/**
 * Checks what the form submitted. Missing fields count as empty; text is trimmed with
 * inner whitespace collapsed. Anything over the limit or of the wrong type is rejected
 * (never silently cut), so what is stored is exactly what the user saw.
 */
export function parseUserAbout(input: unknown): UserAbout | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const role = record.role ?? "";
  if (role !== "" && !ABOUT_ROLES.includes(role as AboutRole)) return null;
  const about: UserAbout = { ...EMPTY_ABOUT, role: role as UserAbout["role"] };
  for (const field of TEXT_FIELDS) {
    const value = record[field] ?? "";
    if (typeof value !== "string") return null;
    const clean = value.replace(/\s+/g, " ").trim();
    if ([...clean].length > ABOUT_TEXT_LIMIT) return null;
    about[field] = clean;
  }
  return about;
}
