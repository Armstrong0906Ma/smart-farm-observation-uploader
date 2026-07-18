import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function initAdmin() {
  if (getApps().length) return getApps()[0];

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
  }

  return initializeApp();
}

initAdmin();

export const adminAuth = getAuth();
