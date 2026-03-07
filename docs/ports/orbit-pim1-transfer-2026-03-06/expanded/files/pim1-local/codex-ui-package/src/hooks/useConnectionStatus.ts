'use client'

import { useOnlineStatus, useUnsavedChanges as useCanonicalUnsavedChanges } from './index'

export type ConnectionStatus = 'online' | 'offline'

/**
 * Backward-compatible adapter.
 * Prefer useOnlineStatus() for new code.
 */
export function useConnectionStatus(): ConnectionStatus {
  const { isOnline } = useOnlineStatus()
  return isOnline ? 'online' : 'offline'
}

/**
 * Backward-compatible adapter that maps a boolean dirty flag
 * to the canonical unsaved-changes hook used in PIM1.
 */
export function useUnsavedChanges(hasChanges: boolean) {
  const state = useCanonicalUnsavedChanges()
  if (hasChanges && !state.isDirty) {
    state.markDirty()
  }
  if (!hasChanges && state.isDirty) {
    state.markClean()
  }
  return state
}
