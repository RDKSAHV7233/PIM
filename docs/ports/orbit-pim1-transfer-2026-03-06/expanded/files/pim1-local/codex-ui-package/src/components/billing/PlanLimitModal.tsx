/**
 * PlanLimitModal — shown on every HTTP 402 response.
 * RULE R6: This is the ONLY way 402 errors are surfaced. Never a generic toast.
 * Register this component's handler in the root layout via registerPlanLimitHandler().
 */
'use client'
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/shadcn/dialog'
import { registerPlanLimitHandler, type PlanLimitError } from '@/api/client'
import { K } from '@/i18n/keys'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

const RESOURCE_I18N: Record<PlanLimitError['resource'], (typeof K)[keyof typeof K]> = {
  skus: K.planResourceSkus,
  submissions: K.planResourceSubmissions,
  storageGb: K.planResourceStorage,
  users: K.planResourceUsers,
}

export function PlanLimitModal() {
  const t = useTranslations()
  const router = useRouter()
  const [error, setError] = useState<PlanLimitError | null>(null)

  useEffect(() => {
    registerPlanLimitHandler((err) => setError(err))
  }, [])

  if (!error) return null

  const resource = t(RESOURCE_I18N[error.resource])

  return (
    <Dialog open onOpenChange={() => setError(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(K.planLimitTitle, { resource })}</DialogTitle>
          <DialogDescription>
            {t(K.planLimitBody, {
              plan: t(K.planYourPlan),
              limit: error.limit.toLocaleString('en-IN'),
              resource,
              current: error.current.toLocaleString('en-IN'),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 mt-2">
          <button
            className="flex-1 bg-accent text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700"
            onClick={() => { setError(null); router.push('/settings/plan') }}
          >
            {t(K.planLimitUpgrade)}
          </button>
          <button
            className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-md text-sm hover:bg-gray-50"
            onClick={() => setError(null)}
          >
            {t(K.planLimitMaybeLater)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
