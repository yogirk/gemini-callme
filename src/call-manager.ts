
import { WebSocket } from 'ws';
import { ProviderRegistry, STTSession } from './providers/types.js';
import { generateWebSocketToken } from './utils/security.js';

interface CallState {
    callId: string;
    providerCallId: string | null;
    ws: WebSocket | null;
    sttSession: STTSession | null;
    wsToken: string;
    startTime: number;
    hungUp: boolean;
    streamSid: string | null; // For Twilio
}

export class CallManager {
    private activeCalls = new Map<string, CallState>();
    private providerCallIdToCallId = new Map<string, string>();
    // Public for index.ts to lookup
    public wsTokenToCallId = new Map<string, string>();

    constructor(
        private providers: ProviderRegistry,
        private publicUrl: string,
        private userPhoneNumber: string,
        private systemPhoneNumber: string
    ) { }

    async initiateCall(message: string): Promise<{ callId: string; response: string }> {
        const callId = `call-${Date.now()}`;
        const wsToken = generateWebSocketToken();

        const sttSession = this.providers.stt.createSession();
        await sttSession.connect();

        const state: CallState = {
            callId,
            providerCallId: null,
            ws: null,
            sttSession,
            wsToken,
            startTime: Date.now(),
            hungUp: false,
            streamSid: null
        };

        this.activeCalls.set(callId, state);
        this.wsTokenToCallId.set(wsToken, callId);

        // Provider webhook URL
        const webhookUrl = `${this.publicUrl}/webhooks/voice`; // Single webhook endpoint

        try {
            console.error(`[CallManager] Initiating call to ${this.userPhoneNumber} from ${this.systemPhoneNumber}`);
            const providerCallId = await this.providers.phone.initiateCall(
                this.userPhoneNumber,
                this.systemPhoneNumber,
                webhookUrl
            );

            state.providerCallId = providerCallId;
            this.providerCallIdToCallId.set(providerCallId, callId);

            // Generate audio for the initial message
            console.error(`[CallManager] Generating initial TTS...`);
            const audio = await this.providers.tts.synthesize(message);

            // Wait for connection (media stream)
            console.error(`[CallManager] Waiting for media connection...`);
            await this.waitForConnection(callId);

            // Send audio
            console.error(`[CallManager] Sending initial audio...`);
            await this.sendAudio(callId, audio);

            // Listen for response
            console.error(`[CallManager] Listening for response...`);
            const response = await sttSession.waitForTranscript(15000); // 15s timeout

            return { callId, response };

        } catch (e) {
            console.error('[CallManager] Error initiating call:', e);
            this.cleanupCall(callId);
            throw e;
        }
    }

    async continueCall(callId: string, message: string): Promise<string> {
        const state = this.activeCalls.get(callId);
        if (!state || state.hungUp) throw new Error('Call not active');

        const audio = await this.providers.tts.synthesize(message);
        await this.sendAudio(callId, audio);

        const response = await state.sttSession!.waitForTranscript(15000);
        return response;
    }

    async speakOnly(callId: string, message: string): Promise<void> {
        const state = this.activeCalls.get(callId);
        if (!state || state.hungUp) throw new Error('Call not active');

        const audio = await this.providers.tts.synthesize(message);
        await this.sendAudio(callId, audio);
    }

    async endCall(callId: string, message: string): Promise<number> {
        const state = this.activeCalls.get(callId);
        if (!state) throw new Error('Call not active');

        await this.speakOnly(callId, message);

        // Short delay to allow audio to finish (approx)
        await new Promise(r => setTimeout(r, 2000));

        if (state.providerCallId) {
            await this.providers.phone.hangup(state.providerCallId);
        }

        const duration = (Date.now() - state.startTime) / 1000;
        this.cleanupCall(callId);
        return duration;
    }

    // Handle incoming WebSocket connection for media stream
    handleMediaConnection(ws: WebSocket, callId: string) {
        const state = this.activeCalls.get(callId);
        if (!state) {
            ws.close();
            return;
        }
        state.ws = ws;

        ws.on('message', (data: Buffer) => {
            // Identify parsing based on provider?
            // Telnyx and Twilio send JSON messages.
            // Twilio: { event: 'media', media: { payload: '...' } }
            // Telnyx: similar structure for inbound media

            try {
                const msg = JSON.parse(data.toString());

                // Twilio: Capture StreamSid
                if (msg.event === 'start' && msg.streamSid) {
                    state.streamSid = msg.streamSid;
                }

                if (msg.event === 'media' && msg.media && msg.media.payload) {
                    const payload = Buffer.from(msg.media.payload, 'base64');
                    // Google STT expects raw audio.
                    // Providers usually send payload. 
                    // Twilio/Telnyx inbound track.
                    if (msg.media.track === 'inbound' || !msg.media.track /* default */) {
                        state.sttSession?.sendAudio(payload);
                    }
                }

                if (msg.event === 'stop') {
                    state.hungUp = true;
                    this.cleanupCall(callId);
                }
            } catch (e) {
                // ignore parse errors or non-json audio
            }
        });

        ws.on('close', () => {
            state.ws = null;
        });
    }

