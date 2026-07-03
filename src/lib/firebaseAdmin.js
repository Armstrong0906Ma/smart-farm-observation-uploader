import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';

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

export const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
});
