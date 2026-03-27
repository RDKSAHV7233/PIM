import { PimLocale } from "@/lib/locale";

export interface AuthCopy {
  loginTitle: string;
  loginSubtitle: string;
  signupLinkPrompt: string;
  signupLinkCta: string;
  workspaceLabel: string;
  workspacePlaceholder: string;
  workspaceInvalid: string;
  workspaceAvailable: string;
  workspaceChecking: string;
  workspaceTaken: string;
  workspaceNotFound: string;
  emailLabel: string;
  loginReasonSessionExpired: string;
  loginReasonForbidden: string;
  loginReasonTenantSuspended: string;
  passwordLabel: string;
  newPasswordLabel: string;
  confirmPasswordLabel: string;
  displayNameLabel: string;
  signupTitle: string;
  signupSubtitle: string;
  signupSubmit: string;
  signupSubmitting: string;
  signupSuccess: string;
  signupDuplicateEmail: string;
  signupPendingVerification: string;
  signupEmailInvalid: string;
  signupTermsLabel: string;
  signupPasswordHelp: string;
  signupPasswordMismatch: string;
  signupDisplayNameRequired: string;
  signupVerifyTitle: string;
  signupVerifySubtitle: string;
  signupVerifyInProgress: string;
  signupVerifySuccess: string;
  signupVerifyInvalid: string;
  signupResendPrompt: string;
  signupResendSubmit: string;
  signupResendSubmitting: string;
  signupResendSuccess: string;
  signupResendError: string;
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
  loginTitle: "Sign in to TEJ PIM",
  loginSubtitle: "Use your account credentials to continue.",
  signupLinkPrompt: "New to TEJ PIM?",
  signupLinkCta: "Create your workspace",
  workspaceLabel: "Workspace",
  workspacePlaceholder: "your-company",
  workspaceInvalid: "Use lowercase letters, numbers, or hyphens.",
  workspaceAvailable: "Workspace ID is available.",
  workspaceChecking: "Checking workspace availability...",
  workspaceTaken: "That workspace ID is already taken.",
  workspaceNotFound: "Workspace not found. Check your workspace ID and try again.",
  emailLabel: "User ID",
  loginReasonSessionExpired: "Your session expired. Please sign in again.",
  loginReasonForbidden: "Your account does not have access to that page.",
  loginReasonTenantSuspended: "This workspace is temporarily suspended. Contact TEJ to restore access.",
  passwordLabel: "Password",
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm new password",
  displayNameLabel: "Workspace name",
  signupTitle: "Create your TEJ PIM workspace",
  signupSubtitle: "Set up your workspace and first admin account. We will email you a verification link before activation.",
  signupSubmit: "Create workspace",
  signupSubmitting: "Creating workspace...",
  signupSuccess: "Check your email for the verification link to finish creating your workspace.",
  signupDuplicateEmail: "That email is already in use. Sign in or reset your password instead.",
  signupPendingVerification: "A verification email is already pending for that address. Check your inbox or resend the verification link.",
  signupEmailInvalid: "Enter a valid email address for the first admin.",
  signupTermsLabel: "I accept the Terms of Service and Privacy Policy.",
  signupPasswordHelp: "Use at least 8 characters.",
  signupPasswordMismatch: "The password confirmation does not match.",
  signupDisplayNameRequired: "Workspace name is required.",
  signupVerifyTitle: "Verify your workspace",
  signupVerifySubtitle: "We'll confirm your email and activate your TEJ PIM workspace.",
  signupVerifyInProgress: "Verifying your workspace link...",
  signupVerifySuccess: "Your workspace is ready. Sign in with the workspace ID, email, and password you just created.",
  signupVerifyInvalid: "This verification link is invalid or has expired.",
  signupResendPrompt: "Need a fresh verification email?",
  signupResendSubmit: "Resend verification email",
  signupResendSubmitting: "Resending verification email...",
  signupResendSuccess: "If a pending signup exists for that email, we sent a new verification link.",
  signupResendError: "Unable to resend verification right now. Please try again.",
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

