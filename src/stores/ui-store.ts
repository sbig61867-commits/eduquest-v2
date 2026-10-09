import { create } from 'zustand'

// Per-viewer convenience only: a missing or blocked localStorage just means
// the sidebar starts expanded.
const SIDEBAR_KEY = 'eq_sidebar_collapsed'

function saveSidebar(open: boolean) {
  try { localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1') } catch { /* storage unavailable */ }
}

interface UIState {
  sidebarOpen: boolean
  mobileNavOpen: boolean
  pageTitle: string
  /** Dynamic breadcrumb tail (e.g. a lesson title) set by a detail page. */
  breadcrumbDetail: string[]
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  /** Applies the collapsed state saved in localStorage (called once on mount). */
  restoreSidebar: () => void
  setMobileNavOpen: (open: boolean) => void
  setPageTitle: (title: string) => void
  setBreadcrumbDetail: (parts: string[]) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  mobileNavOpen: false,
  pageTitle: '',
  breadcrumbDetail: [],
  toggleSidebar: () => {
    const open = !get().sidebarOpen
    saveSidebar(open)
    set({ sidebarOpen: open })
  },
  setSidebarOpen: (open) => {
    saveSidebar(open)
    set({ sidebarOpen: open })
  },
  restoreSidebar: () => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === '1') set({ sidebarOpen: false })
    } catch { /* storage unavailable */ }
  },
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setPageTitle: (title) => set({ pageTitle: title }),
  setBreadcrumbDetail: (parts) => set({ breadcrumbDetail: parts }),
}))
