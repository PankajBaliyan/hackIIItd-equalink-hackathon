/** Rule ids typed one per line or separated by commas or spaces, as a clean, sorted list without repeats. */
export const parseRules = (text: string): string[] =>
  [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
