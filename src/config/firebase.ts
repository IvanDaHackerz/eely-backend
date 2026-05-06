import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!rawJson) {
        return null;
    }

    try {
        const normalized = rawJson.replace(/\\n/g, '\n');
        return JSON.parse(normalized) as admin.ServiceAccount;
    } catch (error) {
        throw new Error('Invalid Firebase service account JSON in FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS_JSON');
    }
}

// Preferred for Railway: set FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS_JSON).
// Local dev can still use GOOGLE_APPLICATION_CREDENTIALS pointing to a file.
if (!admin.apps.length) {
    const serviceAccount = getServiceAccountFromEnv();

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        admin.initializeApp({
            credential: admin.credential.applicationDefault()
        });
    }
}

const db = admin.firestore();

export { admin, db };
