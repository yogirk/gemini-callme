#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import ngrok from '@ngrok/ngrok';

import { createProviders, initializeProviders } from './providers/index.js';
import { CallManager } from './call-manager.js';
import { validateWebSocketToken } from './utils/security.js';

async function main() {
    const PORT = parseInt(process.env.CALLME_PORT || '3333', 10);

    // 1. Setup Providers
    const providers = createProviders();
    try {
        initializeProviders(providers);
    } catch (e) {
        console.error('Failed to initialize providers:', e);
        process.exit(1);
    }

    // 2. Start Ngrok
    let publicUrl = '';
    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken: process.env.CALLME_NGROK_AUTHTOKEN
        });
        publicUrl = listener.url() || '';
        console.error(`Ngrok tunnel established: ${publicUrl}`);
    } catch (e) {
        console.error('Failed to start ngrok:', e);
        process.exit(1);
    }

    // 3. Setup CallManager
    const callManager = new CallManager(
        providers,
        publicUrl,
        process.env.CALLME_USER_PHONE_NUMBER || '',
        process.env.CALLME_PHONE_NUMBER || ''
    );

    // 4. HTTP & WebSocket Server
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (req.method === 'POST' && url.pathname === '/webhooks/voice') {
            // Collect body
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const bodyStr = Buffer.concat(chunks).toString();

            let parsedBody = {};
            if (req.headers['content-type']?.includes('application/json')) {
                parsedBody = JSON.parse(bodyStr || '{}');
            } else if (req.headers['content-type']?.includes('urlencoded')) {
                const params = new URLSearchParams(bodyStr);
                parsedBody = Object.fromEntries(params.entries());
            }

            await callManager.handleWebhook(parsedBody, res);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname === '/media-stream') {
            const token = url.searchParams.get('token');
            // Lookup call ID by token
            // Since we can't easily iterate all calls to verify token efficiently without a map,
            // CallManager exposes the map or we ask it.
            // callManager.wsTokenToCallId is public.

            const callId = token ? callManager.wsTokenToCallId.get(token) : null;

            if (!callId) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(req, socket, head, (ws) => {
                callManager.handleMediaConnection(ws, callId);
            });
        } else {
            socket.destroy();
        }
    });

    server.listen(PORT, () => {
        console.error(`Server listening on port ${PORT}`);
    });

    // 5. MCP Server
    const mcpServer = new Server(
        { name: 'gemini-call-me', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'initiate_call',
                    description: 'Start a phone call to the user.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            message: { type: 'string', description: 'Initial message to speak.' },
                        },
                        required: ['message'],
                    },
                },
                {
                    name: 'continue_call',
                    description: 'Continue the conversation.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            call_id: { type: 'string' },
                            message: { type: 'string' },
                        },
                        required: ['call_id', 'message'],
                    },
                },
                {
                    name: 'speak_to_user',
                    description: 'Speak without waiting for response.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            call_id: { type: 'string' },
                            message: { type: 'string' },
                        },
                        required: ['call_id', 'message'],
                    },
                },
                {
                    name: 'end_call',
                    description: 'End the call.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            call_id: { type: 'string' },
                            message: { type: 'string' },
                        },
                        required: ['call_id', 'message'],
                    },
                },
            ],
        };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
            const name = request.params.name;
            const args = request.params.arguments as any;

            if (name === 'initiate_call') {
                const result = await callManager.initiateCall(args.message);
                return {
                    content: [{ type: 'text', text: JSON.stringify(result) }]
                };
            } else if (name === 'continue_call') {
                const response = await callManager.continueCall(args.call_id, args.message);
                return {
                    content: [{ type: 'text', text: response }]
                };
            } else if (name === 'speak_to_user') {
                await callManager.speakOnly(args.call_id, args.message);
                return { content: [{ type: 'text', text: 'Spoken.' }] };
            } else if (name === 'end_call') {
                const duration = await callManager.endCall(args.call_id, args.message);
                return { content: [{ type: 'text', text: `Call ended. Duration: ${duration}s` }] };
            }

            throw new Error('Unknown tool');
        } catch (e: any) {
            return {
                content: [{ type: 'text', text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error('Gemini Call Me MCP Server running...');
}

main().catch(console.error);
