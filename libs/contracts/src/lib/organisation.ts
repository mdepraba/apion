import { z } from 'zod';
import {
  emailSchema,
  isoTimestampSchema,
  slugSchema,
  uuidSchema,
} from './primitives.js';

export const organisationSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(120),
  createdAt: isoTimestampSchema,
});
export type Organisation = z.infer<typeof organisationSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  organisationId: uuidSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(120),
  createdAt: isoTimestampSchema,
});
export type User = z.infer<typeof userSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().min(1).max(120),
  /**
   * The floor is NIST SP 800-63B's 8 characters; the ceiling keeps a long
   * paste from turning into an argon2 denial of service.
   */
  password: z.string().min(8).max(200),
  organisationName: z.string().min(1).max(120),
  organisationSlug: slugSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const sessionSchema = z.object({
  accessToken: z.string(),
  expiresAt: isoTimestampSchema,
  user: userSchema,
});
export type Session = z.infer<typeof sessionSchema>;
