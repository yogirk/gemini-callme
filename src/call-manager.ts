import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { Config } from './config.js';
import { SpeechService, RealtimeSTTSession } from './speech.js';
import { WebhookServer, WebhookEvent } from './webhook-server.js';
import { TunnelManager } from './tunnel.js';
import { PhoneProvider, TwilioProvider, TelnyxProvider } from './providers/index.js';
import { prepareAudioForPhone, resample, pcmToMulaw } from './audio.js';
import { ServerResponse } from 'http';

interface CallState {
  callId: string;
  callControlId?: string;
  wsToken: string;
  ws?: WebSocket;
  sttSession?: RealtimeSTTSession;
  hungUp: boolean;
  connected: boolean;
  streamingReady: boolean;
  startTime: number;
  audioBuffer: Buffer[];
}

export interface InitiateCallResult {
  callId: string;
  response: string;
}

export interface ContinueCallResult {
  response: string;
}

export class CallManager {
  private config: Config;
  private speech: SpeechService;
  private webhookServer: WebhookServer;
  private tunnel: TunnelManager;
  private provider: PhoneProvider;
  private publicUrl: string | null = null;

  private activeCalls: Map<string, CallState> = new Map();
  private wsTokenToCallId: Map<string, string> = new Map();
  private callControlIdToCallId: Map<string, string> = new Map();

  constructor(config: Config) {
    this.config = config;

    this.speech = new SpeechService({
      apiKey: config.openai.apiKey,
      voice: config.voice,
    });

    this.webhookServer = new WebhookServer({ port: config.port });
    this.tunnel = new TunnelManager({
      port: config.port,
    });

    if (config.provider === 'twilio' && config.twilio) {
      this.provider = new TwilioProvider(config.twilio);
    } else if (config.provider === 'telnyx' && config.telnyx) {
      this.provider = new TelnyxProvider(config.telnyx);
    } else {
      throw new Error(`Invalid provider configuration: ${config.provider}`);
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.webhookServer.on('webhook', (event: WebhookEvent, res?: ServerResponse) => {
      this.handleWebhook(event, res);
    });

    this.webhookServer.on('ws:connect', (token: string, ws: WebSocket) => {
      this.handleWsConnect(token, ws);
    });

    this.webhookServer.on('ws:message', (token: string, message: Record<string, unknown>) => {
      this.handleWsMessage(token, message);
    });

    this.webhookServer.on('ws:disconnect', (token: string) => {
      this.handleWsDisconnect(token);
    });
  }

  async start(): Promise<void> {
    await this.webhookServer.start();
    this.publicUrl = await this.tunnel.start();
  }

  async stop(): Promise<void> {
    // End all active calls
    for (const [callId, state] of this.activeCalls) {
      try {
        await this.endCallInternal(callId, state);
      } catch {
        // Ignore cleanup errors
      }
    }

    await this.tunnel.stop();
    await this.webhookServer.stop();
  }

  async initiateCall(message: string): Promise<InitiateCallResult> {
    if (!this.publicUrl) {
      throw new Error('Server not started');
    }

    const wsToken = randomUUID();

    // Pre-generate TTS audio
    const ttsPromise = this.speech.textToSpeech(message);

    // Initiate the call
    const result = await this.provider.initiateCall(
      this.config.userPhone,
      this.config.fromPhone,
      this.publicUrl,
      wsToken
    );

    const state: CallState = {
      callId: result.callId,
      callControlId: result.callControlId,
      wsToken,
      hungUp: false,
      connected: false,
      streamingReady: false,
      startTime: Date.now(),
      audioBuffer: [],
    };

    this.activeCalls.set(result.callId, state);
    this.wsTokenToCallId.set(wsToken, result.callId);
    if (result.callControlId) {
      this.callControlIdToCallId.set(result.callControlId, result.callId);
    }

    // Wait for connection
    await this.waitForConnection(result.callId, 30000);

    // Create STT session
    const sttSession = this.speech.createRealtimeSession();
    await sttSession.connect();
    state.sttSession = sttSession;

    // Wait for TTS and play audio
    const audioBuffer = await ttsPromise;
    await this.playAudio(result.callId, audioBuffer);

    // Wait for user response
    const response = await this.waitForResponse(result.callId, this.config.timeout);

    return { callId: result.callId, response };
  }

  async continueCall(callId: string, message: string): Promise<ContinueCallResult> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      throw new Error(`No active call with ID: ${callId}`);
    }
    if (state.hungUp) {
      throw new Error('Call has ended');
    }

