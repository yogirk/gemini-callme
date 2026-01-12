
import { SpeechClient } from '@google-cloud/speech';
import { STTProvider, STTSession } from '../providers/types.js';

export class GoogleSTTProvider implements STTProvider {
    name = 'google-stt';
    private client: SpeechClient | null = null;
    private model: string = 'latest_long';

    initialize(config: any): void {
        // Relies on GOOGLE_APPLICATION_CREDENTIALS
        this.client = new SpeechClient();
        if (config.sttModel) {
            this.model = config.sttModel;
        }
    }

    createSession(): STTSession {
        if (!this.client) throw new Error('STT client not initialized');
        return new GoogleSTTSession(this.client, this.model);
    }
}

class GoogleSTTSession implements STTSession {
    private recognizeStream: any;
    private transcriptionResolve: ((text: string) => void) | null = null;
    private transcriptionReject: ((err: Error) => void) | null = null;
    private isConnected = false;

    // Buffer for handling final results
    private finalTranscript = '';

    constructor(private client: SpeechClient, private model: string) { }

    async connect(): Promise<void> {
        const request = {
            config: {
                encoding: 'MULAW' as const,
                sampleRateHertz: 8000,
                languageCode: 'en-US',
                enableAutomaticPunctuation: true,
                model: this.model,
                useEnhanced: true,
            },
            interimResults: false,
        };

        this.recognizeStream = this.client
            .streamingRecognize(request)
            .on('error', (error: Error) => {
                console.error('[GoogleSTT] Error:', error);
                if (this.transcriptionReject) {
                    this.transcriptionReject(error);
                    this.transcriptionReject = null;
                }
            })
            .on('data', (data: any) => {
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const result = data.results[0];
                    const transcript = result.alternatives[0].transcript;

                    // Verify if it is a final result
                    if (result.isFinal) {
                        console.error(`[GoogleSTT] Transcript: ${transcript}`);
                        if (this.transcriptionResolve) {
                            this.transcriptionResolve(transcript);
                            this.transcriptionResolve = null;
                            this.transcriptionReject = null;
                            // We only want one turn per session usage in Simple mode, or we can accumulate?
                            // For now, assume one utterance = one response wait.
                            // But streamingRecognize continues.
                            // We will need to reset the resolver for the next turn if we reused the stream.
                            // However, current architecture creates a new waitForTranscript promise each turn.
                        }
                    }
                }
            });

        this.isConnected = true;
    }

    sendAudio(audio: Buffer): void {
        if (this.isConnected && this.recognizeStream) {
            this.recognizeStream.write(audio);
        }
    }

    waitForTranscript(timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            this.transcriptionResolve = resolve;
            this.transcriptionReject = reject;

            // Timeout safety
            setTimeout(() => {
                if (this.transcriptionReject) {
                    // resolve with empty string or reject?
                    // Resolve empty means "no speech detected" which might be okay to loop prompt
                    console.error('[GoogleSTT] Timeout waiting for transcript');
                    resolve('');
                    this.transcriptionResolve = null;
                    this.transcriptionReject = null;
                }
            }, timeoutMs);
        });
    }

    close(): void {
        if (this.recognizeStream) {
            this.recognizeStream.end();
            this.recognizeStream.destroy();
            this.recognizeStream = null;
        }
        this.isConnected = false;
    }
}
