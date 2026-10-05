/**
 * Money for the governed AI control plane is integer micros of a currency (USD only in 004b).
 *
 * Inside the service and the database it is a `bigint`. On every serialisation boundary (API
 * response, log field, audit payload, fixture) it is a decimal string. A `number` is accepted only
 * when it is a non-negative safe integer, and is converted to `bigint` immediately. There is
 * deliberately no global `BigInt.prototype.toJSON`: it would hide an unsafe conversion.
 */

/** USD 1,000,000 in micros. Mirrors the database CHECK that catches a dollars-versus-micros unit error. */
export const MAX_MONEY_MICROS = 1_000_000_000_000n;

const DECIMAL_DIGITS = /^[0-9]+$/;

export class InvalidMoneyError extends Error {
  constructor(field: string, reason: string) {
    super(`${field} ${reason}`);
    this.name = "InvalidMoneyError";
  }
}

/** Parses a bigint, a decimal string of digits, or a safe non-negative integer number. Anything else throws. */
export function parseMicros(field: string, value: unknown): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "string") {
    if (!DECIMAL_DIGITS.test(value)) {
      throw new InvalidMoneyError(field, "must be a string of decimal digits.");
    }
    parsed = BigInt(value);
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidMoneyError(field, "must be a non-negative safe integer when passed as a number.");
    }
    parsed = BigInt(value);
  } else {
    throw new InvalidMoneyError(field, "must be a bigint, a decimal string or a safe integer.");
  }
  if (parsed < 0n) {
    throw new InvalidMoneyError(field, "must not be negative.");
  }
  if (parsed > MAX_MONEY_MICROS) {
    throw new InvalidMoneyError(field, "exceeds the platform sanity ceiling.");
  }
  return parsed;
}

export function parsePositiveMicros(field: string, value: unknown): bigint {
  const parsed = parseMicros(field, value);
  if (parsed <= 0n) {
    throw new InvalidMoneyError(field, "must be greater than zero.");
  }
  return parsed;
}

/** The only supported serialisation: a decimal string. */
export function microsToString(value: bigint): string {
  return value.toString(10);
}

/** Integer division rounding up. Both operands must be non-negative and the divisor positive. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new InvalidMoneyError("ceilDiv", "requires a positive divisor and a non-negative numerator.");
  }
  return (numerator + denominator - 1n) / denominator;
}
