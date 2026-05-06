import * as dotenv from 'dotenv';
dotenv.config();

import * as admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

import { generatePrediction, fetchAppliancesForUser, PredictionWithJustifications } from './services/prediction.service';
import { fetchBillsForUser } from './services/insights.service';
import { db } from './config/firebase';

const TARGET_UID = 'CElHujjEc5TSpV6JZB1DbbBKhl92';
const TARGET_LATITUDE = 14.649524251009174;
const TARGET_LONGITUDE = 121.11633988880733;

function printJustification(fieldName: string, justification: any) {
    if (!justification) {
        console.log(`    [!] No justification provided`);
        return;
    }
    console.log(`    Value:       ${justification.value}`);
    console.log(`    Reasoning:   ${justification.reasoning}`);
    console.log(`    Source:      ${justification.source}`);
    console.log(`    Method:      ${justification.methodology}`);
}

function pause(label: string): Promise<void> {
    return new Promise((resolve) => {
        process.stdout.write(`\n  >>> Press ENTER to see ${label} (or Ctrl+C to stop) `);
        process.stdin.setRawMode?.(false);
        process.stdin.resume();
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });
}

async function main() {
    console.log('='.repeat(70));
    console.log('  EELY AI PREDICTION GENERATOR - Test Runner');
    console.log('='.repeat(70));

    // ── Step 1: Fetch account ──────────────────────────────────────────────
    console.log(`\n[1] Fetching account: "${TARGET_UID}"...\n`);
    const accountDoc = await db.collection('accounts').doc(TARGET_UID).get();
    if (!accountDoc.exists) {
        console.error(`  [ERROR] No account found with uid "${TARGET_UID}"`);
        process.exit(1);
    }
    const account = accountDoc.data()!;
    console.log(`  [OK] Account: ${account.full_name || account.email} (${account.email})`);

    // ── Step 2: Fetch bills ────────────────────────────────────────────────
    console.log(`\n[2] Fetching bills for this account...\n`);
    const bills = await fetchBillsForUser(TARGET_UID);
    console.log(`  [OK] Found ${bills.length} bill(s)`);

    for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        console.log(`\n  -- Bill #${i + 1} (${bill._doc_id}) --`);
        console.log(`     Account Name:     ${bill.account_name}`);
        console.log(`     Period:           ${bill.start_date} -> ${bill.end_date}`);
        console.log(`     kWh Used:         ${bill.total_kwh_used}`);
        console.log(`     Total Due:        PHP ${bill.total_amount_due}`);
    }

    // ── Step 2b: Check for appliances ──────────────────────────────────────
    const appliances = await fetchAppliancesForUser(TARGET_UID);
    if (appliances.length > 0) {
        console.log(`\n  [INFO] Found ${appliances.length} appliance(s) in subcollection:`);
        for (const a of appliances) {
            console.log(`    - ${a.name} | ${a.kwh} kWh | ${a.use_duration} hrs/day | added: ${a.is_added} | price: ₱${a.price || 0}/mo`);
        }
    } else {
        console.log(`\n  [INFO] No appliances in subcollection.`);
    }

    // ── Step 3: Run AI prediction ──────────────────────────────────────────
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`\n[3] Sending bill data + appliances to DeepSeek V3.1 (single call)...\n`);

    const startTime = Date.now();
    const result: PredictionWithJustifications = await generatePrediction(TARGET_UID, TARGET_LATITUDE, TARGET_LONGITUDE);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  [OK] AI prediction complete (${elapsed}s)`);

    const { prediction, appliances: appAnalysis, appliance_total_monthly_cost, justifications, grounding_sources } = result;

    // ── Section A: Anomaly Detection ──────────────────────────────────────
    await pause('ANOMALY DETECTION');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ANOMALY DETECTION`);
    console.log(`${'='.repeat(70)}`);

    const anomalyFields = [
        { key: 'anomaly_detected', label: 'Anomaly Detected', fmt: (v: any) => v ? 'YES' : 'NO' },
        { key: 'anomaly_description', label: 'Description', fmt: (v: any) => v },
        { key: 'historical_baseline_kwh', label: 'Baseline kWh', fmt: (v: any) => `${v} kWh/month` },
    ];

    for (const field of anomalyFields) {
        const value = (prediction as any)[field.key];
        console.log(`\n  +-- ${field.label}: ${field.fmt(value)}`);
        console.log(`  |`);
        printJustification(field.key, justifications[field.key]);
        console.log(`  +${'─'.repeat(65)}`);
    }

    // ── Section B: Predictive Analytics ───────────────────────────────────
    await pause('PREDICTIVE ANALYTICS');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  PREDICTIVE ANALYTICS`);
    console.log(`${'='.repeat(70)}`);

    const predictiveFields = [
        { key: 'predicted_kwh_next', label: 'Predicted kWh (Next Month)', fmt: (v: any) => `${v} kWh` },
        { key: 'predicted_bill', label: 'Predicted Bill (Next Month)', fmt: (v: any) => `PHP ${v}` },
        { key: 'seasonal_bill_surge_prediction', label: 'Seasonal Surge Prediction', fmt: (v: any) => v },
        { key: 'kwh_change_prediction', label: 'kWh Change Prediction', fmt: (v: any) => `${v}%` },
    ];

    for (const field of predictiveFields) {
        const value = (prediction as any)[field.key];
        console.log(`\n  +-- ${field.label}: ${field.fmt(value)}`);
        console.log(`  |`);
        printJustification(field.key, justifications[field.key]);
        console.log(`  +${'─'.repeat(65)}`);
    }

    // ── Section C: Temperature-to-Power Correlation ───────────────────────
    await pause('TEMPERATURE-TO-POWER CORRELATION');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  TEMPERATURE-TO-POWER CORRELATION`);
    console.log(`${'='.repeat(70)}`);

    const weatherFields = [
        { key: 'location', label: 'Location', fmt: (v: any) => v },
        { key: 'city', label: 'City', fmt: (v: any) => v },
        { key: 'avg_temp', label: 'Avg Temperature', fmt: (v: any) => `${v}C` },
        { key: 'humidity', label: 'Humidity', fmt: (v: any) => `${v}%` },
        { key: 'temp_change', label: 'Temp Change (vs Last Month)', fmt: (v: any) => `${v > 0 ? '+' : ''}${v}C` },
    ];

    for (const field of weatherFields) {
        const value = (prediction as any)[field.key];
        console.log(`\n  +-- ${field.label}: ${field.fmt(value)}`);
        console.log(`  |`);
        printJustification(field.key, justifications[field.key]);
        console.log(`  +${'─'.repeat(65)}`);
    }

    // ── Section D: Appliance Analysis ─────────────────────────────────────
    if (appAnalysis && appAnalysis.length > 0) {
        await pause('APPLIANCE ANALYSIS');

        console.log(`\n${'='.repeat(70)}`);
        console.log(`  APPLIANCE ANALYSIS`);
        console.log(`${'='.repeat(70)}`);

        for (const a of appAnalysis) {
            console.log(`\n  +-- ${a.name}`);
            console.log(`  |   kWh:               ${a.kwh}`);
            console.log(`  |   Use Duration:       ${a.use_duration} hrs/day`);
            console.log(`  |   Added:              ${a.is_added}`);
            console.log(`  |   Est. Monthly Cost:  PHP ${a.estimated_monthly_cost}`);
            console.log(`  |   Efficiency:         ${a.energy_efficiency_rating}`);
            console.log(`  |   Recommendation:     ${a.recommendation}`);
            console.log(`  |   Details:            ${a.details}`);
            console.log(`  |   Source:             ${a.source}`);
            console.log(`  +${'─'.repeat(65)}`);
        }

        console.log(`\n  TOTAL APPLIANCE MONTHLY COST: PHP ${appliance_total_monthly_cost}`);
    }

    // ── Section E: Tavily Sources ─────────────────────────────────────────
    await pause('TAVILY WEB SEARCH SOURCES');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  TAVILY WEB SEARCH SOURCES`);
    console.log(`${'='.repeat(70)}`);

    if (grounding_sources.length > 0) {
        for (const source of grounding_sources) { console.log(`  - ${source}`); }
    } else {
        console.log(`  (No grounding metadata returned - sources are in justifications above)`);
    }

    // ── Step 7: Verify Firestore write ─────────────────────────────────────
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`\n[7] Verifying Firestore write...\n`);

    const savedDoc = await db.collection('prediction').doc(TARGET_UID).get();
    if (savedDoc.exists) {
        console.log(`  [OK] Prediction saved to Firestore: prediction/${TARGET_UID}`);
        const savedData = savedDoc.data()!;
        console.log(`  [OK] Saved fields: ${Object.keys(savedData).join(', ')}`);
    } else {
        console.error(`  [ERROR] Failed to verify Firestore write!`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  DONE - Prediction + Appliance analysis complete (single AI call).`);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((err) => {
    console.error('\n[ERROR] Error running prediction pipeline:\n', err);
    process.exit(1);
});
