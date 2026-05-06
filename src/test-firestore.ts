import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
}

const db = admin.firestore();

const TARGET_UID = 'test-user-123';

async function main() {
    console.log('='.repeat(60));
    console.log('  FIRESTORE CONNECTION TEST');
    console.log('='.repeat(60));

    // Step 1: Get the account document
    console.log(`\n[1] Fetching account with uid: "${TARGET_UID}"...\n`);

    const accountDoc = await db.collection('accounts').doc(TARGET_UID).get();

    if (!accountDoc.exists) {
        console.log(`  ❌ No account found with uid "${TARGET_UID}".`);
        console.log('  Make sure this document exists in your Firestore "accounts" collection.');
        process.exit(1);
    }

    console.log('  ✅ Account found!');
    console.log('  Document ID:', accountDoc.id);
    const accountData = accountDoc.data()!;
    for (const [key, value] of Object.entries(accountData)) {
        console.log(`    ${key}:`, value);
    }

    // Step 2: Get all bills with matching account_id
    console.log(`\n[2] Fetching bills where account_id == "${TARGET_UID}"...\n`);

    const billsSnapshot = await db
        .collection('bills')
        .where('account_id', '==', TARGET_UID)
        .get();

    if (billsSnapshot.empty) {
        console.log('  ⚠️  No bills found for this account.');
        console.log('  Make sure documents in the "bills" collection have account_id set to', `"${TARGET_UID}".`);
    } else {
        console.log(`  ✅ Found ${billsSnapshot.size} bill(s):\n`);

        let index = 0;
        billsSnapshot.forEach((doc) => {
            index++;
            console.log(`  --- Bill #${index} ---`);
            console.log('  Document ID:', doc.id);
            const data = doc.data();
            for (const [key, value] of Object.entries(data)) {
                console.log(`    ${key}:`, value);
            }
            console.log('');
        });
    }

    console.log('='.repeat(60));
    console.log('  TEST COMPLETE');
    console.log('='.repeat(60));
}

main().catch((err) => {
    console.error('\n❌ Error connecting to Firestore:\n', err);
    process.exit(1);
});
