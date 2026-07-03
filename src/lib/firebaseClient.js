import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

let configPromise;

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };
}

function hasRequiredConfig(config) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

async function loadFirebaseConfig() {
  const buildConfig = firebaseConfig();
  if (hasRequiredConfig(buildConfig)) return buildConfig;

  const response = await fetch('/api/firebase-config');
  if (!response.ok) {
    throw new Error('Firebase client config is missing. Check NEXT_PUBLIC_FIREBASE_* env vars.');
  }

  const runtimeConfig = await response.json();
  if (!hasRequiredConfig(runtimeConfig)) {
    throw new Error('Firebase client config is missing. Check NEXT_PUBLIC_FIREBASE_* env vars.');
  }

  return runtimeConfig;
}

export async function getClientAuth() {
  configPromise ||= loadFirebaseConfig();
  const config = await configPromise;
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  return getAuth(app);
}
