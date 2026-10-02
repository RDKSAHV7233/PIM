import { Logger } from "@nestjs/common";

type RejectionEmitter = Pick<NodeJS.Process, "on">;
type ExitFn = Pick<NodeJS.Process, "exit">;

const logger = new Logger("ProcessGuards");
const guarded = new WeakSet<object>();

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    const code = (reason as { code?: unknown }).code;
    const prefix = typeof code === "string" && code ? `[${code}] ` : "";
    return { message: `${prefix}${reason.name}: ${reason.message}`, stack: reason.stack };
  }
  return { message: String(reason) };
}

/**
 * Last-resort safety net: log promise rejections that nothing handled instead of letting
 * Node (>= 15) terminate the API process. A single transient DB error in a fire-and-forget
 * background task (e.g. Prisma P2024 pool timeout in a scheduled recovery job) must not take
 * down request handling for every tenant. Scheduled jobs should still catch their own errors;
 * this only prevents a missed one from becoming an outage. `uncaughtException` is deliberately
 * left to Node's default (process exit), because state may be corrupt after a thrown exception.
 * Idempotent: registering twice on the same emitter does not duplicate the listener.
 */
export function registerProcessGuards(proc: RejectionEmitter = process): void {
  if (guarded.has(proc)) {
    return;
  }
  guarded.add(proc);
  proc.on("unhandledRejection", (reason: unknown) => {
    const { message, stack } = describe(reason);
    logger.error(`Unhandled promise rejection (process kept alive): ${message}`, stack);
  });
}

/**
 * Boot failures must still be fatal. With the unhandled-rejection guard above, a rejected
 * `bootstrap()` (bad env, port in use, DB init failure) would otherwise be logged and ignored,
 * leaving a half-started process or an exit code of 0. Log and exit 1 so the orchestrator
 * restarts it.
 */
export function runAndExitOnFailure(start: () => Promise<void>, proc: ExitFn = process): void {
  start().catch((error: unknown) => {
    const { message, stack } = describe(error);
    logger.error(`API failed to start: ${message}`, stack);
    proc.exit(1);
  });
}
