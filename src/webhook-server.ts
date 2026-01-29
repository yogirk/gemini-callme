import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { URL } from 'url';

export interface WebhookServerConfig {
  port: number;
}

export interface WebhookEvent {
  provider: 'twilio' | 'telnyx';
  type: string;
  callId?: string;
  data: Record<string, unknown>;
  rawBody: string;
  headers: Record<string, string>;
}

export class WebhookServer extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private config: WebhookServerConfig;
  private wsConnections: Map<string, WebSocket> = new Map();

  constructor(config: WebhookServerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws, req) => this.handleWebSocket(ws, req));

      this.server.listen(this.config.port, () => {
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const path = url.pathname;

    // Collect body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString();

    // Extract headers
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key.toLowerCase()] = value;
      }
    }

    // Route based on path
    if (path.startsWith('/twilio')) {
      await this.handleTwilioWebhook(path, rawBody, headers, res);
    } else if (path.startsWith('/telnyx')) {
      await this.handleTelnyxWebhook(path, rawBody, headers, res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  private async handleTwilioWebhook(
    path: string,
    rawBody: string,
    headers: Record<string, string>,
    res: ServerResponse
  ): Promise<void> {
    // Parse form-encoded body
    const params = new URLSearchParams(rawBody);
    const data: Record<string, unknown> = {};
    for (const [key, value] of params) {
      data[key] = value;
    }

    const event: WebhookEvent = {
      provider: 'twilio',
      type: path.replace('/twilio/', ''),
      callId: data['CallSid'] as string,
      data,
      rawBody,
      headers,
    };

    // Emit event for call manager to handle
    this.emit('webhook', event, res);
  }

  private async handleTelnyxWebhook(
    path: string,
    rawBody: string,
    headers: Record<string, string>,
    res: ServerResponse
  ): Promise<void> {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawBody);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    const eventData = (data.data as Record<string, unknown>) || data;
    const eventType = (eventData.event_type as string) || 'unknown';

    const event: WebhookEvent = {
      provider: 'telnyx',
      type: eventType,
      callId: (eventData.payload as Record<string, unknown>)?.call_control_id as string,
      data: eventData,
      rawBody,
      headers,
    };

    // Respond immediately for Telnyx
    res.writeHead(200);
    res.end('OK');

    this.emit('webhook', event);
  }

  private handleWebSocket(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    // Store connection by token
    this.wsConnections.set(token, ws);
    this.emit('ws:connect', token, ws);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.emit('ws:message', token, message);
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('close', () => {
      this.wsConnections.delete(token);
      this.emit('ws:disconnect', token);
    });

    ws.on('error', (err) => {
      this.emit('ws:error', token, err);
    });
  }

  getWebSocket(token: string): WebSocket | undefined {
    return this.wsConnections.get(token);
  }

  sendToWebSocket(token: string, data: unknown): boolean {
    const ws = this.wsConnections.get(token);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const ws of this.wsConnections.values()) {
      ws.close();
    }
    this.wsConnections.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }
}
