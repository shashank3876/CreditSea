import path from "node:path";

export const MAX_SALARY_SLIP_BYTES = 5 * 1024 * 1024;
export type SalarySlipContentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export function expectedSalarySlipContentType(
  fileName: string,
): SalarySlipContentType | null {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  return null;
}

export function validateSalarySlipFile(file: {
  originalName: string;
  contentType: string;
  sizeBytes: number;
  contents: Buffer;
}): { contentType: SalarySlipContentType; fileName: string } {
  if (file.sizeBytes < 1 || file.sizeBytes > MAX_SALARY_SLIP_BYTES) {
    throw new RangeError("The file must be between 1 byte and 5 MB.");
  }

  const expectedType = expectedSalarySlipContentType(file.originalName);
  const detectedType = detectSalarySlipContentType(file.contents);
  if (!expectedType || expectedType !== file.contentType || detectedType !== expectedType) {
    throw new RangeError(
      "The file contents do not match a supported PDF, JPG, or PNG file.",
    );
  }

  const baseName = path.basename(file.originalName.replace(/\\/g, "/"));
  const safeName =
    baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "salary-slip";
  return { contentType: expectedType, fileName: safeName };
}

export function detectSalarySlipContentType(
  buffer: Buffer,
): SalarySlipContentType | null {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return null;
}
