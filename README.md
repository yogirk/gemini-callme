# GeminiCall

MCP server enabling Gemini CLI to make phone calls to users for notifications, decisions, and two-way conversations.

## Features

- **Phone call initiation** - Gemini can call you when tasks complete or need decisions
- **Two-way conversations** - Full voice conversations with speech-to-text and text-to-speech
- **Multiple providers** - Supports both Twilio and Telnyx
- **OpenAI speech** - Uses Whisper for transcription and TTS for voice synthesis

## Prerequisites

1. **Phone Provider Account** - [Twilio](https://twilio.com) or [Telnyx](https://telnyx.com)
2. **OpenAI API Key** - For speech services
3. **ngrok Account** - For webhook tunneling (free tier works)

## Installation

```bash
# Clone and install
cd geminicli-callme
npm install
npm run build
```

## Configuration

### Option 1: Environment Variables

Create a `.env` file or export these variables:

```bash
# Provider (twilio or telnyx)
export GEMINICALL_PROVIDER=twilio

# Phone numbers (E.164 format)
export GEMINICALL_USER_PHONE=+15551234567
export GEMINICALL_FROM_PHONE=+15559876543

# Twilio credentials
export GEMINICALL_TWILIO_ACCOUNT_SID=ACxxxxxxxx
export GEMINICALL_TWILIO_AUTH_TOKEN=xxxxxxxx

# OR Telnyx credentials
export GEMINICALL_TELNYX_API_KEY=KEY_xxxxxxxx

# OpenAI API key
export GEMINICALL_OPENAI_API_KEY=sk-xxxxxxxx

# ngrok auth token
export GEMINICALL_NGROK_AUTHTOKEN=xxxxxxxx

# Optional
export GEMINICALL_PORT=3333
export GEMINICALL_VOICE=onyx
export GEMINICALL_TIMEOUT=180000
```

### Option 2: Gemini CLI Settings

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "geminicall": {
      "command": "node",
      "args": ["/path/to/geminicli-callme/dist/index.js"],
      "env": {
        "GEMINICALL_PROVIDER": "twilio",
        "GEMINICALL_USER_PHONE": "+15551234567",
        "GEMINICALL_FROM_PHONE": "+15559876543",
        "GEMINICALL_TWILIO_ACCOUNT_SID": "ACxxxxxxxx",
        "GEMINICALL_TWILIO_AUTH_TOKEN": "xxxxxxxx",
        "GEMINICALL_OPENAI_API_KEY": "sk-xxxxxxxx",
        "GEMINICALL_NGROK_AUTHTOKEN": "xxxxxxxx"
      }
    }
  }
}
```

## Provider Setup

### Twilio

1. Create account at [twilio.com](https://twilio.com)
2. Get a phone number (~$1.15/month)
3. Copy Account SID and Auth Token from the console

### Telnyx

1. Create account at [portal.telnyx.com](https://portal.telnyx.com)
2. Purchase a phone number (~$1/month)
3. Create a Voice API application
4. Copy the API Key

## Available Tools

| Tool | Description |
|------|-------------|
| `initiate_call` | Start a phone call with an initial message |
| `continue_call` | Send a follow-up message and get response |
| `speak_to_user` | One-way announcement (no response expected) |
| `end_call` | Terminate the call with optional closing message |

## Usage Examples

Once configured, Gemini can use these tools naturally:

```
Gemini: I've finished the build. Let me call you to discuss the results.
[Uses initiate_call: "Hi, the build completed successfully. There were 3 warnings. Would you like me to explain them?"]

User: "Yes, please tell me about the warnings"

Gemini: [Uses continue_call with the user's response]
```

## Cost Estimate

| Component | Cost |
|-----------|------|
| Twilio | ~$0.02/min |
| Telnyx | ~$0.01/min |
| OpenAI Whisper | ~$0.006/min |
| OpenAI TTS | ~$0.015/min |
| **Total** | **~$0.03-0.05/min** |

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Run
npm start
```

## Architecture

```
┌─────────────┐      stdio      ┌──────────────┐
│ Gemini CLI  │ ◄─────────────► │  MCP Server  │
└─────────────┘                 └──────┬───────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
            ┌───────────┐      ┌────────────┐     ┌────────────┐
            │   ngrok   │      │  Twilio/   │     │   OpenAI   │
            │  (tunnel) │      │  Telnyx    │     │  (speech)  │
            └───────────┘      └────────────┘     └────────────┘
                    │                  │
                    └────────┬─────────┘
                             ▼
                      ┌────────────┐
                      │   Phone    │
                      └────────────┘
```

## License

MIT
