import { jwt } from '@elysiajs/jwt';
import { Elysia } from 'elysia';
import type { ServerRuntime } from '../runtime';
import { toPublicUser } from '../services/user-store';
import { jwtPayloadSchema, type JwtPayload, type PublicUser } from '../types/auth';

const defaultJwtSecret = 'chatgym-local-dev-secret-change-me';

export const accessTokenExpiresIn = Bun.env.JWT_EXPIRES_IN ?? '7d';

export const extractBearerToken = (authorization?: string) => {
  if (!authorization) {
    return null;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token || extra) {
    return null;
  }

  return token;
};

export const createAuthContext = (runtime: ServerRuntime) =>
  new Elysia({ name: 'auth-context' })
    .use(
      jwt({
        name: 'jwt',
        secret: Bun.env.JWT_SECRET ?? defaultJwtSecret,
        schema: jwtPayloadSchema,
      }),
    );

export const resolveAuthenticatedUser = async (
  runtime: ServerRuntime,
  authorization: string | undefined,
  jwt: {
    verify(token?: string): Promise<JwtPayload | false>;
  },
): Promise<PublicUser | null> => {
  const authToken = extractBearerToken(authorization);

  if (!authToken) {
    return null;
  }

  const jwtPayload = await jwt.verify(authToken);

  if (!jwtPayload || typeof jwtPayload.sub !== 'string') {
    return null;
  }

  const user = runtime.userStore.getById(jwtPayload.sub);

  return user ? toPublicUser(user) : null;
};
