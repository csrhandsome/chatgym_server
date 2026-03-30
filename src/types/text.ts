import type { Static } from '@sinclair/typebox';
import { t } from 'elysia';

export const textMetadataSchema = t.Optional(t.Record(t.String(), t.Unknown()));

export const submitTextSchema = t.Object({
  text: t.String({ minLength: 1, maxLength: 10000 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  metadata: textMetadataSchema,
});

export const textRecordSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  text: t.String(),
  source: t.String(),
  userId: t.Optional(t.String({ format: 'uuid' })),
  username: t.Optional(t.String()),
  sessionId: t.Optional(t.String()),
  metadata: textMetadataSchema,
  receivedAt: t.String({ format: 'date-time' }),
  length: t.Number({ minimum: 0 }),
});

export const textStoreSummarySchema = t.Object({
  totalReceived: t.Number({ minimum: 0 }),
  storedCount: t.Number({ minimum: 0 }),
  latestRecordId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  latestReceivedAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
});

export type SubmitTextInput = Static<typeof submitTextSchema>;
export type TextRecord = Static<typeof textRecordSchema>;
export type TextStoreSummary = Static<typeof textStoreSummarySchema>;
