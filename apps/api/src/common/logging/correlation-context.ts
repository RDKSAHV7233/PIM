import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  correlationId: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelationContext<T>(context: CorrelationContext, fn: () => T): T {
  return correlationStorage.run(context, fn);
}

export function getCorrelationContext(): CorrelationContext | null {
  return correlationStorage.getStore() ?? null;
}
