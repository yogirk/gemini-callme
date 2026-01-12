
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { TTSProvider } from '../providers/types.js';

export class GoogleTTSProvider implements TTSProvider {
    name = 'google-tts';
    private client: TextToSpeechClient | null = null;
    private voice: string = 'en-US-Journey-F'; // Default to a nice managed voice

    initialize(config: any): void {
        // Relies on GOOGLE_APPLICATION_CREDENTIALS or gcloud auth
        this.client = new TextToSpeechClient();
        if (config.ttsVoice) {
            this.voice = config.ttsVoice;
        }
    }

    async synthesize(text: string): Promise<Buffer> {
        if (!this.client) throw new Error('TTS client not initialized');

        const [response] = await this.client.synthesizeSpeech({
            input: { text },
            // Select the language and SSML voice gender (optional)
            voice: { languageCode: 'en-US', name: this.voice },
            // select the type of audio encoding
            audioConfig: { audioEncoding: 'MULAW', sampleRateHertz: 8000 },
        });

        if (!response.audioContent) {
            throw new Error('No audio content received from TTS');
        }

        return Buffer.from(response.audioContent);
    }
}
