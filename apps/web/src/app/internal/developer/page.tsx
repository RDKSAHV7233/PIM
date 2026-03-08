import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function DeveloperPage() {
  const actorRole = await getServerActorRole();
  if (actorRole !== "admin" || process.env.APP_ENV === "production") {
    notFound();
  }

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs text-slate-500">
          Dashboard / Internal / <span className="font-semibold text-slate-700">Developer</span>
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Internal Tools</h1>
        <p className="mt-1 text-sm text-slate-600">Internal phase navigation and engineering utilities.</p>
      </header>
      <Card>
        <CardTitle>Internal phase navigation</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link className="rounded-md border border-border px-3 py-2" href="/media">
            Phase 5 DAM
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/rejection">
            Phase 6 Intelligence
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/ondc">
            Phase 7 ONDC
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/ai">
            Phase 8 AI
          </Link>
        </div>
      </Card>
    </div>
  );
}
