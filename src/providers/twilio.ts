import { ServerResponse } from 'http';
import { createHmac } from 'crypto';
import { PhoneProvider, CallResult } from './index.js';
import { WebhookEvent } from '../webhook-server.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

export class TwilioProvider implements PhoneProvider {
  readonly name = 'twilio' as const;
  private config: TwilioConfig;

  constructor(config: TwilioConfig) {
    this.config = config;
  }

  async initiateCall(
    toPhone: string,
    fromPhone: string,
    webhookUrl: string,
    _wsToken: string
  ): Promise<CallResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`;

    const body = new URLSearchParams({
      To: toPhone,
      From: fromPhone,
      Url: `${webhookUrl}/twilio/connect`,
      StatusCallback: `${webhookUrl}/twilio/status`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      StatusCallbackMethod: 'POST',
    });

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { sid: string };
    return { callId: data.sid };
  }

  async handleWebhook(
    event: WebhookEvent,
    wsUrl: string,
    res?: ServerResponse
  ): Promise<void> {
    if (!res) return;

    const eventType = event.type;
    const callStatus = event.data['CallStatus'] as string;

    if (eventType === 'connect' || callStatus === 'in-progress') {
      // Return TwiML to start media stream
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(twiml);
    } else if (eventType === 'status') {
      // Status callback - just acknowledge
      res.writeHead(200);
      res.end('OK');
    } else {
      res.writeHead(200);
      res.end('OK');
    }
  }

  verifySignature(
    rawBody: string,
    headers: Record<string, string>,
    webhookUrl: string
  ): boolean {
    const signature = headers['x-twilio-signature'];
    if (!signature) {
      return false;
    }

    // Build the data string: URL + sorted POST params
    const params = new URLSearchParams(rawBody);
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}${value}`)
      .join('');

    const data = webhookUrl + sortedParams;

    const expectedSignature = createHmac('sha1', this.config.authToken)
      .update(data)
      .digest('base64');

    return signature === expectedSignature;
  }

  async hangup(callId: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls/${callId}.json`;

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'Status=completed',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio hangup error: ${response.status} ${error}`);
    }
  }
}
