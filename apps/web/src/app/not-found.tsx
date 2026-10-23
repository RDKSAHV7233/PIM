import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-4xl font-semibold text-slate-300">404</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          The requested page does not exist or you do not have access.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className={buttonVariants({ variant: "primary" })}>
            Go to dashboard
          </Link>
          <Link href="/catalog/products" className={buttonVariants({ variant: "secondary" })}>
            Open catalog
          </Link>
        </div>
      </div>
    </div>
  );
}
