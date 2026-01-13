# Gemini Call Me

An MCP server extension that gives AI agents the ability to call you on the phone. When your agent needs your attention or a decision, your phone rings and you can have a real-time voice conversation.

## Features

- **Real Phone Calls**: Initiates calls via Vapi (recommended) or Telnyx
- **Two-Way Conversation**: Full conversational loop - the agent speaks, listens, and responds
- **MCP Compatible**: Works with Gemini CLI and other MCP clients
- **Automatic Tunneling**: Uses ngrok to expose webhooks without manual configuration

## Prerequisites

### 1. Vapi Setup (Recommended)

1. Sign up at [vapi.ai](https://vapi.ai)
2. Get your **Private API Key** from the dashboard (not the public key)
3. Get a phone number:
   - Use a Vapi phone number, OR
   - Import an existing number from Twilio/Telnyx for international calling support

### 2. Ngrok Setup

1. Sign up at [ngrok.com](https://ngrok.com) (free tier works)
2. Get your authtoken from the dashboard

### 3. Environment Variables

Copy `.env.template` to `.env` and fill in:

```bash
# Server
CALLME_PORT=3333

# Ngrok
CALLME_NGROK_AUTHTOKEN=your_ngrok_authtoken

# Provider (vapi or telnyx)
CALLME_PHONE_PROVIDER=vapi

# Vapi
CALLME_VAPI_API_KEY=your_private_api_key
CALLME_VAPI_PHONE_NUMBER_ID=your_phone_number_id

# Your phone number to receive calls
CALLME_USER_PHONE_NUMBER=+1234567890
```

## Installation

```bash
# Clone the repository
git clone https://github.com/AshishSinha5/gemini-call-me.git
cd gemini-call-me

# Install dependencies
npm install

# Configure environment
cp .env.template .env
# Edit .env with your credentials

# Build
npm run build
```

## Using with Gemini CLI

Add to your Gemini CLI settings (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "call-me": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-call-me/dist/index.js"],
      "env": {
        "CALLME_PORT": "3333",
        "CALLME_NGROK_AUTHTOKEN": "your_token",
        "CALLME_PHONE_PROVIDER": "vapi",
        "CALLME_VAPI_API_KEY": "your_key",
        "CALLME_VAPI_PHONE_NUMBER_ID": "your_phone_id",
        "CALLME_USER_PHONE_NUMBER": "+1234567890"
      }
    }
  }
}
```

## Available Tools

When connected, your AI agent has access to:

| Tool | Description |
|------|-------------|
| `initiate_call(message)` | Calls your phone and speaks the initial message |
| `continue_call(call_id, message)` | Speaks a follow-up message and waits for your response |
| `end_call(call_id, message)` | Says goodbye and ends the call |

## Architecture

```
Gemini CLI --[MCP/stdio]--> Local Server --[HTTP]--> Ngrok --[Webhook]--> Vapi
                                  ^                                        |
                                  |                                        v
                                  +---- Tool Results <---- Voice Call ---- User
```

The server creates a transient Vapi assistant for each call that relays messages between the AI agent and the user via tool calls.

## Running Standalone

```bash
npm start
```

This starts the MCP server on stdio and an HTTP server for webhooks.

## Troubleshooting

- **Ngrok session conflicts**: If you see ngrok errors, ensure no other ngrok sessions are running (`pkill -f ngrok`)
- **International calling**: Free Vapi numbers may not support international calls. Import a Twilio number into Vapi for international support.
- **Wrong API key**: Make sure you're using the **Private** API key from Vapi, not the Public key

## License

MIT
