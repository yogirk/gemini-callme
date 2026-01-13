import 'dotenv/config';
import http from 'http';
import ngrok from '@ngrok/ngrok';
import { createProviders, initializeProviders } from '../src/providers/index.js';
import { CallManager } from '../src/call-manager.js';

async function main() {
    const PORT = parseInt(process.env.CALLME_PORT || '3333', 10);

    console.log("Setting up providers...");
    const providers = createProviders();
    initializeProviders(providers);

    console.log("Starting Ngrok...");
    let publicUrl = '';
    try {
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken: process.env.CALLME_NGROK_AUTHTOKEN
        });
        publicUrl = listener.url() || '';
        console.log(`Ngrok tunnel established: ${publicUrl}`);
    } catch (e) {
        console.error('Failed to start ngrok:', e);
        process.exit(1);
    }

    const callManager = new CallManager(
        providers,
        publicUrl,
        process.env.CALLME_USER_PHONE_NUMBER || '',
        process.env.CALLME_PHONE_NUMBER || ''
    );

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        console.log(`[HTTP] ${req.method} ${url.pathname}`);

        if (req.method === 'POST' && url.pathname === '/webhooks/vapi') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk);
            const bodyStr = Buffer.concat(chunks).toString();
            console.log(`[HTTP] Body: ${bodyStr.substring(0, 500)}...`);

            let parsedBody: any = {};
            try {
                parsedBody = JSON.parse(bodyStr || '{}');
            } catch (e) {
                console.error("Failed to parse body", e);
            }
            await callManager.handleWebhook(parsedBody, res);
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        }
    });

    server.listen(PORT, async () => {
        console.log(`Server listening on port ${PORT}`);

        console.log("Initiating test call...");
        try {
            // 1. Start Call
            const { callId, transcript } = await callManager.initiateCall(
                "Hello! This is a test call from Gemini. How are you doing today?"
            );
            console.log(`\n[User said]: ${transcript}`);

            // 2. Respond
            console.log(`[Sending response...]`);
            const response2 = await callManager.continueCall(
                callId,
                "That's great to hear! This is a test of the two-way conversation. Is there anything you'd like to say?"
            );
            console.log(`[User said]: ${response2}`);

            // 3. End Call
            console.log(`[Ending call...]`);
            await callManager.endCall(callId, "Thank you for testing! Goodbye!");
            console.log("Call ended successfully.");

            setTimeout(() => process.exit(0), 5000);

        } catch (e) {
            console.error("Call failed:", e);
            process.exit(1);
        }
    });
}

main();
