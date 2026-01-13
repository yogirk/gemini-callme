#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import ngrok from '@ngrok/ngrok';

import { createProviders, initializeProviders } from './providers/index.js';
import { CallManager } from './call-manager.js';

async function main() {
    const PORT = parseInt(process.env.CALLME_PORT || '3333', 10);

    // Clean up any lingering ngrok sessions from previous runs
    try {
        await ngrok.disconnect();
    } catch (_) { }

    // Graceful shutdown handler
    let ngrokListener: any = null;
    let httpServer: http.Server | null = null;

    const cleanup = async () => {
        if (ngrokListener) {
            try {
                await ngrokListener.close();
            } catch (_) { }
        }
        try {
            await ngrok.disconnect();
        } catch (_) { }
        if (httpServer) {
            httpServer.close();
        }
        process.exit(0);
    };

    // Handle all termination signals
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGHUP', cleanup);
    process.on('uncaughtException', cleanup);
    process.on('unhandledRejection', cleanup);

    // Setup Providers
    const providers = createProviders();
    initializeProviders(providers);

    // Start Ngrok tunnel
    let publicUrl = '';
    try {
        ngrokListener = await ngrok.forward({
            addr: PORT,
            authtoken: process.env.CALLME_NGROK_AUTHTOKEN
        });
        publicUrl = ngrokListener.url() || '';
    } catch (e) {
        console.error('Failed to start ngrok:', e);
        process.exit(1);
    }

    // Setup CallManager
    const callManager = new CallManager(
        providers,
        publicUrl,
        process.env.CALLME_USER_PHONE_NUMBER || '',
        process.env.CALLME_PHONE_NUMBER || ''
    );

    // HTTP Server for Vapi webhooks
    httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (req.method === 'POST' && url.pathname === '/webhooks/vapi') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk);
            const bodyStr = Buffer.concat(chunks).toString();

            let parsedBody: any = {};
            try {
                parsedBody = JSON.parse(bodyStr || '{}');
            } catch (_) { }

            await callManager.handleWebhook(parsedBody, res);
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        }
    });

    httpServer.listen(PORT);

    // MCP Server
    const mcpServer = new Server(
        { name: 'gemini-call-me', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'initiate_call',
                description: 'Start a phone call to the user. Returns the call ID and waits for the user to respond.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', description: 'Initial message to speak to the user.' },
                    },
                    required: ['message'],
                },
            },
            {
                name: 'continue_call',
                description: 'Send a response to the user and wait for their next message.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        call_id: { type: 'string', description: 'The call ID from initiate_call.' },
                        message: { type: 'string', description: 'Your response to speak to the user.' },
                    },
                    required: ['call_id', 'message'],
                },
            },
            {
                name: 'end_call',
                description: 'End the phone call with a final message.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        call_id: { type: 'string', description: 'The call ID.' },
                        message: { type: 'string', description: 'Final goodbye message.' },
                    },
                    required: ['call_id', 'message'],
                },
            },
        ],
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
            const name = request.params.name;
            const args = request.params.arguments as any;

            if (name === 'initiate_call') {
                const result = await callManager.initiateCall(args.message);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } else if (name === 'continue_call') {
                const response = await callManager.continueCall(args.call_id, args.message);
                return { content: [{ type: 'text', text: response }] };
            } else if (name === 'end_call') {
                await callManager.endCall(args.call_id, args.message);
                return { content: [{ type: 'text', text: 'Call ended.' }] };
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
}

main().catch(console.error);
