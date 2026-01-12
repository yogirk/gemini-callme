
import type { PhoneProvider } from './types.js';

export class PlivoPhoneProvider implements PhoneProvider {
    readonly name = 'plivo';
    private authId: string | null = null;
    private authToken: string | null = null;

    initialize(config: any): void {
        this.authId = config.accountSid; // Plivo Auth ID
        this.authToken = config.authToken; // Plivo Auth Token
    }

    async validateWebhook(request: any): Promise<boolean> {
        // Implement signature validation if needed
        // https://www.plivo.com/docs/voice/guides/verify-signature/
        return true;
    }

    async handleWebhook(request: any, response: any): Promise<void> {
        // Plivo expects XML response similar to Twilio
        // We'll leave this empty as the CallManager logic handles the XML generation 
        // or we can add a helper specifically for Plivo XML generation
    }

    // Helper to generate XML for streaming
    getStreamConnectXml(streamUrl: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" audioTrack="inbound" streamTimeout="86400">
     ${streamUrl}
  </Stream>
</Response>`;
    }

    async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
        if (!this.authId || !this.authToken) throw new Error('Plivo not initialized');

        const auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');

        // Plivo REST API to make an outbound call
        const result = await fetch(
            `https://api.plivo.com/v1/Account/${this.authId}/Call/`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: to,
                    from: from,
                    answer_url: webhookUrl,
                    answer_method: 'POST',
                })
            }
        );

        if (!result.ok) throw new Error(`Plivo call failed: ${result.status} ${await result.text()}`);

        const data = await result.json() as any;
        // Plivo returns request_uuid, which is used as the Call UUID
        return data.request_uuid;
    }

    async hangup(callId: string): Promise<void> {
        if (!this.authId || !this.authToken) return;
        const auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');

        await fetch(
            `https://api.plivo.com/v1/Account/${this.authId}/Call/${callId}/`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            }
        );
    }

    async startStreaming(callId: string, streamUrl: string): Promise<void> {
        // Like Twilio, Plivo starts streaming via XML response to answer_url.
        // No async API to start stream mid-call without modifying the call, 
        // but our flow sets answer_url initially, so it starts immediately on answer.
    }
}