    // Clear previous audio buffer
    state.sttSession?.clearAudio();

    // Generate and play TTS
    const audioBuffer = await this.speech.textToSpeech(message);
    await this.playAudio(callId, audioBuffer);

    // Wait for response
    const response = await this.waitForResponse(callId, this.config.timeout);

    return { response };
  }

  async speakToUser(callId: string, message: string): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      throw new Error(`No active call with ID: ${callId}`);
    }
    if (state.hungUp) {
      throw new Error('Call has ended');
    }

    // Generate and play TTS without waiting for response
    const audioBuffer = await this.speech.textToSpeech(message);
    await this.playAudio(callId, audioBuffer);
  }

  async endCall(callId: string, message?: string): Promise<{ duration: number }> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      throw new Error(`No active call with ID: ${callId}`);
    }

    // Play closing message if provided
    if (message && !state.hungUp) {
      try {
        const audioBuffer = await this.speech.textToSpeech(message);
        await this.playAudio(callId, audioBuffer);
        // Wait for audio to finish
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        // Ignore errors playing closing message
      }
    }

    return this.endCallInternal(callId, state);
  }

  private async endCallInternal(callId: string, state: CallState): Promise<{ duration: number }> {
    const duration = Math.round((Date.now() - state.startTime) / 1000);

    // Close STT session
    state.sttSession?.close();

    // Hang up the call
    if (!state.hungUp) {
      try {
        const id = state.callControlId || callId;
        await this.provider.hangup(id);
      } catch {
        // Ignore hangup errors
      }
    }

    // Clean up state
    this.activeCalls.delete(callId);
    this.wsTokenToCallId.delete(state.wsToken);
    if (state.callControlId) {
      this.callControlIdToCallId.delete(state.callControlId);
    }

    return { duration };
  }

  private async handleWebhook(event: WebhookEvent, res?: ServerResponse): Promise<void> {
    const wsUrl = this.publicUrl?.replace('https://', 'wss://').replace('http://', 'ws://');

    // Find call state
    let callId = event.callId;
    if (!callId && event.data.call_control_id) {
      callId = this.callControlIdToCallId.get(event.data.call_control_id as string);
    }

    const state = callId ? this.activeCalls.get(callId) : undefined;
    const wsUrlWithToken = state ? `${wsUrl}?token=${state.wsToken}` : wsUrl || '';

    // Let provider handle the webhook
    await this.provider.handleWebhook(event, wsUrlWithToken, res);

    // Update call state based on event
    if (state) {
      if (event.type === 'call.hangup' || event.data['CallStatus'] === 'completed') {
        state.hungUp = true;
      } else if (event.type === 'call.answered' || event.data['CallStatus'] === 'in-progress') {
        state.connected = true;
      } else if (event.type === 'streaming.started') {
        state.streamingReady = true;
      }
    }
  }

  private handleWsConnect(token: string, ws: WebSocket): void {
    const callId = this.wsTokenToCallId.get(token);
    if (!callId) return;

    const state = this.activeCalls.get(callId);
    if (state) {
      state.ws = ws;
      state.streamingReady = true;
    }
  }

  private handleWsMessage(token: string, message: Record<string, unknown>): void {
    const callId = this.wsTokenToCallId.get(token);
    if (!callId) return;

    const state = this.activeCalls.get(callId);
    if (!state || !state.sttSession) return;

    // Handle Twilio media messages
    if (message.event === 'media' && message.media) {
      const media = message.media as { payload: string; track?: string };
      // Only process inbound audio
      if (media.track === 'inbound' || !media.track) {
        // Convert mu-law 8kHz to PCM 24kHz for OpenAI
        const mulaw = Buffer.from(media.payload, 'base64');
        const pcm8k = this.mulawToPcm(mulaw);
        const pcm24k = this.resampleUp(pcm8k, 8000, 24000);
        state.sttSession.sendAudio(Buffer.from(pcm24k.buffer).toString('base64'));
      }
    }

    // Handle Telnyx media messages
    if (message.event === 'audio' && message.audio) {
      const audio = message.audio as { data: string; track?: string };
      if (audio.track === 'inbound' || !audio.track) {
        const mulaw = Buffer.from(audio.data, 'base64');
        const pcm8k = this.mulawToPcm(mulaw);
        const pcm24k = this.resampleUp(pcm8k, 8000, 24000);
        state.sttSession.sendAudio(Buffer.from(pcm24k.buffer).toString('base64'));
      }
    }
  }

  private handleWsDisconnect(token: string): void {
    const callId = this.wsTokenToCallId.get(token);
    if (!callId) return;

    const state = this.activeCalls.get(callId);
    if (state) {
      state.ws = undefined;
      state.streamingReady = false;
    }
  }

  private async waitForConnection(callId: string, timeoutMs: number): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error('Call not found');

    const startTime = Date.now();
    while (!state.connected && !state.hungUp) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Connection timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (state.hungUp) {
      throw new Error('Call was rejected or failed');
    }

    // Wait a bit more for streaming to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private async playAudio(callId: string, audioBuffer: Buffer): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state || !state.ws) {
      throw new Error('No WebSocket connection for call');
    }

    // Convert 24kHz PCM to 8kHz mu-law chunks
    const chunks = prepareAudioForPhone(audioBuffer);

    // Send audio chunks with timing (20ms per 160-byte chunk)
    for (const chunk of chunks) {
      if (state.hungUp) break;

      if (this.provider.name === 'twilio') {
        state.ws.send(JSON.stringify({
          event: 'media',
          streamSid: state.callId,
          media: { payload: chunk },
        }));
      } else {
        state.ws.send(JSON.stringify({
          event: 'audio',
          audio: { data: chunk },
        }));
      }

      // Pace the audio at 20ms per chunk
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Mark end of audio
    if (this.provider.name === 'twilio' && state.ws) {
      state.ws.send(JSON.stringify({
        event: 'mark',
        streamSid: state.callId,
        mark: { name: 'end-of-speech' },
      }));
    }
  }

  private async waitForResponse(callId: string, timeoutMs: number): Promise<string> {
    const state = this.activeCalls.get(callId);
    if (!state || !state.sttSession) {
      throw new Error('No STT session for call');
    }

    // Commit the audio buffer
    state.sttSession.commitAudio();

    try {
      const transcript = await Promise.race([
        state.sttSession.waitForTranscript(timeoutMs),
        this.waitForHangup(callId).then(() => {
          throw new Error('Call ended');
        }),
      ]);

      return transcript;
    } catch (err) {
      if (state.hungUp) {
        return '[Call ended by user]';
      }
      throw err;
    }
  }

  private waitForHangup(callId: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const state = this.activeCalls.get(callId);
        if (!state || state.hungUp) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private mulawToPcm(mulaw: Buffer): Int16Array {
    const pcm = new Int16Array(mulaw.length);
    for (let i = 0; i < mulaw.length; i++) {
      pcm[i] = this.decodeMulaw(mulaw[i]);
    }
    return pcm;
  }

  private decodeMulaw(byte: number): number {
    byte = ~byte & 0xff;
    const sign = byte & 0x80;
    const exponent = (byte >> 4) & 0x07;
    const mantissa = byte & 0x0f;
    let sample = ((mantissa << 3) + 33) << exponent;
    sample -= 33;
    sample <<= 2;
    return sign ? -sample : sample;
  }

  private resampleUp(input: Int16Array, sourceRate: number, targetRate: number): Int16Array {
    return resample(input, sourceRate, targetRate);
  }

  hasActiveCall(callId: string): boolean {
    return this.activeCalls.has(callId);
  }
}
