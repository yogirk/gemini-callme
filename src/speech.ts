import OpenAI from 'openai';
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface SpeechConfig {
  apiKey: string;
  voice: string;
}

export class SpeechService {
  private openai: OpenAI;
  private voice: string;

  constructor(config: SpeechConfig) {
    this.openai = new OpenAI({ apiKey: config.apiKey });
    this.voice = config.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  }

  /**
   * Convert text to speech, returns PCM audio buffer at 24kHz
   */
  async textToSpeech(text: string): Promise<Buffer> {
    const response = await this.openai.audio.speech.create({
      model: 'tts-1',
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'pcm',
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Create a realtime STT session for streaming audio
   */
  createRealtimeSession(): RealtimeSTTSession {
    return new RealtimeSTTSession(this.openai.apiKey);
  }
}

export class RealtimeSTTSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private transcript: string = '';
  private connected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        // Configure session for audio input only (no model response)
        this.ws?.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text'],
            input_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000,
            },
          },
        }));
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('close');
      });
    });

    return this.connectionPromise;
  }

  private handleEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed':
        this.transcript = (event.transcript as string) || '';
        this.emit('transcript', this.transcript);
        break;
      case 'input_audio_buffer.speech_started':
        this.emit('speech_started');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.emit('speech_stopped');
        break;
      case 'error':
        this.emit('error', new Error((event.error as { message?: string })?.message || 'Unknown error'));
        break;
    }
  }

  /**
   * Send audio chunk to the realtime session
   * Audio should be PCM16 at 24kHz mono
   */
  sendAudio(pcm16Base64: string): void {
    if (!this.connected || !this.ws) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: pcm16Base64,
    }));
  }

  /**
   * Commit the audio buffer and get transcription
   */
  commitAudio(): void {
    if (!this.connected || !this.ws) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.commit',
    }));
  }

  /**
   * Clear the audio buffer
   */
  clearAudio(): void {
    if (!this.connected || !this.ws) {
      return;
    }

    this.transcript = '';
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.clear',
    }));
  }

  /**
   * Get the current transcript
   */
  getTranscript(): string {
    return this.transcript;
  }

  /**
   * Wait for a transcript with timeout
   */
  async waitForTranscript(timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transcript timeout'));
      }, timeoutMs);

      const onTranscript = (transcript: string) => {
        clearTimeout(timeout);
        resolve(transcript);
      };

      this.once('transcript', onTranscript);
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connectionPromise = null;
  }
}
