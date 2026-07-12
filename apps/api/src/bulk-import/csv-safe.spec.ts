import { safeCsvCell } from "./csv-safe";

describe("safeCsvCell — CSV injection protection", () => {
  it("neutralizes =HYPERLINK(...) formula", () => {
    const result = safeCsvCell('=HYPERLINK("http://evil.com","Click")');
    expect(result).toBe(`"'=HYPERLINK(""http://evil.com"",""Click"")"`);
    expect(result).not.toMatch(/^"=/);
  });

  it("neutralizes +SUM(...) formula", () => {
    const result = safeCsvCell("+SUM(A1:A10)");
    expect(result).toBe("\"'+SUM(A1:A10)\"");
  });

  it("neutralizes -10+20 formula-risk prefix", () => {
    const result = safeCsvCell("-10+20");
    expect(result).toBe("\"'-10+20\"");
  });

  it("neutralizes @cmd injection", () => {
    const result = safeCsvCell("@cmd|' /C calc'!A0");
    expect(result).toBe("\"'@cmd|' /C calc'!A0\"");
  });

  it("neutralizes tab-prefixed formula", () => {
    const result = safeCsvCell("\t=1+1");
    expect(result).toBe("\"'\t=1+1\"");
  });

  it("neutralizes carriage-return-prefixed formula", () => {
    const result = safeCsvCell("\r=1+1");
    expect(result).toBe("\"'\r=1+1\"");
  });

  it("leaves normal text unchanged", () => {
    expect(safeCsvCell("Classic Cotton Tee")).toBe('"Classic Cotton Tee"');
  });

  it("leaves empty string unchanged", () => {
    expect(safeCsvCell("")).toBe('""');
  });

  it("preserves valid CSV quoting for commas", () => {
    expect(safeCsvCell("hello, world")).toBe('"hello, world"');
  });

  it("preserves valid CSV quoting for embedded quotes", () => {
    expect(safeCsvCell('say "hello"')).toBe('"say ""hello"""');
  });

  it("preserves valid CSV quoting for newlines", () => {
    expect(safeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("handles numeric strings starting with minus as formula-risk", () => {
    const result = safeCsvCell("-500");
    expect(result).toBe("\"'-500\"");
  });

  it("handles null-ish input gracefully", () => {
    expect(safeCsvCell(null as unknown as string)).toBe('""');
    expect(safeCsvCell(undefined as unknown as string)).toBe('""');
  });
});
