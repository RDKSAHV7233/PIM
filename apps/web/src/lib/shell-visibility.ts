export const PATHNAME_HEADER = "x-pim-pathname";

/**
 * `/login` (and anything under it) never shows the signed-in shell.
 *
 * RootLayout decides between the signed-in shell (sidebar, role badge) and the plain public layout from
 * the session token, but that check is only local (signature + expiry). A token the server has revoked
 * still passes it, and such a visitor is sent to `/login?reason=session_expired`; drawing the signed-in
 * chrome around the login form there is confusing and shows the app's navigation to someone who is not
 * signed in. RootLayout therefore does not read the session on login routes.
 */
export function isLoginRoute(pathname: string | null | undefined): boolean {
  const path = String(pathname ?? "").trim();
  return path === "/login" || path.startsWith("/login/");
}
