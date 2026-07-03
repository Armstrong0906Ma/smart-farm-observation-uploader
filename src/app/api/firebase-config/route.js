import { json } from '@/lib/http';

export function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return json({ error: 'Firebase client config is missing.' }, 500);
  }

  return json(config);
}
