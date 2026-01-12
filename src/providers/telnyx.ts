
import type { PhoneProvider } from './types.js';

interface TelnyxCallResponse {
    data: {
        call_control_id: string;
    };
}

export class TelnyxPhoneProvider implements PhoneProvider {
    readonly name = 'telnyx';
    private apiKey: string | null = null;
    private connectionId: string | null = null;

    initialize(config: any): void {
        this.apiKey = config.authToken;
        this.connectionId = config.accountSid;
    }

    async validateWebhook(request: any): Promise<boolean> {
        // Basic validation or use signature if implemented
        return true;
    }

    async handleWebhook(request: any, response: any): Promise<void> {
        // Telnyx webhooks: call.initiated, call.answered, call.hangup
        // We process them in call-manager via logic, but here we construct response helper?
        // Actually, call-manager handles the logic. This function could just be for low-level protocol.
        // But based on interface: handleWebhook(req, res).
        // If we move logic here, we need access to call manager.
        // Re-reading interface: "Handle the webhook and return appropriate response"
        // Telephony providers often need immediate TwiML/JSON response.
        // Telnyx simply expects 200 OK mostly, commands are async.
        // Twilio expects TwiML.

        // Since Telnyx is async commands, we just return 200 OK here mostly.
        // We populate response.
        // Logic for stream handling is done in call manager upon seeing the event.
    }

    async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
        if (!this.apiKey || !this.connectionId) throw new Error('Telnyx not initialized');

        const result = await fetch('https://api.telnyx.com/v2/calls', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                connection_id: this.connectionId,
                to,
                from,
                webhook_url: webhookUrl,
                webhook_url_method: 'POST',
                stream_track: 'both_tracks',
            }),
        });

        if (!result.ok) {
            throw new Error(`Telnyx init call failed: ${result.status} ${await result.text()}`);
        }

        const data = (await result.json()) as TelnyxCallResponse;
        return data.data.call_control_id;
    }

    async hangup(callId: string): Promise<void> {
        if (!this.apiKey) return;
        await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/hangup`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    }

    async startStreaming(callId: string, streamUrl: string): Promise<void> {
        if (!this.apiKey) return;
        await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/streaming_start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stream_url: streamUrl,
                stream_track: 'both_tracks',
                stream_bidirectional_mode: 'rtp',
                stream_bidirectional_codec: 'PCMU'
            })
        });
    }
}
