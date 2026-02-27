export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="space-y-2 py-10">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-600">The requested resource does not exist.</p>
    </div>
  );
}
