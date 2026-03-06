/**
 * PIM1 API Response Types
 * Generated from OpenAPI spec (update when spec changes).
 * All components import types from here, not from inline definitions.
 */

// ── Pagination ─────────────────────────────────────────────────────────────────
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  prevCursor: string | null
  total?: number
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  token: string
  user: UserMe
  consentRequired?: boolean
}
export interface UserMe {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  tenantId: string
  tenantName: string
  planTier: 'STARTER' | 'GROWTH' | 'ENTERPRISE'
}

// ── Products ───────────────────────────────────────────────────────────────────
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

export interface ProductListItem {
  id: string
  title: string
  sku: string
  brand: string
  categoryName: string
  status: ProductStatus
  completenessScore: number
  mainImageUrl: string | null
  issueCount: number
  updatedAt: string
  channelBadges: ChannelBadge[]
}

export interface ChannelBadge {
  connectorSlug: string
  status: string    // BadgeStatus key
  topError: string | null
  installationCount: number   // >1 = multi-account
  perAccount?: { accountAlias: string; status: string }[]
}

export interface ProductDetail extends ProductListItem {
  description: string
  hsnCode: string
  gstRate: number
  mrp: number
  sellingPrice: number
  colour: string
  size: string
  attributes: Record<string, unknown>
  mediaAssets: MediaAsset[]
  channelReadiness: ChannelReadiness[]
}

export interface ChannelReadiness {
  connectorSlug: string
  displayName: string
  score: number
  blockingCount: number
  warningCount: number
  source: 'LIVE_API' | 'LOCAL_RULES' | 'NOT_VALIDATED'
}

// ── Media ──────────────────────────────────────────────────────────────────────
export interface MediaAsset {
  id: string
  cdnUrl: string
  storageKey: string
  mimeType: string
  width: number | null
  height: number | null
  sizeBytes: number
  checksum: string
  isMainImage: boolean
  uploadedAt: string
  lastVerifiedAt: string | null
}

// ── Connectors ─────────────────────────────────────────────────────────────────
export type InstallStatus = 'ACTIVE' | 'PAUSED' | 'CREDENTIAL_EXPIRED' | 'DISABLED'

export interface ConnectorInstalled {
  id: string
  connectorSlug: string
  displayName: string
  accountAlias: string
  status: InstallStatus
  authType: 'OAUTH_LWA' | 'OAUTH_AUTHCODE' | 'API_KEY' | 'EXCEL_ONLY'
  capabilities: string[]
  lastValidatedAt: string | null
  submissionSuccessRate: number | null  // 0–1, last 30 days
  credentialExpiresAt: string | null
  failureReason: string | null
}

export interface ConnectorDefinition {
  slug: string
  displayName: string
  capabilities: string[]
  authType: string
  isEnabled: boolean
}

// ── Submissions ────────────────────────────────────────────────────────────────
export type SubmissionStatus = 'PENDING' | 'SUCCESS' | 'REJECTED' | 'SUPPRESSED' | 'ERROR'
export type SubmissionType   = 'VALIDATE' | 'PUBLISH' | 'UPDATE' | 'EXPORT_FILE'
export type SubmissionSource = 'MANUAL' | 'AUTO_RETRY' | 'WEBHOOK_SYNC'

export interface SubmissionListItem {
  id: string
  productId: string
  productTitle: string
  productSku: string
  connectorSlug: string
  submissionType: SubmissionType
  source: SubmissionSource
  status: SubmissionStatus
  externalRef: string | null
  attemptNumber: number
  errorCount: number
  submittedAt: string
}

export interface SubmissionDetail extends SubmissionListItem {
  idempotencyKey: string
  channelErrors: ConnectorIssue[]
  payloadSnapshot: Record<string, unknown> | { truncated: true; snapshotUrl: string } | null
  payloadSnapshotUrl: string | null
  installationId: string
  accountAlias: string
  credentialStatus: string
}

// ── Issues / Validation ────────────────────────────────────────────────────────
export interface ConnectorIssue {
  code: string
  fieldPath: string | null
  sellerMessage: string
  severity: 'error' | 'warning'
  source: 'LIVE_API' | 'LOCAL_RULES' | 'HISTORICAL_DATA' | 'HEURISTIC_FALLBACK'
}

export interface IssueListItem {
  id: string
  productId: string
  productTitle: string
  productSku: string
  connectorSlug: string
  fieldPath: string
  code: string
  sellerMessage: string
  severity: 'error' | 'warning'
  source: ConnectorIssue['source']
  status: 'open' | 'resolved'
  firstSeenAt: string
  lastSeenAt: string
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export interface ReadinessConnector {
  slug: string
  displayName: string
  ready: number
  blocked: number
  pending: number
  notConnected?: boolean
  asOf: string
}
export interface ReadinessResponse {
  connectors: ReadinessConnector[]
  asOf: string
}

export interface CatalogHealthResponse {
  averageCompleteness: number
  belowThreshold: number
  missingMainImage: number
  missingRequiredAttrs: number
  distribution: { bucket: string; count: number }[]
}

// ── Billing / Plan ──────────────────────────────────────────────────────────────
export interface UsageResponse {
  planTier: 'STARTER' | 'GROWTH' | 'ENTERPRISE'
  month: string
  billingCycleResetAt: string
  skus:        { current: number; limit: number }
  submissions: { current: number; limit: number }
  storageGb:   { current: number; limit: number }
  users:       { current: number; limit: number }
}

// ── Notifications ──────────────────────────────────────────────────────────────
export type NotificationEventType =
  | 'SUBMISSION_REJECTED'
  | 'CREDENTIAL_EXPIRED'
  | 'PLAN_LIMIT_WARNING'
  | 'PLAN_LIMIT_REACHED'
  | 'CONSENT_REQUIRED'
  | 'BULK_JOB_COMPLETE'
  | 'BULK_JOB_FAILED'

export interface NotificationItem {
  id: string
  eventType: NotificationEventType
  title: string
  body: string
  actionUrl: string | null
  isRead: boolean
  isDismissible: boolean
  createdAt: string
}

// ── Account / DPDP ─────────────────────────────────────────────────────────────
export interface AccountExportResponse {
  jobId: string
  status: 'queued'
  estimatedReadyAt: string
}

export interface AccountEraseResponse {
  scheduled: true
  completesBy: string
}
