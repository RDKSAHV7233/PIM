/**
 * SourceLabel — always visible on validation results.
 * RULE R8: Never hide the source. Never omit this component.
 */
import { SOURCE_LABEL, PAGINATION, type SourceType } from '@/lib/tokens'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/tooltip'
import type { ConnectorIssue } from '@/types/api'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

const SOURCE_I18N: Record<SourceType, string> = {
  LIVE_API: K.sourceLiveApi,
  LOCAL_RULES: K.sourceLocalRules,
  HISTORICAL_DATA: K.sourceHistoricalData,
  HEURISTIC_FALLBACK: K.sourceHeuristic,
}

interface SourceLabelProps {
  source: SourceType
  size?: 'sm' | 'xs'
}

export function SourceLabel({ source, size = 'sm' }: SourceLabelProps) {
  const t = useTranslations()
  const token = SOURCE_LABEL[source]
  const isHeuristic = source === 'HEURISTIC_FALLBACK'

  const chip = (
    <span
      className={`inline-flex items-center rounded px-1.5 font-medium ${size === 'xs' ? 'text-xs py-0' : 'text-xs py-0.5'}`}
      style={{ backgroundColor: token.bg, color: token.text }}
    >
      {t(SOURCE_I18N[source])}
    </span>
  )

  if (isHeuristic) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs text-xs">{t(K.sourceHeuristicTip)}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return chip
}

/**
 * IssueChip — renders a ConnectorIssue as a seller-readable chip.
 * RULE R3: Always shows sellerMessage. Raw code in tooltip only.
 */
interface IssueChipProps {
  issue: ConnectorIssue
  showField?: boolean
}

export function IssueChip({ issue, showField = false }: IssueChipProps) {
  const isError = issue.severity === 'error'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={clsx(
            'inline-flex flex-col items-start rounded-md px-2 py-1 text-xs max-w-xs cursor-default',
            isError
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200',
          )}
        >
          <span className="font-medium line-clamp-2">{issue.sellerMessage}</span>
          {showField && issue.fieldPath && (
            <span className="mt-0.5 font-mono opacity-70 text-[10px]">{issue.fieldPath}</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-mono text-xs">{issue.code}</p>
        {issue.fieldPath && <p className="text-xs text-gray-400">{issue.fieldPath}</p>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * PaginatedTableFooter — cursor-based pagination.
 * RULE R5: Use on every paginated list. Never build custom pagination.
 */
interface PaginatedTableFooterProps {
  hasNextPage: boolean
  hasPrevPage: boolean
  onNext: () => void
  onPrev: () => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  totalCount?: number
  rangeStart?: number
  rangeEnd?: number
}

export function PaginatedTableFooter({
  hasNextPage,
  hasPrevPage,
  onNext,
  onPrev,
  pageSize,
  onPageSizeChange,
  totalCount,
  rangeStart,
  rangeEnd,
}: PaginatedTableFooterProps) {
  const t = useTranslations()
  const pageSizes = [25, 50, 100, 200].filter((s) => s <= PAGINATION.maxSize)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span>{t(K.paginationRowsPerPage)}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border border-gray-300 rounded px-2 py-0.5 text-sm"
          aria-label={t(K.paginationRowsPerPage)}
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {totalCount !== undefined && rangeStart !== undefined && rangeEnd !== undefined && (
          <span className="ml-2">{t(K.paginationRange, { from: rangeStart, to: rangeEnd, total: totalCount })}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={!hasPrevPage}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={t(K.paginationPrevPage)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onNext}
          disabled={!hasNextPage}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={t(K.paginationNextPage)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * EmptyStatePanel — zero-data state for all list views.
 * RULE R14: Always render this when a list is empty.
 */
interface EmptyStatePanelProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyStatePanel({ icon: Icon, title, description, action }: EmptyStatePanelProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && <Icon className="h-12 w-12 text-gray-300 mb-4" aria-hidden />}
      <h3 className="text-base font-medium text-gray-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
