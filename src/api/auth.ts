import { Elysia } from 'elysia';
import { createAuthContext, accessTokenExpiresIn, resolveAuthenticatedUser } from '../plugins/auth';
import type { ServerRuntime } from '../runtime';
import { toPublicUser } from '../services/user-store';
import {
  authErrorSchema,
  credentialsSchema,
  loginSuccessSchema,
  meResponseSchema,
  registerSuccessSchema,
} from '../types/auth';

const invalidCredentialsMessage = 'invalid username or password';

const issueAccessToken = async (
  jwt: {
    sign(payload: {
      sub: string;
      username: string;
      exp: string;
      iat: boolean;
    }): Promise<string>;
  },
  user: { id: string; username: string },
) =>
  jwt.sign({
    sub: user.id,
    username: user.username,
    exp: accessTokenExpiresIn,
    iat: true,
  });

export const createAuthApi = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/api/auth' })
    .use(createAuthContext(runtime))
    .post(
      '/register',
      async ({ body, jwt, set }) => {
        const username = body.username.trim();

        if (runtime.userStore.findByUsername(username)) {
          set.status = 409;

          return {
            message: 'username already exists',
          };
        }

        const passwordHash = await Bun.password.hash(body.password);
        const user = runtime.userStore.create({
          username,
          passwordHash,
        });

        if (!user) {
          set.status = 409;

          return {
            message: 'username already exists',
          };
        }

        const token = await issueAccessToken(jwt, user);
        set.status = 201;

        return {
          status: 'registered' as const,
          tokenType: 'Bearer' as const,
          token,
          user: toPublicUser(user),
        };
      },
      {
        detail: {
          summary: 'Register a new user and issue a JWT access token',
          tags: ['auth'],
        },
        body: credentialsSchema,
        response: {
          201: registerSuccessSchema,
          409: authErrorSchema,
        },
      },
    )
    .post(
      '/login',
      async ({ body, jwt, set }) => {
        const user = runtime.userStore.findByUsername(body.username);

        if (!user) {
          set.status = 401;

          return {
            message: invalidCredentialsMessage,
          };
        }

        const isPasswordValid = await Bun.password.verify(body.password, user.passwordHash);

        if (!isPasswordValid) {
          set.status = 401;

          return {
            message: invalidCredentialsMessage,
          };
        }

        const signedInUser = runtime.userStore.markLogin(user.id) ?? user;
        const token = await issueAccessToken(jwt, signedInUser);

        return {
          status: 'authenticated' as const,
          tokenType: 'Bearer' as const,
          token,
          user: toPublicUser(signedInUser),
        };
      },
      {
        detail: {
          summary: 'Verify user credentials and issue a JWT access token',
          tags: ['auth'],
        },
        body: credentialsSchema,
        response: {
          200: loginSuccessSchema,
          401: authErrorSchema,
        },
      },
    )
    .get(
      '/me',
      async ({ headers, jwt, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        return {
          user: currentUser,
        };
      },
      {
        detail: {
          summary: 'Read the authenticated user profile from a Bearer token',
          tags: ['auth'],
        },
        response: {
          200: meResponseSchema,
          401: authErrorSchema,
        },
      },
    );
