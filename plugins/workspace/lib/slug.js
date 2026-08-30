// Slug generation (D41). A slug is the kebab-case folder name on disk
// (e.g. "totem-labs"). D79: CASE IS PRESERVED — "POLO" stays "POLO" on
// disk and as the GitHub repo name; only non-letters kebab ("Zephyr App"
// → "Zephyr-App"). Slugs are immutable after creation: renames touch
// the manifest's display name only, never the folder. Collisions among
// sibling slugs resolve by numeric suffix (-2, -3, ...) and compare
// CASE-INSENSITIVELY — a case-preserving name must never land on the
// same directory as an existing lowercase twin (macOS APFS is
// case-insensitive by default; GitHub routes repo names case-insensitively).

/** Kebab-case a display name into a filesystem slug, preserving case (D79). */
export function slugify(displayName) {
  if (typeof displayName !== 'string') throw new TypeError('displayName must be a string')
  const slug = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics left by NFKD (U+0300–U+036F)
    .replace(/['’]/g, '') // apostrophes vanish rather than hyphenate
    .replace(/[^a-zA-Z0-9]+/g, '-') // D79: keep a-z AND A-Z
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/**
 * Pick a unique slug for `displayName` given the sibling slugs that
 * already exist. First taker keeps the bare slug; later collisions get
 * -2, -3, ... (the bare form counts as #1).
 *
 * @param {string} displayName
 * @param {Iterable<string>} existingSlugs
 * @returns {string}
 */
export function uniqueSlug(displayName, existingSlugs = []) {
  // D79: the collision set is CASE-INSENSITIVE ("polo" blocks "POLO");
  // the emitted slug keeps its own case.
  const taken = new Set([...existingSlugs].map((s) => String(s).toLowerCase()))
  const base = slugify(displayName)
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
