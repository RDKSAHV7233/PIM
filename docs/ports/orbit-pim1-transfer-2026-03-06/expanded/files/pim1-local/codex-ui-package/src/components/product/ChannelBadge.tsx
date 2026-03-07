'use client'

import { StatusBadge } from '@/components/ui/StatusBadge'
import { highestSeverity } from '@/lib/utils'
import type { BadgeStatus } from '@/lib/tokens'
import type { ConnectorInstalled } from '@/types/api'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'

interface ChannelBadgeProps {
  connectorSlug: string
  displayName: string
  installations: ConnectorInstalled[]
  size?: 'sm' | 'md'
  className?: string
}

const INSTALLATION_TO_BADGE: Record<string, BadgeStatus> = {
  ACTIVE: 'Ready',
  PAUSED: 'Warning',
  CREDENTIAL_EXPIRED: 'Expired',
  DISABLED: 'NotConnected',
}

function toBadge(status: string): BadgeStatus {
  return INSTALLATION_TO_BADGE[status] ?? 'NotConnected'
}

export function ChannelBadge({ installations, size = 'sm', className = '' }: ChannelBadgeProps) {
  const t = useTranslations()

  if (installations.length === 0) {
    return <StatusBadge status="NotConnected" size={size} className={className} />
  }

  const statuses = installations.map((inst) => toBadge(inst.status))
  const dominant = highestSeverity(statuses) as BadgeStatus
  const isMulti = installations.length > 1

  const badgeLabelByStatus: Record<BadgeStatus, string> = {
    Ready: t(K.badgeReady),
    Blocked: t(K.badgeBlocked),
    Warning: t(K.badgeWarning),
    Pending: t(K.badgePending),
    NotConnected: t(K.badgeNotConnected),
    Expired: t(K.badgeExpired),
    Active: t(K.badgeActive),
    Success: t(K.badgeSuccess),
    Rejected: t(K.badgeRejected),
    Error: t(K.badgeError),
    Suppressed: t(K.badgeSuppressed),
  }

  const tooltipContent = isMulti
    ? installations.map((inst) => `${inst.accountAlias}: ${badgeLabelByStatus[toBadge(inst.status)]}`).join('\n')
    : undefined

  return (
    <span title={tooltipContent} className={className}>
      <StatusBadge status={dominant} size={size} />
      {isMulti && (
        <span className="ml-1 text-xs text-gray-400 font-mono" aria-label={t(K.channelAccountsCount, { count: installations.length })}>
          x{installations.length}
        </span>
      )}
    </span>
  )
}
