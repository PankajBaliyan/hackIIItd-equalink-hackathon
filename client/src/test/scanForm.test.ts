import { describe, expect, it } from "vitest";

import { parseScanUrl } from "@/components/scan/ScanForm";

describe("parseScanUrl", () => {
  it("accepts http(s) and adds https to bare domains", () => {
    expect(parseScanUrl("http://a.com/x")).toEqual({ url: "http://a.com/x" });
    expect(parseScanUrl("  shopeasy.dev ")).toEqual({ url: "https://shopeasy.dev/" });
  });
  it("rejects empty, non-http and host-less input", () => {
    for (const bad of ["", "ftp://a.com", "javascript:alert(1)", "https://nodot", "http://"]) {
      expect(parseScanUrl(bad)).toHaveProperty("error");
    }
  });
});
