import { InvalidMoneyError, MAX_MONEY_MICROS, ceilDiv, microsToString, parseMicros, parsePositiveMicros } from "./intelligence-money";

describe("intelligence money (bigint micros, decimal-string boundary)", () => {
  it("round-trips a value above 2^31 exactly, up to the ceiling", () => {
    expect(parseMicros("m", 2_147_483_648)).toBe(2_147_483_648n);
    expect(parseMicros("m", "2147483648")).toBe(2_147_483_648n);
    expect(microsToString(parseMicros("m", MAX_MONEY_MICROS.toString()))).toBe("1000000000000");
    expect(parseMicros("m", "999999999999")).toBe(999_999_999_999n);
    expect(() => parseMicros("m", "900719925474099100")).toThrow(InvalidMoneyError);
  });

  it("accepts bigint, digit strings and safe non-negative integers, and nothing else", () => {
    expect(parseMicros("m", 12n)).toBe(12n);
    expect(parseMicros("m", "12500")).toBe(12_500n);
    expect(parseMicros("m", 0)).toBe(0n);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "-1", "1.5", "1e3", " 12", "12 ", "0x10", "", null, undefined, {}, [], true]) {
      expect(() => parseMicros("m", bad)).toThrow(InvalidMoneyError);
    }
    expect(() => parseMicros("m", -1n)).toThrow(InvalidMoneyError);
  });

  it("rejects a value beyond the sanity ceiling, which catches dollars-versus-micros unit errors", () => {
    expect(() => parseMicros("m", MAX_MONEY_MICROS + 1n)).toThrow("sanity ceiling");
  });

  it("requires a positive value where a cost must exist", () => {
    expect(parsePositiveMicros("m", 1)).toBe(1n);
    expect(() => parsePositiveMicros("m", 0)).toThrow("greater than zero");
  });

  it("serialises to a decimal string that JSON.stringify can carry, while a raw bigint cannot", () => {
    const value = 2_147_483_648n;
    expect(() => JSON.stringify({ value })).toThrow(TypeError);
    expect(JSON.stringify({ value: microsToString(value) })).toBe('{"value":"2147483648"}');
    expect(typeof (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON).toBe("undefined");
  });

  it("divides with ceiling and refuses unsafe operands", () => {
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(ceilDiv(9n, 3n)).toBe(3n);
    expect(ceilDiv(0n, 7n)).toBe(0n);
    expect(() => ceilDiv(1n, 0n)).toThrow(InvalidMoneyError);
    expect(() => ceilDiv(-1n, 2n)).toThrow(InvalidMoneyError);
  });
});
