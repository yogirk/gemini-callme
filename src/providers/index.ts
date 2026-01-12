
import { PhoneProvider, STTProvider, TTSProvider, ProviderRegistry } from './types.js';
import { TelnyxPhoneProvider } from './telnyx.js';
import { TwilioPhoneProvider } from './twilio.js';
import { GoogleTTSProvider } from '../services/tts.js';
import { GoogleSTTProvider } from '../services/stt.js';

export function createProviders(): ProviderRegistry {
    return {
        phone: process.env.CALLME_PHONE_PROVIDER === 'twilio' ? new TwilioPhoneProvider() : new TelnyxPhoneProvider(),
        tts: new GoogleTTSProvider(),
        stt: new GoogleSTTProvider(),
    };
}

export function initializeProviders(providers: ProviderRegistry) {
    const config = {
        phoneProvider: process.env.CALLME_PHONE_PROVIDER || 'telnyx',
        accountSid: process.env.CALLME_PHONE_ACCOUNT_SID,
        authToken: process.env.CALLME_PHONE_AUTH_TOKEN,
        phoneNumber: process.env.CALLME_PHONE_NUMBER,

        // GCP auto-auth
        ttsVoice: process.env.CALLME_TTS_VOICE || 'en-US-Journey-F',
        sttModel: process.env.CALLME_STT_MODEL || 'latest_long',
    };

    providers.phone.initialize(config);
    providers.tts.initialize(config);
    providers.stt.initialize(config);
}
