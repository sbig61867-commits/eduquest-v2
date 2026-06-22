import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Tenant } from '@/types'

interface AuthState {
  user: User | null
  tenant: Tenant | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setTenant: (tenant: Tenant | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      isLoading: true,
      setUser: (user) => set({ user }),
      setTenant: (tenant) => set({ tenant }),
      setLoading: (isLoading) => set({ isLoading }),
      reset: () => set({ user: null, tenant: null, isLoading: false }),
    }),
    {
      name: 'eduquest-auth',
      partialize: (state) => ({ user: state.user, tenant: state.tenant }),
    }
  )
)
