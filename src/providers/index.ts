import { PhoneProvider, ProviderRegistry } from './types.js';
import { TelnyxPhoneProvider } from './telnyx.js';
import { VapiPhoneProvider } from './vapi.js';

export function createProviders(): ProviderRegistry {
    let phoneProvider: PhoneProvider;

    const provider = process.env.CALLME_PHONE_PROVIDER || 'vapi';

    switch (provider) {
        case 'telnyx':
            phoneProvider = new TelnyxPhoneProvider();
            phoneProvider.initialize({
                accountSid: process.env.CALLME_PHONE_ACCOUNT_SID,
                authToken: process.env.CALLME_PHONE_AUTH_TOKEN,
            });
            break;
        case 'vapi':
        default:
            phoneProvider = new VapiPhoneProvider();
            phoneProvider.initialize({
                apiKey: process.env.CALLME_VAPI_API_KEY,
                phoneNumberId: process.env.CALLME_VAPI_PHONE_NUMBER_ID,
            });
            break;
    }

    return {
        phone: phoneProvider,
    };
}

export function initializeProviders(_providers: ProviderRegistry) {
    // Initialization done in createProviders
}
