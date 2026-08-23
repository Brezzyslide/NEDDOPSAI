import type { ApiErrorCode } from "@workspace/shared";

/**
 * Base API error — carries a machine-readable code and HTTP status.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthenticationRequired extends ApiError {
  constructor() {
    super("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
  }
}

export class EmailVerificationRequired extends ApiError {
  constructor() {
    super(
      "EMAIL_VERIFICATION_REQUIRED",
      "Your email must be verified before continuing.",
      403,
    );
  }
}

export class UserSuspended extends ApiError {
  constructor() {
    super("USER_SUSPENDED", "Your account has been suspended.", 403);
  }
}

export class TenantNotFound extends ApiError {
  constructor() {
    super("TENANT_NOT_FOUND", "The organisation could not be found.", 404);
  }
}

export class TenantInactive extends ApiError {
  constructor() {
    super(
      "TENANT_INACTIVE",
      "This organisation is not currently active.",
      403,
    );
  }
}

export class MembershipRequired extends ApiError {
  constructor() {
    super(
      "MEMBERSHIP_REQUIRED",
      "You do not belong to this organisation.",
      403,
    );
  }
}

export class MembershipSuspended extends ApiError {
  constructor() {
    super(
      "MEMBERSHIP_SUSPENDED",
      "Your membership in this organisation has been suspended.",
      403,
    );
  }
}

export class PermissionDenied extends ApiError {
  constructor(message = "You do not have permission to perform this action.") {
    super("PERMISSION_DENIED", message, 403);
  }
}

export class ResourceNotFound extends ApiError {
  constructor(resource = "Resource") {
    super("RESOURCE_NOT_FOUND", `${resource} not found.`, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class InvitationExpired extends ApiError {
  constructor() {
    super("INVITATION_EXPIRED", "This invitation has expired.", 410);
  }
}

export class InvitationInvalid extends ApiError {
  constructor() {
    super("INVITATION_INVALID", "This invitation is not valid.", 400);
  }
}

export class InvitationAlreadyUsed extends ApiError {
  constructor() {
    super(
      "INVITATION_ALREADY_USED",
      "This invitation has already been used.",
      409,
    );
  }
}

export class InvitationEmailMismatch extends ApiError {
  constructor() {
    super(
      "INVITATION_EMAIL_MISMATCH",
      "This invitation was sent to a different email address.",
      403,
    );
  }
}

export class DuplicateMembership extends ApiError {
  constructor() {
    super(
      "DUPLICATE_MEMBERSHIP",
      "This user is already a member of the organisation.",
      409,
    );
  }
}

export class OwnerProtection extends ApiError {
  constructor() {
    super(
      "OWNER_PROTECTION",
      "The final active owner cannot be removed or demoted.",
      409,
    );
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 422);
  }
}

/**
 * Express error handler — call as the last app.use() in app.ts (Sprint 2).
 * Returns consistent JSON error responses and suppresses stack traces in prod.
 */
export function apiErrorHandler(
  err: unknown,
  _req: unknown,
  res: { status: (n: number) => { json: (body: unknown) => void } },
  _next: unknown,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof Error) {
    const coded = err as Error & { code?: string; status?: number; statusCode?: number };
    const statusByCode: Record<string, number> = {
      APPROVAL_ACTOR_ROLE_UNVERIFIED: 403,
      EXECUTION_ACCESS_DENIED: 403,
      RESOURCE_NOT_FOUND: 404,
      SPECIALIST_DNA_UNAVAILABLE: 503,
      VALIDATION_ERROR: 422,
    };
    const status = coded.status ?? coded.statusCode ?? (coded.code ? statusByCode[coded.code] : undefined);
    if (coded.code && status) {
      res.status(status).json({
        error: { code: coded.code, message: err.message },
      });
      return;
    }
  }

  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      ...(isDev && err instanceof Error ? { detail: err.message } : {}),
    },
  });
}
