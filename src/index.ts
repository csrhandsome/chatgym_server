import { createApp } from './app';

const fallbackPort = 3000;
const requestedPort = Bun.env.PORT ?? String(fallbackPort);
const port = Number.parseInt(requestedPort, 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${requestedPort}`);
}

export const app = createApp().listen(port);

export const server = app.server;

if (!server) {
  throw new Error('Failed to start Elysia server');
}

console.log(`[chatgym_server] listening on ${server.url.href}`);
console.log(`[chatgym_server] websocket available at ws://${server.hostname}:${server.port}/ws/text`);
