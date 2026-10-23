"use client";

import Link from "@/components/ui/app-link";
import { useRef, useState } from "react";

interface AuthPolicyEnterpriseFormProps {
  action: (formData: FormData) => void;
  policy: {
    externalIdentityMode: boolean;
    mfaRequired: boolean;
    mfaGracePeriodDays: number;
    sessionTimeoutMinutes: number;
    allowedAuthMethods: string[];
  };
}

export function AuthPolicyEnterpriseForm({ action, policy }: AuthPolicyEnterpriseFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mfaChecked, setMfaChecked] = useState(policy.mfaRequired);

  function handleSubmit(formData: FormData) {
    if (policy.mfaRequired && !mfaChecked) {
      const confirmed = window.confirm(
        "You are about to disable MFA for all workspace members.\n\n" +
        "This will remove the MFA enrollment requirement and may reduce your workspace security posture.\n\n" +
        "Are you sure you want to continue?",
      );
      if (!confirmed) {
        setMfaChecked(true);
        return;
      }
    }
    action(formData);
  }

  return (
    <form ref={formRef} action={handleSubmit} className="mt-4 grid gap-4">
      <input type="hidden" name="errorRedirectTo" value="/admin/auth-policy" />

      <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm">
        <input type="checkbox" name="externalIdentityMode" defaultChecked={policy.externalIdentityMode} className="mt-1 h-4 w-4" />
        <span>
          <span className="font-medium text-slate-900">External identity mode</span>
          <span className="mt-1 block text-slate-600">
            Stores tenant intent for OIDC-based sign-in. Runtime OIDC login is not enforced in this slice.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm">
        <input
          type="checkbox"
          name="mfaRequired"
          checked={mfaChecked}
          onChange={(e) => setMfaChecked(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <span>
          <span className="font-medium text-slate-900">Require MFA</span>
          <span className="mt-1 block text-slate-600">
            Enforced at login in database auth mode: enrolled members are challenged for their code. Unenrolled
            members can keep signing in during the grace period below, then are required to enroll once it ends.
          </span>
        </span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">MFA grace period (days)</span>
          <input
            type="number"
            min={0}
            max={90}
            name="mfaGracePeriodDays"
            defaultValue={policy.mfaGracePeriodDays}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          <span className="text-xs text-slate-500">
            Rollout window from when Require MFA is turned on — unenrolled members can still sign in until it ends,
            then enrollment is enforced. Changing this value doesn't restart an already-running window.
          </span>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">Session timeout (minutes)</span>
          <select
            name="sessionTimeoutMinutes"
            defaultValue={String(policy.sessionTimeoutMinutes)}
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="30">30 minutes</option>
            <option value="60">60 minutes</option>
            <option value="120">120 minutes</option>
            <option value="240">240 minutes</option>
          </select>
        </label>
      </div>

      <fieldset className="grid gap-2 text-sm">
        <legend className="font-medium text-slate-700">Allowed sign-in methods</legend>
        <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3">
          <input
            type="checkbox"
            name="allowedAuthMethods"
            value="password"
            defaultChecked={policy.allowedAuthMethods.includes("password")}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="font-medium text-slate-900">Password login</span>
            <span className="mt-1 block text-slate-600">Current production sign-in path.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3">
          <input
            type="checkbox"
            name="allowedAuthMethods"
            value="oidc"
            defaultChecked={policy.allowedAuthMethods.includes("oidc")}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="font-medium text-slate-900">OIDC sign-in</span>
            <span className="mt-1 block text-slate-600">
              Enables OIDC-based login. Configure your identity provider in{" "}
              <Link href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin &rarr; OIDC / SSO</Link>.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Save Auth Policy
        </button>
        <span className="text-xs text-slate-500">
          Session timeout takes effect now. MFA enrollment and allowed auth methods enforcement are active in database mode. OIDC sign-in requires an active IdP configuration &mdash; see{" "}
          <Link href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin &rarr; OIDC / SSO</Link>.
        </span>
      </div>
    </form>
  );
}
