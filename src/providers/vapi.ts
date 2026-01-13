import type { PhoneProvider } from './types.js';

export interface VapiConfig {
    apiKey: string;
    phoneNumberId: string;
    serverUrl: string;
}

export class VapiPhoneProvider implements PhoneProvider {
    readonly name = 'vapi';
    private apiKey: string = '';
    private phoneNumberId: string = '';
    private serverUrl: string = '';

    initialize(config: VapiConfig): void {
        this.apiKey = config.apiKey;
        this.phoneNumberId = config.phoneNumberId;
        this.serverUrl = config.serverUrl;
    }

    async initiateCall(to: string, _from: string, webhookUrl: string, initialMessage: string): Promise<string> {
        if (!this.apiKey) throw new Error('Vapi API Key not configured');
        if (!this.phoneNumberId) throw new Error('Vapi Phone Number ID not configured');

        console.error(`[Vapi] Initiating call to ${to}`);
        console.error(`[Vapi] Webhook URL: ${webhookUrl}`);

        // Create a transient assistant with a tool that calls our webhook
        const assistant = {
            name: "Gemini Voice Relay",
            firstMessage: initialMessage,
            model: {
                provider: "openai",
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are a voice relay between a human and an AI assistant named Gemini.

CRITICAL INSTRUCTIONS:
1. After speaking your first message, wait for the user to respond.
2. When the user speaks, IMMEDIATELY call the "relay_to_gemini" tool with exactly what they said.
3. The tool will return Gemini's response. Speak that response EXACTLY as returned.
4. Repeat steps 2-3 until Gemini ends the call.

NEVER make up responses. ALWAYS use the relay_to_gemini tool for every user message.
If the tool returns a message containing "[END_CALL]", say goodbye and end the call.`
                    }
                ],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "relay_to_gemini",
                            description: "Send the user's message to Gemini and get the response. MUST be called for every user message.",
                            parameters: {
                                type: "object",
                                properties: {
                                    user_message: {
                                        type: "string",
                                        description: "Exactly what the user just said"
                                    }
                                },
                                required: ["user_message"]
                            }
                        },
                        server: {
                            url: webhookUrl
                        }
                    }
                ]
            },
            voice: {
                provider: "11labs",
                voiceId: "21m00Tcm4TlvDq8ikWAM" // Rachel - natural female voice
            }
        };

        const response = await fetch('https://api.vapi.ai/call/phone', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                assistant,
                phoneNumberId: this.phoneNumberId,
                customer: {
                    number: to
                }
            })
        });

        const responseText = await response.text();
        console.error(`[Vapi] Response status: ${response.status}`);
        console.error(`[Vapi] Response: ${responseText}`);

        if (!response.ok) {
            throw new Error(`Vapi call failed: ${responseText}`);
        }

        const data = JSON.parse(responseText);
        console.error(`[Vapi] Call initiated with ID: ${data.id}`);
        return data.id;
    }

    async validateWebhook(_request: any): Promise<boolean> {
        return true;
    }

    async handleWebhook(_request: any, _response: any): Promise<void> {
        // Handled by CallManager
    }

    getStreamConnectXml(_streamUrl: string): string {
        throw new Error("Not supported for Vapi");
    }

    async hangup(callId: string): Promise<void> {
        if (!this.apiKey) return;

        console.error(`[Vapi] Ending call ${callId}`);
        await fetch(`https://api.vapi.ai/call/${callId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });
    }

    async startStreaming(_callId: string, _streamUrl: string): Promise<void> {
        // Not needed for Vapi
    }
}
