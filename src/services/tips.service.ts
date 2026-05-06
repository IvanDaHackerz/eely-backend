import { ai, AI_MODEL } from '../config/gemini';
import { db } from '../config/firebase';
import * as admin from 'firebase-admin';

// --- Types -------------------------------------------------------------------

export interface TipItem {
    title: string;
    description: string;
}

interface TipsResult {
    tips: TipItem[];
    generated_at: string;
}

// --- Cache TTL ---------------------------------------------------------------

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- Cache invalidation (called by other services when data changes) ---------

/**
 * Deletes the cached tips for a user, forcing fresh generation on next request.
 * Call this when a new bill is added, or insights/predictions are regenerated.
 */
export async function invalidateTipsCache(uid: string): Promise<void> {
    try {
        await db.collection('tips').doc(uid).delete();
        console.log(`  [TIPS] Cache invalidated for uid="${uid}"`);
    } catch (e) {
        console.warn(`  [TIPS] Failed to invalidate cache for uid="${uid}":`, e);
    }
}

// --- DeepSeek call with retry ------------------------------------------------

async function callAIForTips(prompt: string): Promise<TipItem[]> {
    const maxRetries = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                const waitSec = attempt * 3;
                console.log(`  [TIPS RETRY] attempt ${attempt}/${maxRetries} - waiting ${waitSec}s...`);
                await new Promise((r) => setTimeout(r, waitSec * 1000));
            }

            console.log(`  [TIPS] Calling DeepSeek V3.1 (attempt ${attempt})...`);

            const response = await Promise.race([
                ai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [
                        { role: 'system', content: 'You are a JSON-only API. Return raw JSON arrays, no markdown, no commentary.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.3,
                    max_tokens: 800,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout waiting for AI')), 30000)
                ),
            ]);

            const rawText = response.choices[0]?.message?.content;

            if (!rawText) {
                throw new Error('AI returned an empty response');
            }

            let jsonString = rawText.trim();
            if (jsonString.startsWith('```')) {
                jsonString = jsonString.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
            }

            // Extract array if wrapped in extra text
            const firstBracket = jsonString.indexOf('[');
            const lastBracket = jsonString.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1) {
                jsonString = jsonString.substring(firstBracket, lastBracket + 1);
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(jsonString);
            } catch (err) {
                console.error('[TIPS ERROR] Failed to parse AI response as JSON.');
                console.error('Raw response:\n', rawText);
                throw new Error('AI did not return valid JSON');
            }

            if (!Array.isArray(parsed)) {
                throw new Error('AI response is not an array');
            }

            const tips: TipItem[] = (parsed as Array<Record<string, unknown>>)
                .filter((item) => typeof item.title === 'string' && typeof item.description === 'string')
                .map((item) => ({
                    title: item.title as string,
                    description: item.description as string,
                }))
                .slice(0, 5);

            if (tips.length === 0) {
                throw new Error('No valid tips found in AI response');
            }

            console.log(`  [TIPS OK] Generated ${tips.length} tips`);
            return tips;

        } catch (err: unknown) {
            lastError = err;
            const status = (err as { status?: number }).status;
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`  [TIPS WARN] Error (${status || message}).`);

            if (status && status !== 429 && status !== 503) {
                break;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('AI failed for tips generation');
}

// --- Context richness --------------------------------------------------------

interface UserContext {
    insightsData: Record<string, unknown> | null;
    predictionData: Record<string, unknown> | null;
    latestBill: Record<string, unknown> | null;
    billCount: number;
    appliances: Array<{ name: string; kwh: number; use_duration: number }>;
}

/**
 * Decide how many tips to generate based on how much real data we have.
 * - Thin context  (1 bill, no appliances, sparse insights): 3 tips
 * - Medium context (2+ bills OR has appliances OR has anomaly): 4 tips
 * - Rich context  (3+ bills AND appliances AND anomaly/surge): 5 tips
 */
function decideTipCount(ctx: UserContext): number {
    let score = 0;
    if (ctx.billCount >= 2) score++;
    if (ctx.billCount >= 3) score++;
    if (ctx.appliances.length > 0) score++;
    if (ctx.predictionData?.anomaly_detected) score++;
    if (ctx.predictionData?.seasonal_bill_surge_prediction) score++;
    if (ctx.insightsData?.efficiency_trend && ctx.insightsData.efficiency_trend !== 'unknown') score++;

    if (score >= 4) return 5;
    if (score >= 2) return 4;
    return 3;
}

// --- Build prompt ------------------------------------------------------------

