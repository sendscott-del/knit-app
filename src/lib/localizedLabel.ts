/**
 * DB-driven labels (interest tags, participation styles) live in Supabase
 * with separate name_en/name_es and label_en/label_es columns. These helpers
 * pick the right one for the active locale at render time. Falls back to the
 * English value when ES is missing — the seed migration backfills ES for
 * the canonical set, but defensive in case a ward adds a custom tag without
 * setting name_es.
 */

export function localizedTagName<
  T extends { name_en: string; name_es?: string | null },
>(tag: T, lang: string | undefined): string {
  if (lang?.toLowerCase().startsWith('es') && tag.name_es) return tag.name_es
  return tag.name_en
}

export function localizedStyleLabel<
  T extends { label_en: string; label_es?: string | null },
>(style: T, lang: string | undefined): string {
  if (lang?.toLowerCase().startsWith('es') && style.label_es) return style.label_es
  return style.label_en
}
