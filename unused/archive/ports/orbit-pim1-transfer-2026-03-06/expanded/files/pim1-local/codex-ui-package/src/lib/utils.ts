import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'
import { BADGE_SEVERITY } from './tokens'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "2h ago", "just now", etc. */
export function relativeTime(isoString: string): string {
  return formatDistanceToNow(new Date(isoString), { addSuffix: true })
}

/** "12 Jan 2026" */
export function shortDate(isoString: string): string {
  return format(new Date(isoString), 'd MMM yyyy')
}

/** "12 Jan 2026, 14:30" */
export function fullDatetime(isoString: string): string {
  return format(new Date(isoString), 'd MMM yyyy, HH:mm')
}

/** Mask email: jo***@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return `${local.slice(0, 2)}***@${domain}`
}

/** Returns highest-severity status string from an array of status strings */
export function highestSeverity(statuses: string[]): string {
  return statuses.reduce((best, current) => {
    return (BADGE_SEVERITY[current.toUpperCase()] ?? 0) > (BADGE_SEVERITY[best.toUpperCase()] ?? 0)
      ? current
      : best
  }, statuses[0] ?? 'NOT_CONNECTED')
}

/** Format bytes as human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Format number in Indian locale */
export function formatIN(n: number): string {
  return n.toLocaleString('en-IN')
}
