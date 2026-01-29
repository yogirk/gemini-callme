import { startTunnel, Tunnel } from 'untun';

export interface TunnelConfig {
    port: number;
}

export class TunnelManager {
    private tunnel: Tunnel | null = null;
    private url: string | null = null;
    private config: TunnelConfig;

    constructor(config: TunnelConfig) {
        this.config = config;
    }

    async start(): Promise<string> {
        if (this.tunnel) {
            return this.url!;
        }

        const tunnel = await startTunnel({
            port: this.config.port,
            protocol: 'http',
            acceptCloudflareNotice: true,
        });

        if (!tunnel) {
            throw new Error('Failed to start tunnel');
        }

        this.tunnel = tunnel;
        this.url = await this.tunnel.getURL();
        return this.url;
    }

    getUrl(): string | null {
        return this.url;
    }

    async stop(): Promise<void> {
        if (this.tunnel) {
            await this.tunnel.close();
            this.tunnel = null;
            this.url = null;
        }
    }
}
