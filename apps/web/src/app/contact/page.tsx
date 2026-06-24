import { getServerSessionClaims } from "@/lib/server-session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get Access — Vexa PIM",
  description: "Contact us to get access to Vexa PIM.",
};

export default async function ContactPage() {
  const claims = await getServerSessionClaims();
  if (claims) {
    redirect("/dashboard");
  }
  const contactEmail = process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "";

  return (
    <div className="mx-auto max-w-md py-16 px-4 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Get access to Vexa PIM</h1>
      <p className="mt-4 text-slate-600">
        Vexa PIM is currently available by invitation only. Reach out to our team to request access.
      </p>
      {contactEmail ? (
        <a
          href={`mailto:${contactEmail}`}
          className="mt-8 inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Contact us
        </a>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          Please contact your account manager for access.
        </p>
      )}
    </div>
  );
}
