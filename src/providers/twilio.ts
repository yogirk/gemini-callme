
import type { PhoneProvider } from './types.js';

export class TwilioPhoneProvider implements PhoneProvider {
    readonly name = 'twilio';
    private accountSid: string | null = null;
    private authToken: string | null = null;

    initialize(config: any): void {
        this.accountSid = config.accountSid;
        this.authToken = config.authToken;
    }

    async validateWebhook(request: any): Promise<boolean> {
        return true; // Implement signature check if needed
    }

    async handleWebhook(request: any, response: any): Promise<void> {
        // Twilio logic is different; it needs TwiML returned.
        // We will handle this by returning XML in the response writer passed in.
        // But the call manager manages the state.
        // This part is tricky if we abstracted it too much.
        // We'll leave it empty here and handle specific TwiML generation in call-manager for now
        // or helper method.
    }

    // Helper to generate TwiML for streaming
    getStreamConnectXml(streamUrl: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;
    }

    async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
        if (!this.accountSid || !this.authToken) throw new Error('Twilio not initialized');

        const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        const result = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    To: to,
                    From: from,
                    Url: webhookUrl,
                }).toString()
            }
        );

        if (!result.ok) throw new Error(`Twilio call failed: ${result.status} ${await result.text()}`);

        const data = await result.json() as any;
        return data.sid;
    }

    async hangup(callId: string): Promise<void> {
        if (!this.accountSid) return;
        const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${callId}.json`,
            {
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ Status: 'completed' }).toString()
            }
        );
    }

    async startStreaming(callId: string, streamUrl: string): Promise<void> {
        // Twilio starts streaming via TwiML (in webhook response), not async API usually.
        // But if options allow updating call to redirect to TwiML...
        // Typically we return the TwiML on the 'answer' webhook.
        // The call-manager will handle the 'answer' webhook and use getStreamConnectXml.
    }
}
