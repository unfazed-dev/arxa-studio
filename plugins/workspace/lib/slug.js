// Slug generation (D41). A slug is the kebab-case folder name on disk
// (e.g. "totem-labs"). Slugs are immutable after creation: renames touch
// the manifest's display name only, never the folder. Collisions among
// sibling slugs resolve by numeric suffix (-2, -3, ...).

/** Kebab-case a display name into a filesystem slug. */
export function slugify(displayName) {
  if (typeof displayName !== 'string') throw new TypeError('displayName must be a string')
  const slug = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics left by NFKD (U+0300–U+036F)
    .toLowerCase()
    .replace(/['’]/g, '') // apostrophes vanish rather than hyphenate
    .replace(/[^a-z0-9]+/g, '-')
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
  const taken = new Set(existingSlugs)
  const base = slugify(displayName)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
