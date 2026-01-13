
import type { PhoneProvider } from './types.js';

export class TelnyxPhoneProvider implements PhoneProvider {
    readonly name = 'telnyx';
    private apiKey: string | null = null;
    private connectionId: string | null = null; // SIP Connection ID

    initialize(config: any): void {
        this.apiKey = config.authToken; // API V2 Key
        this.connectionId = config.accountSid; // Call Control App ID / Connection ID
    }

    async validateWebhook(request: any): Promise<boolean> {
        // Implement signature validation
        return true;
    }

    async handleWebhook(reqBody: any, res: any): Promise<void> {
        // NO-OP, handled in CallManager
    }

    async initiateCall(to: string, from: string, webhookUrl: string, ...args: any[]): Promise<string> {
        if (!this.apiKey) throw new Error('Telnyx not initialized');

        const result = await fetch('https://api.telnyx.com/v2/calls', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: to,
                from: from,
                connection_id: this.connectionId,
                webhook_url: webhookUrl,
                webhook_url_method: 'POST'
            })
        });

        if (!result.ok) {
            throw new Error(`Telnyx Call Failed: ${await result.text()}`);
        }

        const data = await result.json() as any;
        return data.data.call_control_id;
    }

    async hangup(callId: string): Promise<void> {
        if (!this.apiKey) return;
        await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/hangup`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_state: Buffer.from('hungup').toString('base64')
            })
        });
    }

    async startStreaming(callId: string, streamUrl: string): Promise<void> {
        if (!this.apiKey) return;

        await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/stream_audio`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                stream_url: streamUrl,
                stream_track: 'both_tracks'
            })
        });
    }

    getStreamConnectXml(streamUrl: string): string {
        throw new Error("Not implemented for Telnyx");
    }
}
