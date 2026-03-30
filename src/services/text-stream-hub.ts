export interface StreamSocket {
  send(data: string): unknown;
}

export interface StreamHubSummary {
  activeConnections: number;
}

export class TextStreamHub {
  private readonly clients = new Map<string, StreamSocket>();

  connect(socket: StreamSocket): string {
    const clientId = crypto.randomUUID();

    this.clients.set(clientId, socket);

    return clientId;
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
  }

  sendTo(clientId: string, event: Record<string, unknown>): void {
    const socket = this.clients.get(clientId);

    if (!socket) {
      return;
    }

    socket.send(JSON.stringify(event));
  }

  broadcast(event: Record<string, unknown>): void {
    const payload = JSON.stringify(event);

    for (const socket of this.clients.values()) {
      socket.send(payload);
    }
  }

  getSummary(): StreamHubSummary {
    return {
      activeConnections: this.clients.size,
    };
  }
}