    // Handle HTTP Webhook
    async handleWebhook(reqBody: any, res: any) {
        // Logic for different events.
        // Telnyx: 'call.answered' -> startStreaming
        // Twilio: 'answered' -> return TwiML for stream

        // Determine provider?
        // CallManager assumes one configured provider active.

        const providerName = this.providers.phone.name;

        if (providerName === 'telnyx') {
            const eventType = reqBody.data?.event_type;
            const callControlId = reqBody.data?.payload?.call_control_id;

            if (callControlId) {
                const callId = this.providerCallIdToCallId.get(callControlId);
                if (callId) {
                    const state = this.activeCalls.get(callId);
                    if (state && eventType === 'call.answered') {
                        const streamUrl = `wss://${new URL(this.publicUrl).host}/media-stream?token=${state.wsToken}`;
                        await this.providers.phone.startStreaming(callControlId, streamUrl);
                    }
                    if (state && eventType === 'call.hangup') {
                        state.hungUp = true;
                        this.cleanupCall(callId);
                    }
                }
            }

            // Send 200 OK
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        }
        else if (providerName === 'twilio') {
            // Twilio sends form data usually, parsed before header?
            // We assume reqBody is parsed object (e.g. from Fastify or manual parsing in index.ts)
            // Actually, we'll assume receiving raw req/res in index and passing standardized 'body' here 
            // or just handle logic.

            // Simplified for now: assume we just need to return TwiML on connect.
            // But Twilio StatusCallback is async. The synchronous response to 'Call' is already done.
            // When does Twilio ask for TwiML? "Url" parameter.
            // So when call answers, Twilio hits "Url".

            const callSid = reqBody.CallSid;
            const callId = this.providerCallIdToCallId.get(callSid);

            res.writeHead(200, { 'Content-Type': 'application/xml' });

            if (callId) {
                const state = this.activeCalls.get(callId);
                if (state) {
                    const streamUrl = `wss://${new URL(this.publicUrl).host}/media-stream?token=${state.wsToken}`;
                    // Using 'any' cast to access Twilio-specific helper on the interface if present?
                    // Or just hardcode XML here since we know it's Twilio.
                    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;
                    res.end(xml);
                    return;
                }
            }

            // Default fallthrough
            res.end('<Response/>');
        }
    }

    private async waitForConnection(callId: string): Promise<void> {
        let retries = 0;
        while (retries < 150) { // 15 seconds
            const state = this.activeCalls.get(callId);
            if (!state) throw new Error('Call gone');
            if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
            await new Promise(r => setTimeout(r, 100));
            retries++;
        }
        throw new Error('Timeout waiting for media connection');
    }

    private async sendAudio(callId: string, audio: Buffer): Promise<void> {
        const state = this.activeCalls.get(callId);
        if (!state || !state.ws) return;

        // Send as JSON media event
        // Chunking is important for smoothness
        const chunkSize = 3200; // 0.2s of audio (8000Hz * 1 byte * 0.2? Wait. Mulaw is 1 byte/sample. 8000 bytes/sec. 160 bytes=20ms.)
        // Reference used 160 bytes chunks (20ms)
        const chunkBytes = 160;

        for (let i = 0; i < audio.length; i += chunkBytes) {
            const chunk = audio.subarray(i, i + chunkBytes);
            const msg: any = {
                event: 'media',
                media: {
                    payload: chunk.toString('base64')
                }
            };
            if (state.streamSid) msg.streamSid = state.streamSid; // Required for Twilio

            state.ws.send(JSON.stringify(msg));

            // throttle to real-time approx?
            // 20ms of audio.
            await new Promise(r => setTimeout(r, 20));
        }
    }

    private cleanupCall(callId: string) {
        const state = this.activeCalls.get(callId);
        if (state) {
            state.sttSession?.close();
            state.ws?.close();
            this.wsTokenToCallId.delete(state.wsToken);
            if (state.providerCallId) this.providerCallIdToCallId.delete(state.providerCallId);
            this.activeCalls.delete(callId);
        }
    }
}
