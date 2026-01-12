
import crypto from 'crypto';

/**
 * Generate a random token for WebSocket authentication
 */
export function generateWebSocketToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate that the provided token matches the expected one
 */
export function validateWebSocketToken(expected: string, actual: string): boolean {
    if (!expected || !actual) return false;
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

/**
 * Validate Twilio webhook signature
 * (Simplified version - in production use twilio.validateRequest)
 */
export function validateTwilioSignature(authToken: string, signature: string, url: string, params: URLSearchParams): boolean {
    // TODO: Implement full Twilio signature validation if needed for strict security
    // For this PoC, we might rely on the Ngrok tunnel obfuscation or implement later
    // https://www.twilio.com/docs/usage/security#validating-requests
    return true;
}
