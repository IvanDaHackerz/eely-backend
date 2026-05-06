import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

function tryParseJson(input: string): any | null {
    try {
        // Don't replace '\n' with actual newlines — JSON.parse expects escaped newlines inside strings.
        const trimmed = input.trim();
        // Remove wrapping quotes if present
        const unwrapped = trimmed.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        return JSON.parse(unwrapped);
    } catch (e) {
        return null;
    }
}

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!raw) return null;

    // 1) Try parsing as JSON (handles minified, multi-line with \n, or properly formatted JSON)
    let parsed = tryParseJson(raw);
    if (parsed) return parsed as admin.ServiceAccount;

    // 2) If the value looks like a file path, try to read and parse that file
    try {
        const maybePath = raw.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        const resolved = path.isAbsolute(maybePath) ? maybePath : path.resolve(process.cwd(), maybePath);
        if (fs.existsSync(resolved)) {
            const content = fs.readFileSync(resolved, 'utf8');
            parsed = tryParseJson(content);
            if (parsed) return parsed as admin.ServiceAccount;
        }
    } catch (e) {
        // fall through to final error
    }

    // 3) Final attempt: unescape double-escaped newline sequences
    parsed = tryParseJson(raw.replace(/\\\\n/g, '\\n'));
    if (parsed) return parsed as admin.ServiceAccount;

    throw new Error('Invalid Firebase service account JSON in FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS_JSON');
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
