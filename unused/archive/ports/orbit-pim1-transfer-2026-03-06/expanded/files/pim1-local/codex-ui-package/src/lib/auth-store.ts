/**
 * Auth store — JWT token in memory only. Never localStorage.
 * Zustand store used by client.ts interceptor.
 */
import { create } from 'zustand'
import type { UserMe } from '@/types/api'

interface AuthState {
  token: string | null
  user: UserMe | null
  consentRequired: boolean
  setToken: (token: string) => void
  setUser: (user: UserMe) => void
  setConsentRequired: (v: boolean) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  consentRequired: false,
  setToken: (token) => set({ token }),
  setUser:  (user)  => set({ user }),
  setConsentRequired: (v) => set({ consentRequired: v }),
  logout: () => set({ token: null, user: null, consentRequired: false }),
}))
