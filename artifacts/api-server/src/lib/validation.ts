import { HttpError } from "./errors";

type ValidationIssue = { path: (string | number)[]; message: string };
type ParseSchema<T> = {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: ValidationIssue[] } };
};

export function validate<T>(schema: ParseSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      "Check the highlighted fields and try again.",
      "VALIDATION_ERROR",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
