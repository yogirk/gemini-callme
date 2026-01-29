import { ServerResponse } from 'http';
import { WebhookEvent } from '../webhook-server.js';

export interface CallResult {
  callId: string;
  callControlId?: string;
}

export interface PhoneProvider {
  /**
   * Provider name for identification
   */
  readonly name: 'twilio' | 'telnyx';

  /**
   * Initiate an outbound call
   */
  initiateCall(
    toPhone: string,
    fromPhone: string,
    webhookUrl: string,
    wsToken: string
  ): Promise<CallResult>;

  /**
   * Handle incoming webhook event
   * Returns TwiML/TeXML response if applicable
   */
  handleWebhook(
    event: WebhookEvent,
    wsUrl: string,
    res?: ServerResponse
  ): Promise<void>;

  /**
   * Verify webhook signature
   */
  verifySignature(
    rawBody: string,
    headers: Record<string, string>,
    webhookUrl: string
  ): boolean;

  /**
   * Hang up an active call
   */
  hangup(callId: string): Promise<void>;
}

export { TwilioProvider } from './twilio.js';
export { TelnyxProvider } from './telnyx.js';
