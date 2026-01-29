#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { CallManager } from './call-manager.js';

const TOOLS = [
  {
    name: 'initiate_call',
    description: 'Start a phone call to the user with an initial message. Returns the call ID and the user\'s spoken response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The message to speak when the user answers',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'continue_call',
    description: 'Continue an active phone call by speaking a message and waiting for the user\'s response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        callId: {
          type: 'string',
          description: 'The ID of the active call',
        },
        message: {
          type: 'string',
          description: 'The message to speak to the user',
        },
      },
      required: ['callId', 'message'],
    },
  },
  {
    name: 'speak_to_user',
    description: 'Speak a message to the user without waiting for a response. Use this for status updates before long operations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        callId: {
          type: 'string',
          description: 'The ID of the active call',
        },
        message: {
          type: 'string',
          description: 'The message to speak to the user',
        },
      },
      required: ['callId', 'message'],
    },
  },
  {
    name: 'end_call',
    description: 'End an active phone call with an optional closing message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        callId: {
          type: 'string',
          description: 'The ID of the active call',
        },
        message: {
          type: 'string',
          description: 'Optional closing message to speak before ending the call',
        },
      },
      required: ['callId'],
    },
  },
];

async function main() {
  // Load configuration
  const config = loadConfig();

  // Create call manager
  const callManager = new CallManager(config);

  // Start services
  await callManager.start();

  // Create MCP server
  const server = new Server(
    {
      name: 'geminicall',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'initiate_call': {
          const message = (args as { message: string }).message;
          const result = await callManager.initiateCall(message);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'continue_call': {
          const { callId, message } = args as { callId: string; message: string };
          const result = await callManager.continueCall(callId, message);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'speak_to_user': {
          const { callId, message } = args as { callId: string; message: string };
          await callManager.speakToUser(callId, message);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true }, null, 2),
              },
            ],
          };
        }

        case 'end_call': {
          const { callId, message } = args as { callId: string; message?: string };
          const result = await callManager.endCall(callId, message);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, duration: result.duration }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // Handle shutdown
  const shutdown = async () => {
    await callManager.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
