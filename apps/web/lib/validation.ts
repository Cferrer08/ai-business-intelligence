import { z } from "zod";

export const emailSchema = z
  .string({ required_error: "Enter your email." })
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string({ required_error: "Enter a password." })
  .min(10, "Use at least 10 characters.")
  .max(64, "Use 64 characters or fewer.");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120, "Name is too long."),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(64),
});

export const workspaceNameSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80, "Use 80 characters or fewer."),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
