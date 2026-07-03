import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };
}

export function hasFirebaseClientConfig() {
  const config = firebaseConfig();
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export function getClientAuth() {
  if (!hasFirebaseClientConfig()) {
    throw new Error('Firebase client config is missing. Check NEXT_PUBLIC_FIREBASE_* env vars.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig());
  return getAuth(app);
}
