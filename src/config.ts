export type Provider = 'twilio' | 'telnyx';

export interface Config {
  provider: Provider;
  userPhone: string;
  fromPhone: string;
  twilio?: {
    accountSid: string;
    authToken: string;
  };
  telnyx?: {
    apiKey: string;
    publicKey?: string;
  };
  openai: {
    apiKey: string;
  };

  port: number;
  voice: string;
  timeout: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function loadConfig(): Config {
  const provider = optional('GEMINICALL_PROVIDER', 'twilio') as Provider;

  if (provider !== 'twilio' && provider !== 'telnyx') {
    throw new Error(`Invalid provider: ${provider}. Must be 'twilio' or 'telnyx'`);
  }

  const config: Config = {
    provider,
    userPhone: required('GEMINICALL_USER_PHONE'),
    fromPhone: required('GEMINICALL_FROM_PHONE'),
    openai: {
      apiKey: required('GEMINICALL_OPENAI_API_KEY'),
    },

    port: parseInt(optional('GEMINICALL_PORT', '3333'), 10),
    voice: optional('GEMINICALL_VOICE', 'onyx'),
    timeout: parseInt(optional('GEMINICALL_TIMEOUT', '180000'), 10),
  };

  if (provider === 'twilio') {
    config.twilio = {
      accountSid: required('GEMINICALL_TWILIO_ACCOUNT_SID'),
      authToken: required('GEMINICALL_TWILIO_AUTH_TOKEN'),
    };
  } else {
    config.telnyx = {
      apiKey: required('GEMINICALL_TELNYX_API_KEY'),
      publicKey: process.env['GEMINICALL_TELNYX_PUBLIC_KEY'],
    };
  }

  return config;
}
