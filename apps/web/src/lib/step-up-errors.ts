// The API reports step-up failures as 401 with a step-up error code in the body (for example a wrong password:
// 401 {"error":"STEP_UP_INVALID_CREDENTIALS"}). A genuinely expired session is also a 401, but its body carries
// no step-up code ({"error":"Unauthorized"}). Server actions must tell the two apart: the first belongs on the
// wizard as "Step-up re-authentication failed", the second sends the operator to sign in again. Import-free so
// tests can execute it.

export const STEP_UP_ERROR_CODES = new Set([
  "STEP_UP_REQUIRED",
  "STEP_UP_INVALID_CREDENTIALS",
  "STEP_UP_TOKEN_INVALID",
  "STEP_UP_TOKEN_SESSION_MISMATCH",
  "STEP_UP_SCOPE_MISMATCH",
  "STEP_UP_PASSWORD_REQUIRED",
]);

export function stepUpErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }
  const code = String((body as Record<string, unknown>).error ?? "").trim();
  return STEP_UP_ERROR_CODES.has(code) ? code : "";
}

export function isStepUpErrorBody(body: unknown): boolean {
  return stepUpErrorCode(body) !== "";
}
