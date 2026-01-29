import { ServerResponse } from 'http';
import { createVerify } from 'crypto';
import { PhoneProvider, CallResult } from './index.js';
import { WebhookEvent } from '../webhook-server.js';

export interface TelnyxConfig {
  apiKey: string;
  publicKey?: string;
}

export class TelnyxProvider implements PhoneProvider {
  readonly name = 'telnyx' as const;
  private config: TelnyxConfig;

  constructor(config: TelnyxConfig) {
    this.config = config;
  }

  async initiateCall(
    toPhone: string,
    fromPhone: string,
    webhookUrl: string,
    _wsToken: string
  ): Promise<CallResult> {
    const url = 'https://api.telnyx.com/v2/calls';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: this.config.apiKey.split('_')[1], // Extract connection ID from key
        to: toPhone,
        from: fromPhone,
        webhook_url: `${webhookUrl}/telnyx/events`,
        webhook_url_method: 'POST',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { data: { call_control_id: string; call_leg_id: string } };
    return {
      callId: data.data.call_leg_id,
      callControlId: data.data.call_control_id,
    };
  }

  async handleWebhook(
    event: WebhookEvent,
    wsUrl: string,
    _res?: ServerResponse
  ): Promise<void> {
    const eventType = event.type;
    const payload = (event.data.payload as Record<string, unknown>) || {};
    const callControlId = payload.call_control_id as string;

    if (!callControlId) return;

    if (eventType === 'call.answered') {
      // Start streaming audio
      await this.startStreaming(callControlId, wsUrl);
    }
    // Other events (hangup, etc.) are handled by the call manager
  }

  private async startStreaming(callControlId: string, wsUrl: string): Promise<void> {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream_url: wsUrl,
        stream_track: 'both_tracks',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx streaming error: ${response.status} ${error}`);
    }
  }

  verifySignature(
    rawBody: string,
    headers: Record<string, string>,
    _webhookUrl: string
  ): boolean {
    if (!this.config.publicKey) {
      // Skip verification if no public key configured
      return true;
    }

    const signature = headers['telnyx-signature-ed25519'];
    const timestamp = headers['telnyx-timestamp'];

    if (!signature || !timestamp) {
      return false;
    }

    try {
      const signedPayload = `${timestamp}|${rawBody}`;
      const verifier = createVerify('ed25519');
      verifier.update(signedPayload);

      return verifier.verify(
        {
          key: Buffer.from(this.config.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        },
        Buffer.from(signature, 'base64')
      );
    } catch {
      return false;
    }
  }

  async hangup(callControlId: string): Promise<void> {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx hangup error: ${response.status} ${error}`);
    }
  }

  async playAudio(callControlId: string, audioUrl: string): Promise<void> {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx playback error: ${response.status} ${error}`);
    }
  }
}
