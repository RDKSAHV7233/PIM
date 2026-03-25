export function isPublicSignupEnabled(): boolean {
  const publicValue = String(process.env.NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED ?? "").trim();
  if (publicValue) {
    return publicValue.toLowerCase() === "true";
  }
  return String(process.env.FEATURE_PUBLIC_SIGNUP_ENABLED ?? "false").trim().toLowerCase() === "true";
}
