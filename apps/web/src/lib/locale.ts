export type PimLocale = "en" | "hi";

export const PIM_LOCALE_COOKIE = "pim_locale";

export function resolveLocale(input: string | undefined | null): PimLocale {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "hi" || value === "hi-in") {
    return "hi";
  }
  return "en";
}

export function localeToHtmlLang(locale: PimLocale): string {
  if (locale === "hi") {
    return "hi";
  }
  return "en";
}
