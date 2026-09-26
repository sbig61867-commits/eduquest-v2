// In-page anchors on the public pages that the header menu links to.
//
// Order matters: FEATURE_ANCHORS[i] is the id of `featuresPage.chapters[i]`
// and ROLE_ANCHORS[i] the id of `featuresPage.roles.items[i]` in
// src/messages/<locale>/public.json. Reordering a list there means reordering
// it here too.
export const FEATURE_ANCHORS = ['ai', 'proctoring', 'isolation', 'invitations', 'grades', 'groups'] as const
export type FeatureAnchor = (typeof FEATURE_ANCHORS)[number]

export const ROLE_ANCHORS = ['admin', 'center', 'teacher', 'student'] as const
export type RoleAnchor = (typeof ROLE_ANCHORS)[number]

/** Section ids. */
export const ROLES_SECTION = 'roles'
export const FAQ_SECTION = 'faq'

export const roleAnchorId = (role: RoleAnchor) => `role-${role}`

/**
 * The in-page anchor the header menu last pointed at.
 *
 * A client-side navigation to `#hash` uses pushState, which raises no
 * `hashchange`, so a component that reacts to an anchor (the role tabs on
 * /features) cannot learn about it from the URL alone. The menu records the
 * hash here on click, before navigating; readers subscribe with
 * useSyncExternalStore(subscribeAnchor, anchorSnapshot, () => ''). A manual
 * hash change (typed URL, back button) clears it so the URL wins again.
 */
let lastAnchor = ''
const anchorListeners = new Set<() => void>()

export function setAnchor(hash: string) {
  lastAnchor = hash
  anchorListeners.forEach(l => l())
}

export function subscribeAnchor(listener: () => void) {
  const onHash = () => {
    lastAnchor = ''
    listener()
  }
  anchorListeners.add(listener)
  window.addEventListener('hashchange', onHash)
  return () => {
    anchorListeners.delete(listener)
    window.removeEventListener('hashchange', onHash)
  }
}

export function anchorSnapshot(): string {
  return lastAnchor || window.location.hash.slice(1)
}
