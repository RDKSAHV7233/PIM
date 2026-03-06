/**
 * StatusBadge — displays a semantic status with icon + text label.
 * RULE R7: Never color-only. Always includes text label.
 * RULE R9: PENDING state uses animate-pulse-badge CSS class.
 */
import { Check, X, AlertTriangle, Clock, Minus, Lock, AlertCircle, EyeOff, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { BADGE_STATUS, type BadgeStatus } from '@/lib/tokens'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  check:          Check,
  'x':            X,
  'alert-triangle': AlertTriangle,
  clock:          Clock,
  minus:          Minus,
  lock:           Lock,
  'alert-circle': AlertCircle,
  'eye-off':      EyeOff,
  'x-circle':     X,
  'check-circle': CheckCircle,
}

const BADGE_I18N: Record<BadgeStatus, string> = {
  Ready:        K.badgeReady,
  Blocked:      K.badgeBlocked,
  Warning:      K.badgeWarning,
  Pending:      K.badgePending,
  NotConnected: K.badgeNotConnected,
  Expired:      K.badgeExpired,
  Active:       K.badgeActive,
  Success:      K.badgeSuccess,
  Rejected:     K.badgeRejected,
  Error:        K.badgeError,
  Suppressed:   K.badgeSuppressed,
}

interface StatusBadgeProps {
  status: BadgeStatus
  /** Override display text (still uses token color) */
  label?: string
  size?: 'sm' | 'md'
  /** Show as just a colored dot (product list channel column, min width) */
  compact?: boolean
  className?: string
}

export function StatusBadge({ status, label, size = 'md', compact = false, className }: StatusBadgeProps) {
  const t = useTranslations()
  const token = BADGE_STATUS[status]
  const Icon = ICONS[token.icon]
  const displayText = label ?? t(BADGE_I18N[status])
  const isPending = status === 'Pending'

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        isPending && 'animate-pulse-badge',
        className,
      )}
      style={{ backgroundColor: token.bg, color: token.color }}
      aria-label={t(K.badgeStatusAria, { status: displayText })}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />}
      {!compact && <span>{displayText}</span>}
      {compact && <span className="sr-only">{displayText}</span>}
    </span>
  )
}
