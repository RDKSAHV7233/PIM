import { BadRequestException, type ValidationError } from "@nestjs/common";

/**
 * Stable top-level error CODE for DTO validation failures.
 *
 * Public auth/signup endpoints emit business-rule rejections as `{ "error": "SOME_CODE" }`.
 * class-validator failures used to surface as Nest's default
 * `{ "message": [...], "error": "Bad Request", "statusCode": 400 }`, which the web
 * client's error-code switch could not map. This factory normalizes validation
 * failures onto the same `{ error: CODE, ... }` envelope so a single client-side
 * lookup on `error` is deterministic.
 */
export const VALIDATION_FAILED_CODE = "VALIDATION_FAILED";

export interface ValidationFieldError {
  field: string;
  constraints: string[];
}

export interface ValidationFailedBody {
  error: typeof VALIDATION_FAILED_CODE;
  message: string;
  fields: ValidationFieldError[];
}

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = "",
): ValidationFieldError[] {
  const collected: ValidationFieldError[] = [];
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints) {
      const constraints = Object.values(error.constraints).filter(
        (message): message is string => typeof message === "string" && message.length > 0,
      );
      if (constraints.length > 0) {
        collected.push({ field: path, constraints });
      }
    }
    if (error.children && error.children.length > 0) {
      collected.push(...flattenValidationErrors(error.children, path));
    }
  }
  return collected;
}

/**
 * `exceptionFactory` for the global `ValidationPipe`. Turns class-validator
 * `ValidationError[]` into a `BadRequestException` (HTTP 400, unchanged) whose
 * body is:
 *
 * ```json
 * {
 *   "error": "VALIDATION_FAILED",
 *   "message": "adminEmail must be an email",
 *   "fields": [{ "field": "adminEmail", "constraints": ["adminEmail must be an email"] }]
 * }
 * ```
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fields = flattenValidationErrors(errors);
  const firstConstraint = fields[0]?.constraints[0] ?? "Request validation failed.";
  const body: ValidationFailedBody = {
    error: VALIDATION_FAILED_CODE,
    message: firstConstraint,
    fields,
  };
  return new BadRequestException(body);
}
