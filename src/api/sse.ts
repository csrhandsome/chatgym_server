import type { AgentConsoleEvent } from '../agent/shared/types';

const encoder = new TextEncoder();

const serializeSseEvent = (event: AgentConsoleEvent) =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

export const createAgentSseResponse = ({
  onStart,
  onError,
}: {
  onStart: (emit: (event: AgentConsoleEvent) => void) => Promise<void>;
  onError?: (error: unknown) => AgentConsoleEvent;
}) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        const emit = (event: AgentConsoleEvent) => {
          controller.enqueue(serializeSseEvent(event));
        };

        controller.enqueue(encoder.encode(': connected\n\n'));

        try {
          await onStart(emit);
        } catch (error) {
          if (onError) {
            emit(onError(error));
          }
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  );
