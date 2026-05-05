import { SetMetadata } from "@nestjs/common";

export const ALLOW_MFA_ENROLLMENT_TOKEN_KEY = "allow_mfa_enrollment_token";
export const AllowMfaEnrollmentToken = () => SetMetadata(ALLOW_MFA_ENROLLMENT_TOKEN_KEY, true);
