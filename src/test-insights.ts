import * as dotenv from 'dotenv';
dotenv.config();

import * as admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

import { generateInsights, fetchBillsForUser, InsightsWithJustifications } from './services/insights.service';
import { db } from './config/firebase';

const TARGET_UID = 'CElHujjEc5TSpV6JZB1DbbBKhl92';

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
    console.log('  EELY AI INSIGHTS GENERATOR - Test Runner');
    console.log('='.repeat(70));

    // ── Step 1: Fetch account ──────────────────────────────────────────────
    console.log(`\n[1] Fetching account: "${TARGET_UID}"...\n`);
    const accountDoc = await db.collection('accounts').doc(TARGET_UID).get();
    if (!accountDoc.exists) {
        console.error(`  [ERROR] No account found with uid "${TARGET_UID}"`);
        process.exit(1);
    }
    const account = accountDoc.data()!;
    console.log(`  [OK] Account: ${account.full_name} (${account.email})`);

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
        console.log(`     Generation:       PHP ${bill.generation}`);
        console.log(`     Distribution:     PHP ${bill.distribution}`);
        console.log(`     Transmission:     PHP ${bill.transmission}`);
        console.log(`     System Loss:      PHP ${bill.system_loss}`);
        console.log(`     Gov't Taxes:      PHP ${bill.government_taxes}`);
    }

    // ── Step 3: Run AI analysis ────────────────────────────────────────────
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`\n[3] Sending bill data to DeepSeek V3.1 (with Tavily web search)...\n`);
    console.log(`    The AI will use Tavily web search for current fuel prices,`);
    console.log(`    Meralco rates, and weather data to produce accurate`);
    console.log(`    insights WITH justifications and sources...\n`);

    const startTime = Date.now();
    const result: InsightsWithJustifications = await generateInsights(TARGET_UID);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  [OK] AI analysis complete (${elapsed}s)`);

    const { insights, justifications, grounding_sources } = result;

    // ── Section A: Consumption Profile ─────────────────────────────────────
    await pause('CONSUMPTION PROFILE');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  CONSUMPTION PROFILE`);
    console.log(`${'='.repeat(70)}`);

    const consumptionFields = [
        { key: 'total_kwh_used', label: 'Total kWh Used', fmt: (v: any) => `${v} kWh` },
        { key: 'avg_kwh_per_day', label: 'Avg kWh/Day', fmt: (v: any) => `${v} kWh` },
        { key: 'consumer_profile_class', label: 'Consumer Class', fmt: (v: any) => v },
        { key: 'efficiency_trend', label: 'Efficiency Trend', fmt: (v: any) => v },
        { key: 'monthly_consumption_trend', label: 'Monthly Trend', fmt: (v: any) => `${v}%` },
        { key: 'percentile_rank', label: 'Percentile Rank', fmt: (v: any) => `${v}/100` },
    ];

    for (const field of consumptionFields) {
        const value = (insights as any)[field.key];
        console.log(`\n  +-- ${field.label}: ${field.fmt(value)}`);
        console.log(`  |`);
        printJustification(field.key, justifications[field.key]);
        console.log(`  +${'─'.repeat(65)}`);
    }

    // ── Section B: Economic Sensitivity ────────────────────────────────────
    await pause('ECONOMIC SENSITIVITY / VOLATILITY RISK');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ECONOMIC SENSITIVITY / VOLATILITY RISK`);
    console.log(`${'='.repeat(70)}`);

    const economicFields = [
        { key: 'fuel_prices', label: 'Fuel Price (Coal)', fmt: (v: any) => `$${v}/ton` },
        { key: 'kwh_retail_price', label: 'kWh Retail Price', fmt: (v: any) => `PHP ${v}/kWh` },
        { key: 'temperature_impact', label: 'Temperature Impact', fmt: (v: any) => `PHP ${v}` },
        { key: 'estimated_bill_impact', label: 'Est. Bill Impact', fmt: (v: any) => `PHP ${v}` },
        { key: 'risk_level', label: 'Risk Level', fmt: (v: any) => String(v).toUpperCase() },
    ];

    for (const field of economicFields) {
        const value = (insights as any)[field.key];
        console.log(`\n  +-- ${field.label}: ${field.fmt(value)}`);
        console.log(`  |`);
        printJustification(field.key, justifications[field.key]);
        console.log(`  +${'─'.repeat(65)}`);
    }

    // ── Section C: Tavily Sources ──────────────────────────────────────────
    await pause('TAVILY WEB SEARCH SOURCES');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  TAVILY WEB SEARCH SOURCES`);
    console.log(`${'='.repeat(70)}`);

    if (grounding_sources.length > 0) {
        for (const source of grounding_sources) {
            console.log(`  - ${source}`);
        }
    } else {
        console.log(`  (No grounding metadata returned - sources are in justifications above)`);
    }

    // ── Step 6: Verify Firestore write ─────────────────────────────────────
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`\n[6] Verifying Firestore write...\n`);

    const savedDoc = await db.collection('insights').doc(TARGET_UID).get();
    if (savedDoc.exists) {
        console.log(`  [OK] Insights saved to Firestore: insights/${TARGET_UID}`);
        const savedData = savedDoc.data()!;
        console.log(`  [OK] Saved fields: ${Object.keys(savedData).join(', ')}`);
    } else {
        console.error(`  [ERROR] Failed to verify Firestore write!`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  DONE - Insights generated with full justifications.`);
    console.log(`${'='.repeat(70)}\n`);
}

main().catch((err) => {
    console.error('\n[ERROR] Error running insights pipeline:\n', err);
    process.exit(1);
});