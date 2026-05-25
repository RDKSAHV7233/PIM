import Link from "next/link";
import { BrandLogo } from "@/components/ui/brand-logo";

export const metadata = {
  title: "Account Suspended — Vexa PIM",
};

function getContactEmail(): string {
  return String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim();
}

function getContactUrl(): string {
  return String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim();
}

export default function AccountSuspendedPage() {
  const contactEmail = getContactEmail();
  const contactUrl = getContactUrl();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <BrandLogo variant="lockup" />
        </div>
        <div className="mb-4 inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
          Workspace suspended
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-900">
          Your workspace access has been suspended
        </h1>
        <p className="mb-6 text-sm text-slate-600">
          Access to this Vexa PIM workspace has been suspended. This may be due to a billing issue or
          a policy change. Contact Vexa commercial operations to restore access.
        </p>
        <div className="space-y-3">
          {contactUrl ? (
            <a
              href={contactUrl}
              className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Contact Vexa to restore access
            </a>
          ) : contactEmail ? (
            <a
              href={`mailto:${contactEmail}?subject=Workspace%20suspension%20inquiry`}
              className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Email Vexa support
            </a>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Contact your Vexa account representative to restore workspace access.
            </p>
          )}
          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
