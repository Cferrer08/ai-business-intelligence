import { describe, expect, it } from "vitest";
import { checkUpload, datasetNameFromFilename, MAX_UPLOAD_BYTES } from "@/lib/datasets/rules";
import { formatPct } from "@/lib/format";

describe("upload rules", () => {
  it("accepts supported formats regardless of case", () => {
    for (const name of ["a.csv", "B.XLSX", "c.json", "d.jsonl", "e.parquet"]) expect(checkUpload({ name, size: 10 })).toBeNull();
  });
  it("explains what to do with old Excel files", () => {
    expect(checkUpload({ name: "old.xls", size: 10 })).toMatch(/save it as \.xlsx/);
  });
  it("rejects other types, empty and oversized files", () => {
    expect(checkUpload({ name: "report.pdf", size: 10 })).toMatch(/CSV, Excel/);
    expect(checkUpload({ name: "a.csv", size: 0 })).toBe("The file is empty.");
    expect(checkUpload({ name: "a.csv", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/larger than/);
  });
  it("derives a readable dataset name", () => {
    expect(datasetNameFromFilename("Q3_sales__2026-final.csv")).toBe("Q3 sales 2026-final");
    expect(datasetNameFromFilename(".csv")).toBe("Untitled dataset");
  });
});

describe("formatting", () => {
  it("shows tiny percentages honestly", () => {
    expect(formatPct(0.04)).toBe("<0.1%");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(12.5)).toBe("12.5%");
  });
});
