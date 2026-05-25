import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { CheckWorkspaceAvailabilityDto } from "./dto/check-workspace-availability.dto";
import { CreatePublicSignupDto } from "./dto/create-public-signup.dto";
import { ResendPublicSignupVerificationDto } from "./dto/resend-public-signup-verification.dto";
import { VerifyPublicSignupDto } from "./dto/verify-public-signup.dto";
import { SignupRateLimitError, SignupService } from "./signup.service";

@Controller("signup")
@ApiTags("Public Signup")
export class SignupController {
  private readonly logger = new Logger(SignupController.name);

  constructor(private readonly signupService: SignupService) {}

  @Public()
  @Get("workspace/availability")
  @ApiOperation({ summary: "Check whether a workspace slug is available for public signup" })
  @ApiQuery({ name: "workspaceSlug", required: true })
  @ApiResponse({ status: 200, description: "Workspace availability evaluated" })
  async checkWorkspaceAvailability(@Query() dto: CheckWorkspaceAvailabilityDto) {
    try {
      return await this.signupService.checkWorkspaceAvailability(dto.workspaceSlug);
    } catch (error: unknown) {
      this.rethrowMappedError(error);
    }
  }

  @Public()
  @Post("workspace")
  @HttpCode(200)
  @ApiOperation({ summary: "Create a pending public signup request" })
  @ApiResponse({ status: 200, description: "Signup request accepted and pending verification" })
  async createPublicSignup(
    @Body() dto: CreatePublicSignupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) reply: Response,
  ) {
    try {
      return await this.signupService.createPublicSignup(dto, this.getRequestIp(request));
    } catch (error: unknown) {
      this.rethrowMappedError(error, reply);
    }
  }

  @Public()
  @Post("verify")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify a public signup token and provision the workspace" })
  @ApiResponse({ status: 200, description: "Signup verified and workspace provisioned" })
  async verifyPublicSignup(@Body() dto: VerifyPublicSignupDto) {
    try {
      return await this.signupService.verifyPublicSignup(dto.token);
    } catch (error: unknown) {
      this.rethrowMappedError(error);
    }
  }

  @Public()
  @Post("resend-verification")
  @HttpCode(200)
  @ApiOperation({ summary: "Resend the verification email for a pending public signup" })
  @ApiResponse({ status: 200, description: "Verification email resent when a pending signup exists" })
  async resendVerification(
    @Body() dto: ResendPublicSignupVerificationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) reply: Response,
  ) {
    try {
      return await this.signupService.resendVerification(dto.adminEmail, this.getRequestIp(request));
    } catch (error: unknown) {
      this.rethrowMappedError(error, reply);
    }
  }

  private getRequestIp(request: Request): string {
    return String(request.ip ?? request.headers["x-forwarded-for"] ?? "unknown").trim() || "unknown";
  }

  private rethrowMappedError(error: unknown, reply?: Response): never {
    if (error instanceof SignupRateLimitError) {
      reply?.header("X-RateLimit-Retry-After", String(error.retryAfterSeconds));
      throw new HttpException(
        {
          error: "SIGNUP_RATE_LIMITED",
          retryAfterSeconds: error.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = error instanceof Error ? error.message : String(error ?? "unknown error");

    if (code === "FEATURE_DISABLED") {
      throw new NotFoundException({ error: "FEATURE_DISABLED" });
    }
    if (
      code === "WORKSPACE_SLUG_INVALID" ||
      code === "DISPLAY_NAME_REQUIRED" ||
      code === "PASSWORD_TOO_SHORT" ||
      code === "TERMS_ACCEPTANCE_REQUIRED"
    ) {
      throw new BadRequestException({ error: code });
    }
    if (
      code === "WORKSPACE_SLUG_ALREADY_ASSIGNED" ||
      code === "WORKSPACE_SLUG_ALREADY_PENDING" ||
      code === "ADMIN_EMAIL_ALREADY_REGISTERED" ||
      code === "SIGNUP_VERIFICATION_ALREADY_PENDING"
    ) {
      throw new ConflictException({ error: code });
    }
    if (code === "SIGNUP_VERIFICATION_TOKEN_INVALID") {
      throw new UnauthorizedException({ error: code });
    }
    if (code === "EMAIL_PROVIDER_MISCONFIGURED" || code === "SIGNUP_VERIFICATION_SEND_FAILED") {
      throw new BadGatewayException({ error: code });
    }
    // Unknown / unexpected error — log full details server-side, never expose raw error messages to the client.
    this.logger.error("Unhandled signup error", error instanceof Error ? error.stack : String(error));
    throw new InternalServerErrorException({ error: "SIGNUP_INTERNAL_ERROR" });
  }
}
