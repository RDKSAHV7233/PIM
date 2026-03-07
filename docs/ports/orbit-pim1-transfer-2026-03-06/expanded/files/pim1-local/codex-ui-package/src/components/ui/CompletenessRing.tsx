/**
 * CompletenessRing — SVG arc showing completeness score 0–100.
 * RULE R10: Must have role="img" and aria-label. Never omit.
 * Used in: product list row (non-interactive), product detail header (interactive).
 */
'use client'
import { COLORS, COMPLETENESS } from '@/lib/tokens'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'
import { clsx } from 'clsx'

interface CompletenessRingProps {
  score: number          // 0–100
  size?: number          // px, default 40
  strokeWidth?: number   // default 4
  /** If true, wraps in <button> that calls onOpen. Use in product detail header. */
  interactive?: boolean
  onOpen?: () => void
  className?: string
}

export function CompletenessRing({
  score,
  size = 40,
  strokeWidth = 4,
  interactive = false,
  onOpen,
  className,
}: CompletenessRingProps) {
  const t = useTranslations()
  const clampedScore = Math.max(0, Math.min(100, score))
  const color = COMPLETENESS.color(clampedScore)
  const statusText =
    clampedScore >= COMPLETENESS.greenMin
      ? t(K.completenessGood)
      : clampedScore >= COMPLETENESS.amberMin
        ? t(K.completenessNeedsWork)
        : t(K.completenessIncomplete)

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (clampedScore / 100) * circumference

  const ariaLabel = interactive
    ? t(K.completenessOpenPanel, { score: clampedScore })
    : t(K.completenessAriaLabel, { score: clampedScore, status: statusText })

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={clsx('rotate-[-90deg]', className)}
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={COLORS.gray200}
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      {/* Score text — rotate back to readable orientation */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ rotate: '90deg', transformOrigin: 'center', fill: color, fontSize: size * 0.28, fontWeight: 600 }}
        className="rotate-90"
        aria-hidden
      >
        {clampedScore}
      </text>
    </svg>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
        aria-label={ariaLabel}
      >
        {svg}
      </button>
    )
  }

  return svg
}
