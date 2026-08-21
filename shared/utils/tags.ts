// Tag matching, shared by the search box and the stores behind it.
//
// A `#tag` typed into search is rarely finished. `#sani` is meant to find
// everything under `#sanitairkamer` without the user pressing Tab first, so a
// token stands for every tag it could still become — a requirement satisfied by
// any one of them. Several tokens still narrow: each has to be met.

/** One `#token` from the query: a tag, or the set of tags it could complete to. */
export type TagRequirement = string | string[]

/** The tags a token stands for. An exact tag is itself; a partial is its completions. */
export function expandTagToken(token: string, knownTags: string[]): TagRequirement {
  const needle = token.toLowerCase()
  if (knownTags.includes(needle)) return needle
  const matches = knownTags.filter(tag => tag.startsWith(needle))
  // No completion: keep the token as typed, so the filter finds nothing rather
  // than quietly matching everything.
  return matches.length ? matches : needle
}

/** True when every requirement is met by at least one of `tags`. */
export function matchesTagRequirements(tags: string[], requirements: TagRequirement[]): boolean {
  if (requirements.length === 0) return true
  const owned = new Set(tags.map(tag => tag.toLowerCase()))
  return requirements.every(requirement =>
    typeof requirement === 'string'
      ? owned.has(requirement)
      : requirement.some(tag => owned.has(tag))
  )
}
