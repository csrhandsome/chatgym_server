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
}) => {
  let closed = false;

  return new Response(
    new ReadableStream({
      start(controller) {
        const emit = (event: AgentConsoleEvent) => {
          if (closed) {
            return;
          }

          try {
            controller.enqueue(serializeSseEvent(event));
          } catch {
            closed = true;
          }
        };

        controller.enqueue(encoder.encode(': connected\n\n'));

        void (async () => {
          try {
            await onStart(emit);
          } catch (error) {
            if (onError) {
              emit(onError(error));
            }
          } finally {
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        closed = true;
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
};
