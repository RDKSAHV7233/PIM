/**
 * PIM1 Design Tokens — SOURCE OF TRUTH
 * Import from here. Never use raw hex values in components.
 * Tailwind classes (text-primary, bg-accent, etc.) are configured
 * in tailwind.config.ts to map to these values.
 */

export const COLORS = {
  // Brand
  primary:    '#1E3A5F',  // Page titles, table headers, key text
  accent:     '#2563EB',  // CTAs, links, interactive elements
  // Semantic
  success:    '#16A34A',  // Completeness ≥80, ACTIVE/Ready badges
  warning:    '#F59E0B',  // Completeness 50–79, credential warnings
  error:      '#DC2626',  // Completeness <50, REJECTED, BLOCKED
  pending:    '#6366F1',  // PENDING submission state
  // Neutral
  gray50:     '#F8FAFC',  // Alt table rows, card backgrounds
  gray100:    '#F1F5F9',
  gray200:    '#E2E8F0',
  gray400:    '#94A3B8',
  gray600:    '#475569',
  gray700:    '#374151',
  gray900:    '#0F172A',
  // Status backgrounds (light tints for badge backgrounds)
  successBg:  '#F0FDF4',
  warningBg:  '#FFFBEB',
  errorBg:    '#FEF2F2',
  pendingBg:  '#EEF2FF',
  // Source label colors
  liveApiBg:     '#F0FDF4',  // green tint
  liveApiText:   '#15803D',
  localRulesBg:  '#EFF6FF',  // blue tint
  localRulesText:'#1D4ED8',
  historicalBg:  '#F5F3FF',  // purple tint
  historicalText:'#7C3AED',
  heuristicBg:   '#F8FAFC',  // gray tint
  heuristicText: '#475569',
} as const

export const BADGE_STATUS = {
  Ready:        { color: COLORS.success, bg: COLORS.successBg, icon: 'check',        text: 'Ready'         },
  Blocked:      { color: COLORS.error,   bg: COLORS.errorBg,   icon: 'x',            text: 'Blocked'       },
  Warning:      { color: COLORS.warning, bg: COLORS.warningBg, icon: 'alert-triangle',text: 'Warning'       },
  Pending:      { color: COLORS.pending, bg: COLORS.pendingBg, icon: 'clock',         text: 'Pending'       },
  NotConnected: { color: COLORS.gray400, bg: COLORS.gray100,   icon: 'minus',         text: 'Not connected' },
  Expired:      { color: COLORS.error,   bg: COLORS.errorBg,   icon: 'lock',          text: 'Expired'       },
  Active:       { color: COLORS.success, bg: COLORS.successBg, icon: 'check',         text: 'Active'        },
  Success:      { color: COLORS.success, bg: COLORS.successBg, icon: 'check',         text: 'Success'       },
  Rejected:     { color: COLORS.error,   bg: COLORS.errorBg,   icon: 'x-circle',      text: 'Rejected'      },
  Error:        { color: COLORS.gray600, bg: COLORS.gray100,   icon: 'alert-circle',  text: 'Error'         },
  Suppressed:   { color: COLORS.warning, bg: COLORS.warningBg, icon: 'eye-off',       text: 'Suppressed'    },
} as const

export type BadgeStatus = keyof typeof BADGE_STATUS

export const COMPLETENESS = {
  greenMin:  80,   // ≥80 = green / Good
  amberMin:  50,   // 50–79 = amber / Needs work
  // <50 = red / Incomplete
  statusLabel: (score: number): string =>
    score >= 80 ? 'Good' : score >= 50 ? 'Needs work' : 'Incomplete',
  color: (score: number): string =>
    score >= 80 ? COLORS.success : score >= 50 ? COLORS.warning : COLORS.error,
  weights: {
    title:        15,
    mainImage:    15,
    sku:          10,
    description:  10,
    category:     10,
    hsnCode:      10,
    gstRate:       5,
    mrp:          10,
    sellingPrice:  5,
    brand:         5,
    colour:        3,
    size:          2,
  } as Record<string, number>,
} as const

export const SOURCE_LABEL = {
  LIVE_API:           { label: 'Live API',      bg: COLORS.liveApiBg,    text: COLORS.liveApiText    },
  LOCAL_RULES:        { label: 'Local rules',   bg: COLORS.localRulesBg, text: COLORS.localRulesText },
  HISTORICAL_DATA:    { label: 'Your data',     bg: COLORS.historicalBg, text: COLORS.historicalText },
  HEURISTIC_FALLBACK: { label: 'Estimated',     bg: COLORS.heuristicBg,  text: COLORS.heuristicText  },
} as const

export type SourceType = keyof typeof SOURCE_LABEL

export const CONNECTOR = {
  amazon:   { slug: 'amazon-in',  displayName: 'Amazon India', capabilities: ['PUBLISH','VALIDATE','WEBHOOK_RECEIVE','STATUS_SYNC'] },
  flipkart: { slug: 'flipkart',   displayName: 'Flipkart',     capabilities: ['PUBLISH','VALIDATE','STATUS_SYNC'] },
  meesho:   { slug: 'meesho',     displayName: 'Meesho',       capabilities: ['VALIDATE','EXCEL_EXPORT'] },
} as const

/** Severity ranking for multi-account badge (highest wins) */
export const BADGE_SEVERITY: Record<string, number> = {
  REJECTED:      5,
  BLOCKED:       5,
  ERROR:         4,
  PENDING:       3,
  WARNING:       2,
  SUCCESS:       1,
  READY:         1,
  NOT_CONNECTED: 0,
}

export const PLAN_LIMITS_THRESHOLDS = {
  warningPct:  0.80,   // 80% → amber warning
  criticalPct: 0.95,   // 95% → red critical
  maxPct:      1.00,   // 100% → CTA disabled
} as const

export const PAGINATION = {
  defaultSize: 50,
  maxSize:     200,
} as const

export const POLL_INTERVALS_MS = {
  pendingBadge:   10_000,   // product detail channel badges while PENDING
  catalogBadges:  15_000,   // catalog list channel badges while any PENDING
  readinesStrip:  60_000,   // home readiness strip
  connectorList:  30_000,   // channels overview
  notifications:  30_000,
  planUsage:       5 * 60_000,  // billing/usage (5 min)
} as const
