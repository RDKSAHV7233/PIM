/**
 * ConnectorCard — single source of truth for connector status display.
 * Used in: Channels overview (full), Product detail Channels tab (compact).
 * RULE R4: Meesho CTA is "Generate export file". Never "Publish".
 * RULE R8: Show SourceLabel on validation results.
 */
'use client'
import { clsx } from 'clsx'
import { AlertCircle, RefreshCw, Zap } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { SourceLabel } from './primitives'
import type { ConnectorInstalled, ChannelReadiness, ConnectorIssue } from '@/types/api'
import { COLORS, type BadgeStatus } from '@/lib/tokens'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'

interface ConnectorCardProps {
  installation: ConnectorInstalled
  channelReadiness?: ChannelReadiness
  topIssues?: ConnectorIssue[]
  lastSubmissionStatus?: string | null
  lastSubmissionAt?: string | null
  /** 'full' = channels overview page. 'compact' = product detail tab. */
  variant?: 'full' | 'compact'
  accountAlias?: string
  onValidate?: () => void
  onPublish?: () => void
  onExport?: () => void
  onReconnect?: () => void
  className?: string
}

const STATUS_BADGE_MAP: Record<string, BadgeStatus> = {
  ACTIVE:             'Active',
  PAUSED:             'Warning',
  CREDENTIAL_EXPIRED: 'Expired',
  DISABLED:           'NotConnected',
}

const CAPABILITY_I18N: Partial<Record<string, (typeof K)[keyof typeof K]>> = {
  PUBLISH: K.channelCapPublish,
  VALIDATE: K.channelCapValidate,
  WEBHOOK_RECEIVE: K.channelCapWebhook,
  EXCEL_EXPORT: K.channelCapExcelExport,
  STATUS_SYNC: K.channelCapStatusSync,
}

export function ConnectorCard({
  installation,
  channelReadiness,
  topIssues = [],
  variant = 'full',
  accountAlias,
  onValidate,
  onPublish,
  onExport,
  onReconnect,
  className,
}: ConnectorCardProps) {
  const t = useTranslations()
  const isMeesho = installation.connectorSlug === 'meesho'
  const isExpired = installation.status === 'CREDENTIAL_EXPIRED'
  const canPublish = installation.capabilities.includes('PUBLISH')
  const canExport  = installation.capabilities.includes('EXCEL_EXPORT')

  const badgeStatus = STATUS_BADGE_MAP[installation.status] ?? 'NotConnected'

  return (
    <div
      className={clsx(
        'rounded-lg border bg-white',
        isExpired ? 'border-red-200 bg-red-50/30' : 'border-gray-200',
        variant === 'compact' ? 'p-3' : 'p-4',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-gray-400" aria-hidden />
          <span className="font-medium text-gray-900 text-sm">{installation.displayName}</span>
          {accountAlias && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {accountAlias}
            </span>
          )}
        </div>
        <StatusBadge status={badgeStatus} size="sm" />
      </div>

      {/* Expired alert */}
      {isExpired && (
        <div className="flex items-center gap-1.5 mb-3 text-red-700 text-xs bg-red-50 rounded px-2 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>{t(K.channelCredExpired)}</span>
        </div>
      )}

      {/* Channel readiness score */}
      {channelReadiness && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {isMeesho ? t(K.meeshoExportReady) : t(K.channelReadiness)}:
          </span>
          <span
            className="text-sm font-semibold"
            style={{
              color:
                channelReadiness.score >= 80
                  ? COLORS.success
                  : channelReadiness.score >= 50
                    ? COLORS.warning
                    : COLORS.error,
            }}
          >
            {channelReadiness.score}%
          </span>
          {channelReadiness.source !== 'NOT_VALIDATED' && (
            <SourceLabel source={channelReadiness.source} size="xs" />
          )}
        </div>
      )}

      {/* Top issues */}
      {topIssues.length > 0 && (
        <div className="mb-3 space-y-1">
          {topIssues.slice(0, 3).map((issue, i) => (
            <div key={i} className="flex items-start gap-1 text-xs">
              <span className={`mt-0.5 flex-shrink-0 h-1.5 w-1.5 rounded-full ${issue.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
              <span className="text-gray-700 line-clamp-1">{issue.sellerMessage}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-wrap gap-2 mt-auto">
        {isExpired && onReconnect && (
          <button
            onClick={onReconnect}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-600 text-white rounded hover:bg-red-700"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {t(K.channelReconnect)}
          </button>
        )}
        {!isExpired && !isMeesho && onValidate && (
          <button
            onClick={onValidate}
            className="text-xs px-2.5 py-1.5 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
          >
            {t(K.pdValidate)}
          </button>
        )}
        {!isExpired && canPublish && !isMeesho && onPublish && (
          <button
            onClick={onPublish}
            className="text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-blue-700"
          >
            {t(K.pdPublish)}
          </button>
        )}
        {/* Meesho: export only — never publish */}
        {!isExpired && isMeesho && canExport && onExport && (
          <button
            onClick={onExport}
            className="text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-blue-700"
          >
            {t(K.meeshoGenerateExport)}
          </button>
        )}
      </div>

      {/* Capabilities (full variant only) */}
      {variant === 'full' && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1">
          {installation.capabilities.map(cap => (
            <span key={cap} className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
              {CAPABILITY_I18N[cap] ? t(CAPABILITY_I18N[cap]) : cap}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
