import { PhoneProvider, ProviderRegistry } from './providers/types.js';

interface CallState {
    callId: string;
    userResponseResolver?: (response: string) => void;
    geminiResponseResolver?: (response: string) => void;
}

export class CallManager {
    private activeCalls = new Map<string, CallState>();
    private provider: PhoneProvider;
    public publicUrl: string;
    private userNumber: string;
    private myNumber: string;

    constructor(
        providers: ProviderRegistry,
        publicUrl: string,
        userNumber: string,
        myNumber: string
    ) {
        this.provider = providers.phone;
        this.publicUrl = publicUrl;
        this.userNumber = userNumber;
        this.myNumber = myNumber;
    }

    async initiateCall(message: string): Promise<{ callId: string; transcript: string }> {
        const webhookUrl = this.publicUrl + '/webhooks/vapi';

        const callId = await this.provider.initiateCall(
            this.userNumber,
            this.myNumber,
            webhookUrl,
            message
        );

        return new Promise<{ callId: string; transcript: string }>((resolve) => {
            this.activeCalls.set(callId, {
                callId,
                userResponseResolver: (transcript: string) => resolve({ callId, transcript })
            });
        });
    }

    async continueCall(callId: string, message: string): Promise<string> {
        const state = this.activeCalls.get(callId);
        if (!state) throw new Error(`Call ${callId} not found`);

        if (state.geminiResponseResolver) {
            state.geminiResponseResolver(message);
            state.geminiResponseResolver = undefined;
        }

        return new Promise<string>((resolve) => {
            state.userResponseResolver = resolve;
        });
    }

    async endCall(callId: string, message: string): Promise<void> {
        const state = this.activeCalls.get(callId);

        if (state?.geminiResponseResolver) {
            state.geminiResponseResolver(message + " [END_CALL]");
        }

        setTimeout(() => {
            this.provider.hangup(callId);
            this.activeCalls.delete(callId);
        }, 5000);
    }

    async handleWebhook(reqBody: any, res: any) {
        const message = reqBody.message;

        if (!message || message.type !== 'tool-calls') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }

        const toolCallList = message.toolCallList || [];
        const vapiCallId = message.call?.id;

        let state = this.activeCalls.get(vapiCallId);

        // Map internal call ID to Vapi call ID on first webhook
        if (!state && this.activeCalls.size > 0) {
            const entry = this.activeCalls.entries().next().value as [string, CallState] | undefined;
            if (entry) {
                const [oldId, oldState] = entry;
                this.activeCalls.delete(oldId);
                state = oldState;
                state.callId = vapiCallId;
                this.activeCalls.set(vapiCallId, state);
            }
        }

        const results: Array<{ toolCallId: string; result: string }> = [];

        for (const toolCall of toolCallList) {
            const toolCallId = toolCall.id;
            const toolName = toolCall.function?.name || toolCall.name;
            const args = toolCall.function?.arguments || toolCall.arguments || {};

            if (toolName === 'relay_to_gemini') {
                const userMessage = args.user_message || args.userMessage || '';

                if (state && state.userResponseResolver) {
                    state.userResponseResolver(userMessage);
                    state.userResponseResolver = undefined;

                    const geminiResponse = await new Promise<string>((resolve) => {
                        state!.geminiResponseResolver = resolve;
                    });

                    results.push({ toolCallId, result: geminiResponse });
                } else {
                    results.push({ toolCallId, result: "I'm processing your request, please hold." });
                }
            } else {
                results.push({ toolCallId, result: "Tool not recognized." });
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
    }
}
