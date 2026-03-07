/**
 * usePlanUsage — fetches billing/usage and provides limit-check helpers.
 * Shared across: PlanLimitModal, product list toolbar, media upload, channels tab.
 * Cache TTL: 5 minutes.
 */
'use client'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback, useEffect, useRef } from 'react'
import client from '@/api/client'
import type { UsageResponse } from '@/types/api'
import { PLAN_LIMITS_THRESHOLDS } from '@/lib/tokens'

const FIVE_MINUTES = 5 * 60 * 1000

async function fetchUsage(): Promise<UsageResponse> {
  const { data } = await client.get<UsageResponse>('/billing/usage')
  return data
}

export function usePlanUsage() {
  const query = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: fetchUsage,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  })

  function limitStatus(resource: keyof Pick<UsageResponse, 'skus' | 'submissions' | 'storageGb' | 'users'>) {
    const usage = query.data
    if (!usage) return 'ok' as const
    const { current, limit } = usage[resource]
    const pct = limit > 0 ? current / limit : 0
    if (pct >= PLAN_LIMITS_THRESHOLDS.maxPct)      return 'exceeded' as const
    if (pct >= PLAN_LIMITS_THRESHOLDS.criticalPct) return 'critical' as const
    if (pct >= PLAN_LIMITS_THRESHOLDS.warningPct)  return 'warning' as const
    return 'ok' as const
  }

  function pct(resource: keyof Pick<UsageResponse, 'skus' | 'submissions' | 'storageGb' | 'users'>) {
    const usage = query.data
    if (!usage) return 0
    const { current, limit } = usage[resource]
    return limit > 0 ? Math.round((current / limit) * 100) : 0
  }

  return { ...query, limitStatus, pct }
}


/**
 * useUnsavedChanges — tracks whether a form has unsaved changes.
 * RULE R11: Used on product detail to show "Save failed — retry" and
 *           to warn on navigate-away.
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'offline'

export function useUnsavedChanges() {
  const [isDirty, setIsDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const markDirty   = useCallback(() => setIsDirty(true), [])
  const markClean   = useCallback(() => { setIsDirty(false); setSaveState('saved') }, [])
  const markFailed  = useCallback(() => setSaveState('failed'), [])
  const markSaving  = useCallback(() => setSaveState('saving'), [])
  const markOffline = useCallback(() => setSaveState('offline'), [])

  // Show "saved" check for 2 seconds then return to idle
  useEffect(() => {
    if (saveState !== 'saved') return
    const t = setTimeout(() => setSaveState('idle'), 2000)
    return () => clearTimeout(t)
  }, [saveState])

  // Warn on browser navigate-away
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return { isDirty, saveState, markDirty, markClean, markFailed, markSaving, markOffline }
}


/**
 * useOnlineStatus — tracks navigator.onLine with offline banner delay.
 * RULE from UI-GAP-01: banner shows after 30 seconds offline.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleOnline  = () => {
      setIsOnline(true)
      setShowOfflineBanner(false)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
    const handleOffline = () => {
      setIsOnline(false)
      bannerTimer.current = setTimeout(() => setShowOfflineBanner(true), 30_000)
    }
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
  }, [])

  return { isOnline, showOfflineBanner }
}


/**
 * useLocalStorage — single hook permitted to use localStorage (R12).
 * Used ONLY for sidebar collapse preference.
 */
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const item = window.localStorage.getItem(key)
      return item ? (JSON.parse(item) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const set = useCallback((newValue: T) => {
    setValue(newValue)
    try { window.localStorage.setItem(key, JSON.stringify(newValue)) } catch { /* ignore */ }
  }, [key])

  return [value, set] as const
}
