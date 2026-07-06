import { z } from "zod";
import type { AuthSchema } from "@cyflow/shared";

/**
 * Build a Zod schema that validates a Connection's credential fields from its
 * app's AuthSchema. Required fields must be non-empty strings; optional ones may
 * be omitted. Unknown fields pass through (e.g. an injected `type` discriminator).
 */
export function credentialsSchema(auth: AuthSchema): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of auth.fields ?? []) {
    shape[field.key] =
      field.required === false ? z.string().optional() : z.string().min(1, `${field.key} is required`);
  }
  return z.object(shape).passthrough();
}

/** Validate credentials against an app's AuthSchema. */
export function validateCredentials(auth: AuthSchema, credentials: unknown) {
  return credentialsSchema(auth).safeParse(credentials);
}
