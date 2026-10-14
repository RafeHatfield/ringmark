import { revalidatePath } from 'next/cache'

/**
 * Purge every cached public page: story pages, maker pages, and their OG images.
 *
 * /p/[slug], /maker and /[handle]/maker are served from the full-route cache
 * (ISR) so a QR scan or a profile visit costs no compute. That makes every
 * write path responsible for purging them. We purge whole segments rather
 * than one slug because a change to one object can surface on several pages
 * (its descendants render the same lineage; the maker page lists it), and a
 * blanket purge at this scale is cheaper than getting the fan-out wrong.
 * Pages regenerate lazily on their next hit.
 *
 * The 'layout' type matters: it also covers the nested opengraph-image routes,
 * which a page-type purge of the same path would leave stale.
 */
export function revalidatePublicStories() {
  revalidatePath('/p/[slug]', 'layout')
  revalidatePath('/maker', 'layout')
  revalidatePath('/[handle]/maker', 'layout')
  revalidatePath('/sitemap.xml', 'layout')
}
