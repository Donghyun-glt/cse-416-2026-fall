// The "About you" details a user may enter in Settings. All four are optional free text.
// Kept free of I/O so the form and the API validate with the same rules.

/** The most each field may hold. A word is a run of characters between spaces. */
export const ABOUT_LIMITS = {
  role: { max: 3, unit: "words" }, organization: { max: 10, unit: "words" }, interests: { max: 10, unit: "words" }, notes: { max: 100, unit: "characters" },
} as const;
export type AboutField = keyof typeof ABOUT_LIMITS;
export const ABOUT_FIELDS = Object.keys(ABOUT_LIMITS) as AboutField[];
export type UserAbout = Record<AboutField, string>;
export const EMPTY_ABOUT: UserAbout = { role: "", organization: "", interests: "", notes: "" };

const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
/** How much of its limit a field's text uses, in that field's own unit. */
export const aboutLength = (field: AboutField, text: string) => ABOUT_LIMITS[field].unit === "words" ? countWords(text) : [...text].length;
/** Character ceiling per field, so one endless "word" cannot get past a word limit. */
export const aboutCharLimit = (field: AboutField) => ABOUT_LIMITS[field].unit === "words" ? ABOUT_LIMITS[field].max * 20 : ABOUT_LIMITS[field].max;

// Role used to be a fixed choice stored as one of these keys; show what the user picked then.
const LEGACY_ROLES: Record<string, string> = { undergraduate: "Undergraduate student", graduate: "Graduate student", faculty: "Faculty", staff: "Staff", other: "Other" };
export const roleText = (stored: string) => LEGACY_ROLES[stored] ?? stored;

/**
 * Checks what the form submitted. Missing fields count as empty; text is trimmed with
 * inner whitespace collapsed. Anything over the limit or of the wrong type is rejected
 * (never silently cut), so what is stored is exactly what the user saw.
 */
export function parseUserAbout(input: unknown): UserAbout | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const about: UserAbout = { ...EMPTY_ABOUT };
  for (const field of ABOUT_FIELDS) {
    const value = record[field] ?? "";
    if (typeof value !== "string") return null;
    const clean = value.replace(/\s+/g, " ").trim();
    if (aboutLength(field, clean) > ABOUT_LIMITS[field].max || [...clean].length > aboutCharLimit(field)) return null;
    about[field] = clean;
  }
  return about;
}
