export interface PhoneProvider {
    name: string;
    initialize(config: any): void;
    validateWebhook(request: any): Promise<boolean>;
    handleWebhook(request: any, response: any): Promise<void>;
    initiateCall(to: string, from: string, webhookUrl: string, ...args: any[]): Promise<string>;
    hangup(callId: string): Promise<void>;
    startStreaming?(callId: string, streamUrl: string): Promise<void>;
}

export interface ProviderRegistry {
    phone: PhoneProvider;
}
