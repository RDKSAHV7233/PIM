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
  newPasswordLabel: string;
  confirmPasswordLabel: string;
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
  resetTokenSubtitle: string;
  resetSubmit: string;
  resetSubmitting: string;
  resetConfirmSubmit: string;
  resetConfirming: string;
  resetSuccess: string;
  resetCompleteSuccess: string;
  resetError: string;
  resetInvalidToken: string;
  resetPasswordMismatch: string;
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
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm new password",
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
  lockedBodyPrefix: "is locked. Request a recovery email to set a new password and regain access.",
  lockedUntilPrefix: "Unlock available after",
  resendUnlock: "Email me a recovery link",
  resendNeedsEmail: "Email is required so we can send the recovery link.",
  resendFailed: "Unable to send a recovery email right now.",
  resendSent: "If the account exists, we sent a recovery email with the next steps.",
  backToLogin: "Back to login",
  resetTitle: "Reset your password",
  resetSubtitle: "Enter your email to receive a password reset link.",
  resetTokenSubtitle: "Set a new password to finish recovering access to your account.",
  resetSubmit: "Send reset email",
  resetSubmitting: "Sending...",
  resetConfirmSubmit: "Set new password",
  resetConfirming: "Updating password...",
  resetSuccess: "If the account exists, a password reset email has been sent.",
  resetCompleteSuccess: "Your password has been updated. You can sign in again now.",
  resetError: "Unable to process your request right now. Please try again.",
  resetInvalidToken: "This reset link is invalid or has expired.",
  resetPasswordMismatch: "The password confirmation does not match.",
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
