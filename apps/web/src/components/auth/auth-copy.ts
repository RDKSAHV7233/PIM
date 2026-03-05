import { PimLocale } from "@/lib/locale";

export interface AuthCopy {
  loginTitle: string;
  loginSubtitle: string;
  emailLabel: string;
  loginReasonSessionExpired: string;
  loginReasonForbidden: string;
  passwordLabel: string;
  tenantLabel: string;
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
  emailLabel: "User ID",
  loginReasonSessionExpired: "Your session expired. Please sign in again.",
  loginReasonForbidden: "Your account does not have access to that page.",
  passwordLabel: "Password",
  tenantLabel: "Tenant",
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
  lockedBodyPrefix: "We sent an unlock email to",
  lockedUntilPrefix: "Unlock available after",
  resendUnlock: "Resend unlock email",
  resendNeedsEmail: "Email is required to resend unlock instructions.",
  resendFailed: "Unable to resend right now.",
  resendSent: "Email sent.",
  backToLogin: "Back to login",
  resetTitle: "Reset your password",
  resetSubtitle: "Enter your email and we will send reset instructions.",
  resetSubmit: "Send reset link",
  resetSubmitting: "Sending...",
  resetSuccess: "If this email exists, reset instructions have been sent.",
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
