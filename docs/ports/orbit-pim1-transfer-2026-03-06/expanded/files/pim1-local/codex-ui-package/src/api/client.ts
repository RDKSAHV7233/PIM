/**
 * PIM1 API Client — DO NOT MODIFY THE INTERCEPTORS
 * All components import from src/api/*.ts, not from this file directly.
 */
import axios, { AxiosError, type AxiosInstance } from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanLimitError {
  error: 'PLAN_LIMIT_EXCEEDED'
  resource: 'skus' | 'submissions' | 'storageGb' | 'users'
  limit: number
  current: number
  upgrade_url: string
}

export interface ApiError {
  error: string
  message?: string
  statusCode?: number
}

// ── Singleton promise for token refresh ───────────────────────────────────────
let refreshPromise: Promise<string> | null = null

// ── Plan limit modal trigger (set by PlanLimitModal component) ────────────────
let onPlanLimitExceeded: ((err: PlanLimitError) => void) | null = null
export function registerPlanLimitHandler(handler: (err: PlanLimitError) => void) {
  onPlanLimitExceeded = handler
}

// ── Create instance ───────────────────────────────────────────────────────────
const client: AxiosInstance = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL}/api/v1`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor — inject token ───────────────────────────────────────
client.interceptors.request.use((config) => {
  // Token is stored in memory (never localStorage) by the auth store (Zustand)
  // Import is lazy to avoid circular deps at module load time
  const getToken = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAuthStore } = require('@/lib/auth-store')
      return useAuthStore.getState().token as string | null
    } catch {
      return null
    }
  }
  const token = getToken()
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// ── Response interceptor — handle auth, plan limits, errors ──────────────────
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError | PlanLimitError>) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean }

    // ── 402 Plan Limit Exceeded ──────────────────────────────────────────────
    if (error.response?.status === 402) {
      const body = error.response.data as PlanLimitError
      if (body?.error === 'PLAN_LIMIT_EXCEEDED' && onPlanLimitExceeded) {
        onPlanLimitExceeded(body)
        // Return a resolved promise so the calling code doesn't also show an error
        return Promise.reject({ ...error, handled: true })
      }
    }

    // ── 401 Token Expired — attempt refresh ──────────────────────────────────
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/refresh`, {}, {
              withCredentials: true, // refresh token is in httpOnly cookie
            })
            .then((r) => r.data.token as string)
            .finally(() => { refreshPromise = null })
        }
        const newToken = await refreshPromise
        // Update auth store
        const { useAuthStore } = await import('@/lib/auth-store')
        useAuthStore.getState().setToken(newToken)
        originalRequest.headers!['Authorization'] = `Bearer ${newToken}`
        return client(originalRequest)
      } catch {
        // Refresh failed — redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    }

    // ── 423 Account Locked ────────────────────────────────────────────────────
    if (error.response?.status === 423 && typeof window !== 'undefined') {
      const body = error.response.data as { error: string; unlockAt?: string }
      if (body?.error === 'ACCOUNT_LOCKED') {
        window.location.href = `/login?locked=1&unlockAt=${encodeURIComponent(body.unlockAt ?? '')}`
        return Promise.reject({ ...error, handled: true })
      }
    }

    return Promise.reject(error)
  }
)

export default client
