import { PimLocale } from "@/lib/locale";

export interface AuthCopy {
  loginTitle: string;
  loginSubtitle: string;
  workspaceLabel: string;
  workspacePlaceholder: string;
  workspaceInvalid: string;
  workspaceNotFound: string;
  emailLabel: string;
  loginReasonSessionExpired: string;
  loginReasonForbidden: string;
  passwordLabel: string;
  roleLabel: string;
  signIn: string;
  signingIn: string;
  invalidCredentials: string;
  genericLoginFailure: string;
  networkError: string;
  forgotPasswordPrefix: string;
  forgotPasswordSuffix: string;
  rateLimitedTitle: string;
  rateLimitedBody: string;
  rateLimitedRetryIn: string;
  lockedTitle: string;
  lockedBodyPrefix: string;
  lockedUntilPrefix: string;
  resendUnlock: string;
  resendNeedsEmail: string;
  resendFailed: string;
  resendSent: string;
  backToLogin: string;
  resetTitle: string;
  resetSubtitle: string;
  resetSubmit: string;
  resetSubmitting: string;
  resetSuccess: string;
  resetError: string;
}

const EN_COPY: AuthCopy = {
  loginTitle: "Sign in to PIM1",
  loginSubtitle: "Use your account credentials to continue.",
  workspaceLabel: "Workspace",
  workspacePlaceholder: "your-company",
  workspaceInvalid: "Use lowercase letters, numbers, or hyphens.",
  workspaceNotFound: "Workspace not found. Check your workspace ID and try again.",
  emailLabel: "User ID",
  loginReasonSessionExpired: "Your session expired. Please sign in again.",
  loginReasonForbidden: "Your account does not have access to that page.",
  passwordLabel: "Password",
  roleLabel: "Role",
  signIn: "Sign in",
  signingIn: "Signing in...",
  invalidCredentials: "Invalid user ID or password.",
  genericLoginFailure: "Unable to login right now. Please try again.",
  networkError: "Network error. Check your connection and try again.",
  forgotPasswordPrefix: "If you forgot your password, reset it",
  forgotPasswordSuffix: "here",
  rateLimitedTitle: "Too many login attempts from this network.",
  rateLimitedBody: "Please wait before trying again.",
  rateLimitedRetryIn: "Retry in",
  lockedTitle: "This account has been locked for security.",
  lockedBodyPrefix: "is locked. Contact your workspace admin for help.",
  lockedUntilPrefix: "Unlock available after",
  resendUnlock: "Request unlock help",
  resendNeedsEmail: "Email is required so your workspace admin can identify the account.",
  resendFailed: "Unable to submit your unlock request right now.",
  resendSent: "Contact your workspace admin to unlock this account.",
  backToLogin: "Back to login",
  resetTitle: "Reset your password",
  resetSubtitle: "Enter your email to confirm the account. A workspace admin must set a new password for you.",
  resetSubmit: "Request password help",
  resetSubmitting: "Submitting...",
  resetSuccess: "Password reset email is not available yet. Contact your workspace admin for a reset.",
  resetError: "Unable to process your request right now. Please try again.",
};

const HI_COPY: AuthCopy = {
  ...EN_COPY,
};

const COPY_BY_LOCALE: Record<PimLocale, AuthCopy> = {
  en: EN_COPY,
  hi: HI_COPY,
};

export function getAuthCopy(locale: PimLocale): AuthCopy {
  return COPY_BY_LOCALE[locale] ?? EN_COPY;
}
