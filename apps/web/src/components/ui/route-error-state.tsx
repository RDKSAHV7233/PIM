import Link from "@/components/ui/app-link";
import { Button, buttonVariants } from "@/components/ui/button";

interface RouteErrorStateProps {
  title?: string;
  description?: string;
  retry?: () => void;
  homeHref?: string;
}

export function RouteErrorState({
  title = "Something went wrong",
  description = "An unexpected error occurred. Try refreshing or go back to the dashboard.",
  retry,
  homeHref = "/dashboard",
}: RouteErrorStateProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-3xl" aria-hidden="true">
          {"\u26A0\uFE0F"}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {retry ? (
            <Button type="button" onClick={retry}>
              Try again
            </Button>
          ) : null}
          <Link href={homeHref} className={buttonVariants({ variant: "secondary" })}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
