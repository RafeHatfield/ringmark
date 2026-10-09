import { revalidatePath } from 'next/cache'

/**
 * Purge every cached public story page and its OG image.
 *
 * /p/[slug] is served from the full-route cache (ISR) so a QR scan costs no
 * compute. That makes every write path responsible for purging it. We purge
 * the whole segment rather than one slug because a change to one object can
 * surface on several pages (its descendants render the same lineage), and a
 * blanket purge at this scale is cheaper than getting the fan-out wrong.
 * Pages regenerate lazily on their next hit.
 */
export function revalidatePublicStories() {
  revalidatePath('/p/[slug]', 'layout')
}
