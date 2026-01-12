
export interface PhoneProvider {
    name: string;
    initialize(config: any): void;
    // Determine if this provider handles the incoming webhook
    validateWebhook(request: any): Promise<boolean>;
    // Handle the webhook and return appropriate response (e.g. TwiML or JSON)
    handleWebhook(request: any, response: any): Promise<void>;
    // Initiate an outbound call
    initiateCall(to: string, from: string, webhookUrl: string): Promise<string>;
    // Hangup a call
    hangup(callId: string): Promise<void>;
    // Play audio on an active call
    startStreaming(callId: string, streamUrl: string): Promise<void>;
}

export interface TTSProvider {
    name: string;
    initialize(config: any): void;
    synthesize(text: string): Promise<Buffer>;
}

export interface STTProvider {
    name: string;
    initialize(config: any): void;
    createSession(): STTSession;
}

export interface STTSession {
    connect(): Promise<void>;
    sendAudio(audio: Buffer): void;
    // Return the recognized text
    waitForTranscript(timeoutMs: number): Promise<string>;
    close(): void;
}

export interface ProviderRegistry {
    phone: PhoneProvider;
    tts: TTSProvider;
    stt: STTProvider;
}
