/** Settings, read only from the environment (see .env.example). */
export interface Config {
  apiKey: string;
  /** Only set for a local fake of the API (the tests use one); the SDK defaults to the real API. */
  baseUrl: string;
  /** Optional: without it, responses carry no identity token and the app uses the installation header. */
  identitySecret: string | undefined;
  webhookSecret: string;
  /** One referral program ID in your configuration, never one per user. */
  referralProgramId: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiKey: required(env, 'CLIKGATE_API_KEY'),
    baseUrl: env.CLIKGATE_BASE_URL || 'https://api.clikgate.com',
    identitySecret: env.CLIKGATE_IDENTITY_SECRET || undefined,
    webhookSecret: required(env, 'CLIKGATE_WEBHOOK_SECRET'),
    referralProgramId: required(env, 'CLIKGATE_REFERRAL_PROGRAM_ID'),
    port: Number(env.PORT || 3000),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}
