import { Elysia } from 'elysia';
import type { ServerRuntime } from '../runtime';
import { buildRuntimeSnapshot } from '../runtime';

type IncomingWsAction =
  | { type: 'ping' }
  | { type: 'invalid'; message: string };

const socketIds = new WeakMap<object, string>();
const textDecoder = new TextDecoder();

const createStatsEvent = (runtime: ServerRuntime) => ({
  type: 'server:stats',
  timestamp: new Date().toISOString(),
  ...buildRuntimeSnapshot(runtime),
});

const decodeWsMessage = (message: unknown) => {
  if (typeof message === 'string') {
    return message;
  }

  if (message instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(message));
  }

  if (ArrayBuffer.isView(message)) {
    return textDecoder.decode(
      new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    );
  }

  return '';
};

const parseWsAction = (message: unknown): IncomingWsAction => {
  const raw = decodeWsMessage(message).trim();

  if (!raw) {
    return {
      type: 'invalid',
      message: 'message cannot be empty',
    };
  }

  try {
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && 'type' in parsed && parsed.type === 'ping') {
      return { type: 'ping' };
    }

    return {
      type: 'invalid',
      message: 'websocket is read-only; use POST /api/text with a Bearer token',
    };
  } catch {
    if (raw.toLowerCase() === 'ping') {
      return { type: 'ping' };
    }

    return {
      type: 'invalid',
      message: 'websocket is read-only; use POST /api/text with a Bearer token',
    };
  }
};

export const createTextWs = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/ws' }).ws('/text', {
    open(ws) {
      const clientId = runtime.textStreamHub.connect(ws);

      socketIds.set(ws, clientId);

      runtime.textStreamHub.sendTo(clientId, {
        type: 'connection:ack',
        clientId,
        timestamp: new Date().toISOString(),
        message: 'connected to text stream',
        ...buildRuntimeSnapshot(runtime),
      });

      runtime.textStreamHub.broadcast(createStatsEvent(runtime));
    },
    message(ws, message) {
      const action = parseWsAction(message);
      const clientId = socketIds.get(ws) ?? 'unknown';

      if (action.type === 'ping') {
        runtime.textStreamHub.sendTo(clientId, {
          type: 'pong',
          timestamp: new Date().toISOString(),
        });

        return;
      }

      if (action.type === 'invalid') {
        runtime.textStreamHub.sendTo(clientId, {
          type: 'error',
          timestamp: new Date().toISOString(),
          message: action.message,
        });

        return;
      }
    },
    close(ws) {
      const clientId = socketIds.get(ws);

      if (!clientId) {
        return;
      }

      runtime.textStreamHub.disconnect(clientId);
      socketIds.delete(ws);
      runtime.textStreamHub.broadcast(createStatsEvent(runtime));
    },
  });
