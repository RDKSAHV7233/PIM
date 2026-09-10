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
  signupVerificationSendFailed: string;
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
  signupVerifyStartOver: string;
  roleLabel: string;
  signIn: string;
  signingIn: string;
  invalidCredentials: string;
  genericLoginFailure: string;
  loginServiceUnavailable: string;
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
  mfaChallengeTitle: string;
  mfaChallengeSubtitle: string;
  mfaChallengeCodeLabel: string;
  mfaChallengeSubmit: string;
  mfaChallengeSubmitting: string;
  mfaChallengeInvalidCode: string;
  mfaChallengeExpiredSession: string;
  mfaEnrollTitle: string;
  mfaEnrollSubtitle: string;
  mfaEnrollScanInstruction: string;
  mfaEnrollSecretLabel: string;
  mfaEnrollCodeLabel: string;
  mfaEnrollSubmit: string;
  mfaEnrollSubmitting: string;
  mfaEnrollInvalidCode: string;
  mfaEnrollBackupCodesTitle: string;
  mfaEnrollBackupCodesSubtitle: string;
  mfaEnrollContinue: string;
  mfaEnrollLoadError: string;
  authMethodNotAllowed: string;
  mfaSetupCta: string;
}

const EN_COPY: AuthCopy = {
  loginTitle: "Sign in to Vexa PIM",
  loginSubtitle: "Use your account credentials to continue.",
  signupLinkPrompt: "New to Vexa PIM?",
  signupLinkCta: "Create your workspace",
  workspaceLabel: "Workspace",
  workspacePlaceholder: "your-company",
  workspaceInvalid: "Use lowercase letters, numbers, or hyphens.",
  workspaceAvailable: "Workspace ID is available.",
  workspaceChecking: "Checking workspace availability...",
  workspaceTaken: "That workspace ID is already taken.",
  workspaceNotFound: "Workspace not found. Check your workspace ID and try again.",
  emailLabel: "Email / User ID",
  loginReasonSessionExpired: "Your session expired. Please sign in again.",
  loginReasonForbidden: "Your account does not have access to that page.",
  loginReasonTenantSuspended: "This workspace is temporarily suspended. Contact Vexa to restore access.",
  passwordLabel: "Password",
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm new password",
  displayNameLabel: "Workspace name",
  signupTitle: "Create your Vexa PIM workspace",
  signupSubtitle: "Set up your workspace and first admin account. We will email you a verification link before activation.",
  signupSubmit: "Create workspace",
  signupSubmitting: "Creating workspace...",
  signupSuccess: "Check your email for the verification link to finish creating your workspace.",
  signupDuplicateEmail: "That email is already in use. Sign in or reset your password instead.",
  signupPendingVerification: "A verification email is already pending for that address. Check your inbox or resend the verification link.",
  signupVerificationSendFailed: "We couldn't send the verification email right now. Please try again.",
  signupEmailInvalid: "Enter a valid email address for the first admin.",
  signupTermsLabel: "I accept the Terms of Service and Privacy Policy.",
  signupPasswordHelp: "Use at least 8 characters.",
  signupPasswordMismatch: "The password confirmation does not match.",
  signupDisplayNameRequired: "Workspace name is required.",
  signupVerifyTitle: "Verify your workspace",
  signupVerifySubtitle: "We'll confirm your email and activate your Vexa PIM workspace.",
  signupVerifyInProgress: "Verifying your workspace link...",
  signupVerifySuccess: "Your workspace is ready. Sign in with the workspace ID, email, and password you just created.",
  signupVerifyInvalid: "This verification link is invalid or has expired.",
  signupResendPrompt: "Need a fresh verification email?",
  signupResendSubmit: "Resend verification email",
  signupResendSubmitting: "Resending verification email...",
  signupResendSuccess: "If a pending signup exists for that email, we sent a new verification link.",
  signupResendError: "Unable to resend verification right now. Please try again.",
  signupVerifyStartOver: "Start a new sign-up",
  roleLabel: "Role",
  signIn: "Sign in",
  signingIn: "Signing in...",
  invalidCredentials: "Invalid user ID or password.",
  genericLoginFailure: "Unable to login right now. Please try again.",
  loginServiceUnavailable: "Sign-in is temporarily unavailable. Please try again in a few minutes.",
  networkError: "Network error. Check your connection and try again.",
  forgotPasswordPrefix: "If you forgot your password, reset it",
  forgotPasswordSuffix: "here",
  rateLimitedTitle: "Too many login attempts from this network.",
  rateLimitedBody: "Please wait before trying again.",
  rateLimitedRetryIn: "Retry in",
  lockedTitle: "This account has been locked for security.",
  lockedBodyPrefix: "is locked after too many failed sign-in attempts. Your account will unlock automatically, or request an unlock email now.",
  lockedUntilPrefix: "Unlocks automatically at",
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
  mfaChallengeTitle: "Two-factor verification",
  mfaChallengeSubtitle: "Enter the 6-digit code from your authenticator app.",
  mfaChallengeCodeLabel: "Verification code",
  mfaChallengeSubmit: "Verify",
  mfaChallengeSubmitting: "Verifying...",
  mfaChallengeInvalidCode: "Invalid or expired code. Try again.",
  mfaChallengeExpiredSession: "Your login session expired. Please sign in again.",
  mfaEnrollTitle: "Set up two-factor authentication",
  mfaEnrollSubtitle: "Scan the key URI with your authenticator app, or enter the secret manually.",
  mfaEnrollScanInstruction: "Add this to your authenticator app using the URI or the manual entry key below.",
  mfaEnrollSecretLabel: "Manual entry key",
  mfaEnrollCodeLabel: "Confirm with a 6-digit code",
  mfaEnrollSubmit: "Activate two-factor",
  mfaEnrollSubmitting: "Activating...",
  mfaEnrollInvalidCode: "Code did not match. Make sure your device clock is accurate and try again.",
  mfaEnrollBackupCodesTitle: "Save your backup codes",
  mfaEnrollBackupCodesSubtitle: "Each code can be used once if you lose access to your authenticator. Store these somewhere safe — they won't be shown again.",
  mfaEnrollContinue: "Continue to sign in",
  mfaEnrollLoadError: "Unable to start MFA setup. Please try signing in again.",
  authMethodNotAllowed: "Password sign-in is not permitted for this workspace. Contact your administrator.",
  mfaSetupCta: "Set up two-factor authentication",
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

