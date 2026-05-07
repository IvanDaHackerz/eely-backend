import { Request, Response } from 'express';
import { admin, db } from '../config/firebase';
import AccountProfile from '../models/account.model';

function buildAccountFromAuth(uid: string, user: admin.auth.UserRecord): AccountProfile {
    const email = user.email ?? '';
    const displayName = user.displayName?.trim();
    const fallbackName = email ? email.split('@')[0] : 'User';

    return {
        uid,
        email,
        full_name: displayName && displayName.length > 0 ? displayName : fallbackName,
        createdAt: new Date(),
    };
}

export const createAccount = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid, email, full_name } = req.body;

        if (!uid || !email || !full_name) {
            res.status(400).json({ error: 'Missing required fields: uid, email, full_name' });
            return;
        }

        const accountData: AccountProfile = {
            uid,
            email,
            full_name,
            createdAt: new Date(),
        };

        // Create the document using uid as the document ID
        await db.collection('accounts').doc(uid).set({
            ...accountData,
            // Firestore specific Timestamp for createdAt
            createdAt: new Date()
        });

        res.status(201).json({ message: 'Account profile created successfully', data: accountData });
    } catch (error) {
        console.error('Error creating account profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAccount = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const doc = await db.collection('accounts').doc(uid).get();

        if (!doc.exists) {
            try {
                const authUser = await admin.auth().getUser(uid);
                const accountData = buildAccountFromAuth(uid, authUser);

                await db.collection('accounts').doc(uid).set({
                    ...accountData,
                    createdAt: new Date(),
                });

                res.status(200).json({ data: accountData, autoCreated: true });
                return;
            } catch (authError: any) {
                if (authError?.code === 'auth/user-not-found') {
                    res.status(404).json({ error: 'Account not found' });
                    return;
                }
                throw authError;
            }
        }

        res.status(200).json({ data: doc.data() });
    } catch (error) {
        console.error('Error fetching account profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
