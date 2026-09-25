// In-page anchors on the public pages that the header menu links to.
//
// Order matters: FEATURE_ANCHORS[i] is the id of `featuresPage.features[i]`
// and ROLE_ANCHORS[i] the id of `featuresPage.roles[i]` in
// src/messages/<locale>/public.json. Reordering a list there means reordering
// it here too.
export const FEATURE_ANCHORS = ['ai', 'proctoring', 'isolation', 'invitations', 'grades', 'groups'] as const
export type FeatureAnchor = (typeof FEATURE_ANCHORS)[number]

export const ROLE_ANCHORS = ['admin', 'teacher', 'student'] as const
export type RoleAnchor = (typeof ROLE_ANCHORS)[number]

/** Section ids. */
export const ROLES_SECTION = 'roles'
export const FAQ_SECTION = 'faq'

export const roleAnchorId = (role: RoleAnchor) => `role-${role}`
