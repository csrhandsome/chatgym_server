import type { SubmitTextInput, TextRecord, TextStoreSummary } from '../types/text';

const DEFAULT_RETENTION = 200;

const cloneMetadata = (metadata?: Record<string, unknown>) =>
  metadata ? structuredClone(metadata) : undefined;

interface AddTextInput extends SubmitTextInput {
  source: string;
  userId?: string;
  username?: string;
}

export class TextStore {
  private readonly records: TextRecord[] = [];
  private totalReceived = 0;

  constructor(private readonly retention = DEFAULT_RETENTION) {}

  add(input: AddTextInput): TextRecord {
    const record: TextRecord = {
      id: crypto.randomUUID(),
      text: input.text,
      source: input.source,
      userId: input.userId,
      username: input.username,
      sessionId: input.sessionId,
      metadata: cloneMetadata(input.metadata),
      receivedAt: new Date().toISOString(),
      length: input.text.length,
    };

    this.records.push(record);
    this.totalReceived += 1;

    if (this.records.length > this.retention) {
      this.records.splice(0, this.records.length - this.retention);
    }

    return { ...record, metadata: cloneMetadata(record.metadata) };
  }

  listRecent(limit = 50): TextRecord[] {
    return this.records
      .slice(-limit)
      .reverse()
      .map((record) => ({ ...record, metadata: cloneMetadata(record.metadata) }));
  }

  listRecentForUser(userId: string, limit = 50): TextRecord[] {
    return this.records
      .filter((record) => record.userId === userId)
      .slice(-limit)
      .reverse()
      .map((record) => ({ ...record, metadata: cloneMetadata(record.metadata) }));
  }

  getById(id: string): TextRecord | undefined {
    const record = this.records.find((item) => item.id === id);

    if (!record) {
      return undefined;
    }

    return { ...record, metadata: cloneMetadata(record.metadata) };
  }

  getByIdForUser(id: string, userId: string): TextRecord | undefined {
    const record = this.records.find((item) => item.id === id && item.userId === userId);

    if (!record) {
      return undefined;
    }

    return { ...record, metadata: cloneMetadata(record.metadata) };
  }

  getSummary(): TextStoreSummary {
    const latestRecord = this.records.at(-1);

    return {
      totalReceived: this.totalReceived,
      storedCount: this.records.length,
      latestRecordId: latestRecord?.id ?? null,
      latestReceivedAt: latestRecord?.receivedAt ?? null,
    };
  }
}