function buildTipsPrompt(ctx: UserContext, targetCount: number): string {
    const sections: string[] = [];

    sections.push(`Energy advisor for Philippine Meralco consumer.`);

    if (ctx.billCount < 2 || !ctx.insightsData) {
        sections.push(`\nNOTE: Only ${ctx.billCount} bill(s). Keep tips practical and general.`);
    }

    if (ctx.insightsData) {
        const d = ctx.insightsData;
        sections.push(`\nINSIGHTS: class=${d.consumer_profile_class||'?'}, trend=${d.efficiency_trend||'?'} (${d.monthly_consumption_trend||0}%), avg=${d.avg_kwh_per_day||0}kWh/day, risk=${d.risk_level||'?'}`);
    }

    if (ctx.latestBill) {
        const b = ctx.latestBill;
        sections.push(`\nBILL: ₱${b.total_amount_due||0} for ${b.total_kwh_used||0}kWh`);
    }

    if (ctx.predictionData) {
        const p = ctx.predictionData;
        let pred = `PREDICTION: ${p.predicted_kwh_next||0}kWh / ₱${p.predicted_bill||0}`;
        if (p.anomaly_detected) pred += ` | ANOMALY: ${p.anomaly_description}`;
        sections.push(`\n${pred}`);
    }

    if (ctx.appliances.length > 0) {
        const list = ctx.appliances.map(a => `${a.name}(${a.kwh}kWh,${a.use_duration}hrs)`).join(', ');
        sections.push(`\nAPPLIANCES: ${list}`);
    } else {
        sections.push(`\nNo appliances registered. Give general tips only.`);
    }

    sections.push(`
Return ONLY a JSON array of exactly ${targetCount} objects. No markdown.
Each: { "title": "2-4 words", "description": "1-2 sentence actionable tip" }
${ctx.appliances.length === 0 ? 'Focus on general bill optimization.' : 'Tailor to user appliances.'}
${ctx.predictionData?.anomaly_detected ? 'One tip MUST address the anomaly.' : ''}`);

    return sections.join('\n');
}

// --- Fallback tips -----------------------------------------------------------

const FALLBACK_TIPS: TipItem[] = [
    { title: 'Track Peak Hours', description: 'Shift heavy appliance use outside 4PM-9PM to reduce demand charges on your next bill.' },
    { title: 'Unplug Standby Devices', description: 'Phantom loads from idle devices can add 5-10% to your monthly bill — unplug chargers and appliances when not in use.' },
    { title: 'Check Your Meter', description: 'Compare your meter reading against your bill to verify accuracy and catch any discrepancies early.' },
];

// --- Main entry point --------------------------------------------------------

export async function generateTips(uid: string): Promise<TipsResult> {
    // 1. Check cache
    const cachedDoc = await db.collection('tips').doc(uid).get();
    if (cachedDoc.exists) {
        const cached = cachedDoc.data();
        if (cached?.generated_at) {
            const generatedAt = cached.generated_at.toDate
                ? cached.generated_at.toDate()
                : new Date(cached.generated_at);
            const age = Date.now() - generatedAt.getTime();

            if (age < CACHE_TTL_MS && cached.tips && Array.isArray(cached.tips) && cached.tips.length >= 3) {
                console.log(`  [TIPS] Returning cached tips (age: ${Math.round(age / 60000)}min)`);
                return {
                    tips: cached.tips as TipItem[],
                    generated_at: generatedAt.toISOString(),
                };
            }
        }
    }

    // 2. Fetch user context from Firestore
    const ctx: UserContext = {
        insightsData: null,
        predictionData: null,
        latestBill: null,
        billCount: 0,
        appliances: [],
    };

    try {
        const insightsDoc = await db.collection('insights').doc(uid).get();
        if (insightsDoc.exists) ctx.insightsData = insightsDoc.data() as Record<string, unknown>;
    } catch (e) {
        console.warn('  [TIPS] Could not fetch insights:', e);
    }

    try {
        const predictionDoc = await db.collection('prediction').doc(uid).get();
        if (predictionDoc.exists) ctx.predictionData = predictionDoc.data() as Record<string, unknown>;
    } catch (e) {
        console.warn('  [TIPS] Could not fetch prediction:', e);
    }

    try {
        const billsSnap = await db.collection('accounts').doc(uid)
            .collection('bills')
            .orderBy('created_at', 'desc')
            .get();
        ctx.billCount = billsSnap.size;
        if (!billsSnap.empty) {
            ctx.latestBill = billsSnap.docs[0].data() as Record<string, unknown>;
        }
    } catch (e) {
        console.warn('  [TIPS] Could not fetch bills:', e);
    }

    try {
        const appSnap = await db.collection('prediction').doc(uid)
            .collection('appliances')
            .get();
        if (!appSnap.empty) {
            ctx.appliances = appSnap.docs.map((doc) => {
                const d = doc.data();
                return { name: d.name || 'Unknown', kwh: d.kwh || 0, use_duration: d.use_duration || 0 };
            });
        }
    } catch (e) {
        // Appliances subcollection might not exist
    }

    // 3. Decide how many tips to generate
    const targetCount = decideTipCount(ctx);
    console.log(`  [TIPS] Context: ${ctx.billCount} bill(s), ${ctx.appliances.length} appliance(s) → target ${targetCount} tips`);

    // 4. Build prompt and call DeepSeek
    const prompt = buildTipsPrompt(ctx, targetCount);
    let tips = await callAIForTips(prompt);

    // 5. Trim to target
    tips = tips.slice(0, targetCount);

    // 6. Enforce minimum of 3 tips
    if (tips.length < 3) {
        const needed = 3 - tips.length;
        const existingTitles = new Set(tips.map((t) => t.title));
        const extras = FALLBACK_TIPS.filter((t) => !existingTitles.has(t.title)).slice(0, needed);
        tips = [...tips, ...extras];
    }

    // 7. Cache to Firestore
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('tips').doc(uid).set({
        tips,
        account_id: uid,
        generated_at: now,
    });

    return {
        tips,
        generated_at: new Date().toISOString(),
    };
}
