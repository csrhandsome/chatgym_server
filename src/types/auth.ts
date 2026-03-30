import type { Static } from '@sinclair/typebox';
import { t } from 'elysia';

export const usernameSchema = t.String({
  minLength: 3,
  maxLength: 32,
  pattern: '^[a-zA-Z0-9_-]+$',
});

export const passwordSchema = t.String({
  minLength: 8,
  maxLength: 72,
});

export const credentialsSchema = t.Object({
  username: usernameSchema,
  password: passwordSchema,
});

export const publicUserSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  username: usernameSchema,
  createdAt: t.String({ format: 'date-time' }),
  lastLoginAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
});

export const userStoreSummarySchema = t.Object({
  usersCount: t.Number({ minimum: 0 }),
});

export const jwtPayloadSchema = t.Object({
  sub: t.String({ format: 'uuid' }),
  username: usernameSchema,
});

export const authErrorSchema = t.Object({
  message: t.String(),
});

export const registerSuccessSchema = t.Object({
  status: t.Literal('registered'),
  tokenType: t.Literal('Bearer'),
  token: t.String(),
  user: publicUserSchema,
});

export const loginSuccessSchema = t.Object({
  status: t.Literal('authenticated'),
  tokenType: t.Literal('Bearer'),
  token: t.String(),
  user: publicUserSchema,
});

export const meResponseSchema = t.Object({
  user: publicUserSchema,
});

export type CredentialsInput = Static<typeof credentialsSchema>;
export type PublicUser = Static<typeof publicUserSchema>;
export type JwtPayload = Static<typeof jwtPayloadSchema>;
