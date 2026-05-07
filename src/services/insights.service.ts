import * as admin from 'firebase-admin';
import { ai, AI_MODEL, tavilyClient } from '../config/gemini';
import { db } from '../config/firebase';

// ============================================================================
// INSIGHTS SERVICE
// ============================================================================
//
// Generates AI-powered energy consumption insights from a user's electricity
// bills. Uses DeepSeek V3.1 (via Together AI) for analysis and Tavily for
// real-time web data (fuel prices, Meralco rates, weather).
//
// ── HOW TO CALL FROM THE UI ─────────────────────────────────────────────────
//
// Option A: Via REST API (recommended for UI)
//   POST /api/insights/generate
//   Body: { "uid": "user-account-id" }
//   Returns: { insights, justifications, grounding_sources }
//
//   GET /api/insights/:uid
//   Returns: { data: <saved insights document from Firestore> }
//
// Option B: Direct import (for server-side or test usage)
//   import { generateInsights, getInsights } from './services/insights.service';
//   const result = await generateInsights('user-account-id');
//   const cached = await getInsights('user-account-id');
//
// ============================================================================

// --- Types -------------------------------------------------------------------

export interface BillDocument {
    [key: string]: any;
}

export interface FieldJustification {
    value: any;
    reasoning: string;
    source: string;
    methodology: string;
}

export interface InsightsResult {
    total_kwh_used: number;
    avg_kwh_per_day: number;
    consumer_profile_class: string;
    efficiency_trend: string;
    monthly_consumption_trend: number;
    fuel_prices: number;
    kwh_retail_price: number;
    risk_level: string;
    percentile_rank: number;
    latitude: number | null;
    longitude: number | null;
    generated_at?: any;
}

export interface InsightsWithJustifications {
    insights: InsightsResult;
    justifications: Record<string, FieldJustification>;
    grounding_sources: string[];
}

/**
 * Internal structure for extracted price data during validation.
 * Only the numeric value is stored in Firestore.
 */
interface ExtractedPriceData {
    value: number;
    unit: string;
    month: string;
    year: number;
    description: string;
    announcementDate?: string;
    source?: string;
}

/**
 * Device date information for search queries and validation
 */
interface DeviceDate {
    month: string;      // e.g., "January"
    year: number;       // e.g., 2026
    monthYear: string;  // e.g., "January 2026"
}

// --- Utility Functions -------------------------------------------------------

/**
 * Gets the current device date for search queries and validation
 * @returns DeviceDate object with month, year, and combined string
 */
function getDeviceDate(): DeviceDate {
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'long' });
    const year = now.getFullYear();
    const monthYear = `${month} ${year}`;
    
    return { month, year, monthYear };
}

/**
 * Extracts price data from search results using AI
 * @param searchResults - Raw text from Tavily search
 * @param priceType - Type of price being extracted
 * @param targetMonth - Expected month name
 * @param targetYear - Expected year
 * @returns Extracted and validated price data
 */
async function extractPriceDataWithAI(
    searchResults: string,
    priceType: 'kwh_retail' | 'fuel',
    targetMonth: string,
    targetYear: number
): Promise<ExtractedPriceData> {
    const priceLabel = priceType === 'kwh_retail'
        ? 'Meralco kWh retail price'
        : 'coal price';
    
    const prompt = `Extract the ${priceLabel} from the following search results.

Target month: ${targetMonth}
Target year: ${targetYear}

Search Results:
${searchResults}

Return ONLY valid JSON in this exact format (no markdown, no commentary):
{
  "value": <number - the price value only>,
  "unit": <string - e.g., "PHP/kWh" or "USD/ton">,
  "month": <string - e.g., "January">,
  "year": <number - e.g., 2026>,
  "announcementDate": <string - when was this price announced/reported, e.g., "March 10, 2026">,
  "source": <string - the website or organization, e.g., "company.meralco.com.ph" or "tradingeconomics.com">
}

Extract the announcement date and source from the search results.`;

    console.log(`     🤖 Extracting ${priceLabel} data with AI...`);
    
    try {
        const response = await ai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'You are a JSON-only API that extracts price data. Return raw JSON only, no markdown, no commentary.'
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0,
            max_tokens: 500,
        });

        const rawText = response.choices[0]?.message?.content;
        if (!rawText) {
            throw new Error('AI returned empty response');
        }

        // Parse JSON (handle markdown code blocks if present)
        let jsonString = rawText.trim();
        const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
        }

        const parsed = JSON.parse(jsonString);

        // Validate required fields
        if (!parsed.value || !parsed.unit || !parsed.month || !parsed.year) {
            throw new Error('Missing required fields in AI response');
        }

        // Construct description in the exact format required
        const currencySymbol = priceType === 'kwh_retail' ? 'P' : '$';
        const priceTypeName = priceType === 'kwh_retail' ? 'Meralco rate' : 'coal price';
        const announcementDate = parsed.announcementDate || 'recently';
        const source = parsed.source || 'official sources';
        
        const description = `The ${priceTypeName} for ${parsed.month} ${parsed.year} is ${currencySymbol}${parsed.value} per ${parsed.unit.split('/')[1] || 'unit'}, announced on ${announcementDate} from ${source}.`;

        return {
            value: Number(parsed.value),
            unit: String(parsed.unit),
            month: String(parsed.month),
            year: Number(parsed.year),
            description: description,
            announcementDate: parsed.announcementDate,
            source: parsed.source,
        };

    } catch (err: any) {
        console.error(`     ✗ AI extraction failed: ${err.message}`);
        throw err;
    }
}

// --- Fetch Bills -------------------------------------------------------------

export interface MonthlyReportEntry {
    month: string;
    bill: number;
    consumption: number;
}

export async function fetchBillsForUser(uid: string): Promise<BillDocument[]> {
    const snapshot = await db
        .collection('bills')
        .where('account_id', '==', uid)
        .get();

    if (snapshot.empty) {
        return [];
    }

    const bills: BillDocument[] = [];
    snapshot.forEach((doc) => {
        const data = doc.data();
        const cleaned: BillDocument = {};
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'object' && '_seconds' in value) {
                cleaned[key] = new Date((value as any)._seconds * 1000).toISOString().split('T')[0];
            } else {
                cleaned[key] = value;
            }
        }
        cleaned._doc_id = doc.id;
        bills.push(cleaned);
    });

    return bills;
}

// --- Fetch Insights ----------------------------------------------------------

export async function fetchInsightsForUser(uid: string): Promise<BillDocument> {
    const directDoc = await db.collection('insights').doc(uid).get();

    if (directDoc.exists) {
        const data = directDoc.data() ?? {};
        return { ...data, _doc_id: directDoc.id };
    }

    const fallbackSnapshot = await db
        .collection('insights')
        .where('account_id', '==', uid)
        .limit(1)
        .get();

    if (fallbackSnapshot.empty) {
        throw new Error(`No insights found for account_id "${uid}"`);
    }

    const doc = fallbackSnapshot.docs[0];
    return { ...doc.data(), _doc_id: doc.id };
}

// --- Monthly Report ----------------------------------------------------------

function getMonthLabelFromDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function getMonthSortKeyFromDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '0000-00';
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

export async function fetchMonthlyReportForUser(uid: string): Promise<MonthlyReportEntry[]> {
    const bills = await fetchBillsForUser(uid);

    const grouped = new Map<string, { month: string; bill: number; consumption: number }>();

    for (const bill of bills) {
        const monthSource = typeof bill.end_date === 'string' ? bill.end_date : bill.start_date;
        const monthLabel = getMonthLabelFromDate(monthSource);
        const monthKey = getMonthSortKeyFromDate(monthSource);
        const currentEntry = grouped.get(monthKey);
        const currentConsumption = currentEntry?.consumption ?? 0;
        const currentBill = currentEntry?.bill ?? 0;

        grouped.set(monthKey, {
            month: monthLabel,
            bill: currentBill + Number(bill.total_amount_due || 0),
            consumption: currentConsumption + Number(bill.total_kwh_used || 0),
        });
    }

    return Array.from(grouped.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([, value]) => ({
            month: value.month,
            bill: Number(value.bill.toFixed(2)),
            consumption: Number(value.consumption.toFixed(2)),
        }));
}

// --- Price Fetching Loops ----------------------------------------------------

/**
 * Fetches and extracts Meralco kWh retail price with retry logic
 * Starts searching from previous month (current month - 1)
 * @param deviceDate - Current device date for validation
 * @param maxAttempts - Maximum retry attempts (default: 5)
 * @returns Extracted price value, or fallback to 14.35 if all attempts fail
 */
async function fetchAndExtractKwhRetailPrice(
    deviceDate: DeviceDate,
    maxAttempts: number = 5
): Promise<ExtractedPriceData> {
    console.log(`\n  ⚡ Fetching Meralco kWh retail price (always starting from previous month)...`);
    
    // Base date for calculations (current month)
    const baseDate = new Date(deviceDate.year, new Date(`${deviceDate.month} 1, ${deviceDate.year}`).getMonth(), 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`     Attempt ${attempt}/${maxAttempts}`);
            
            // Calculate target month: always start from previous month (current - attempt)
            const targetDate = new Date(baseDate);
            targetDate.setMonth(baseDate.getMonth() - attempt);
            
            const targetMonth = targetDate.toLocaleString('en-US', { month: 'long' });
            const targetYear = targetDate.getFullYear();
            const targetMonthYear = `${targetMonth} ${targetYear}`;
            
            // Build search query
            const query = `${targetMonthYear} Meralco kwh retail price`;
            console.log(`     🔍 Searching: "${query}"`);
            
            // Perform Tavily search with domain restriction
            const searchResult = await tavilyClient.search(query, {
                maxResults: 3,
                includeDomains: ['company.meralco.com.ph']
            });
            
            if (!searchResult.results || searchResult.results.length === 0) {
                throw new Error('No search results found');
            }
            
            console.log(`     ✓ Found ${searchResult.results.length} result(s)`);
            
            // Output search results
            console.log('\n     ═══════════════════════════════════════════════════════════════');
            console.log('     MERALCO SEARCH RESULTS:');
            console.log('     ═══════════════════════════════════════════════════════════════');
            searchResult.results.forEach((result, idx) => {
                console.log(`\n     Result ${idx + 1}:`);
                console.log(`     Title: ${result.title}`);
                console.log(`     URL: ${result.url}`);
                console.log(`     Content: ${result.content}`);
                console.log('     ───────────────────────────────────────────────────────────────');
            });
            console.log('     ═══════════════════════════════════════════════════════════════\n');
            
            // Format search results for AI
            const searchText = searchResult.results
                .map(r => `[${r.title}] (${r.url}): ${r.content}`)
                .join('\n\n');
            
            // Extract data with AI for the SPECIFIC month we searched for
            const extracted = await extractPriceDataWithAI(
                searchText,
                'kwh_retail',
                targetMonth,
                targetYear
            );
            
            // Validate: Accept if data matches the search target OR if it's the last attempt
            const searchMonthMatch = extracted.month.toLowerCase() === targetMonth.toLowerCase();
            const searchYearMatch = extracted.year === targetYear;
            const isLastAttempt = attempt === maxAttempts;
            
            // Check if extracted data is reasonably recent (within same year or last year)
            const isRecentData = extracted.year >= deviceDate.year - 1;
            
            if (searchMonthMatch && searchYearMatch) {
                if (attempt === 1) {
                    console.log(`     ✓ Exact match: ${extracted.month} ${extracted.year}`);
                } else {
                    console.log(`     ✓ Found data from ${attempt - 1} month(s) ago: ${extracted.month} ${extracted.year}`);
                }
                console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
                console.log(`     ℹ️  ${extracted.description}`);
                return extracted;
            } else if (isLastAttempt && isRecentData) {
                // On last attempt, accept most recent available data
                console.log(`     ✓ Using most recent available data: ${extracted.month} ${extracted.year}`);
                console.log(`     ℹ️  Searched for ${targetMonth} ${targetYear}, but using latest available`);
                console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
                console.log(`     ℹ️  ${extracted.description}`);
                return extracted;
            } else {
                console.warn(`     ✗ Month/year mismatch: got ${extracted.month} ${extracted.year}, expected ${targetMonth} ${targetYear}`);
                if (attempt < maxAttempts) {
                    console.log(`     ⏳ Retrying with previous month in 2 seconds...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
        } catch (err: any) {
            console.error(`     ✗ Attempt ${attempt} failed: ${err.message}`);
            if (attempt < maxAttempts) {
                console.log(`     ⏳ Retrying in 2 seconds...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    
    // All attempts failed - use fallback value (reflecting the previous month)
    const fallbackDate = new Date(baseDate);
    fallbackDate.setMonth(baseDate.getMonth() - 1);
    const fallbackMonth = fallbackDate.toLocaleString('en-US', { month: 'long' });
    const fallbackYear = fallbackDate.getFullYear();

    console.warn(`     ⚠️  All ${maxAttempts} attempts failed. Using fallback value: 14.35 PHP/kWh`);
    return {
        value: 14.35,
        unit: 'PHP/kWh',
        month: fallbackMonth,
        year: fallbackYear,
        description: `The Meralco rate for ${fallbackMonth} ${fallbackYear} is P14.35 per kWh, announced on recently from official sources.`,
        announcementDate: 'recently',
        source: 'official sources'
    };
}

/**
 * Fetches and extracts coal fuel prices with retry logic
 * @param deviceDate - Current device date for validation
 * @param maxAttempts - Maximum retry attempts (default: 3)
 * @returns Extracted price value
 */
async function fetchAndExtractFuelPrices(
    deviceDate: DeviceDate,
    maxAttempts: number = 3
): Promise<ExtractedPriceData> {
    console.log(`\n  ⛏️  Fetching coal prices for ${deviceDate.monthYear}...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`     Attempt ${attempt}/${maxAttempts}`);
            
            // Calculate target month based on attempt (try current month, then previous months)
            const targetDate = new Date(deviceDate.year, new Date(`${deviceDate.month} 1, ${deviceDate.year}`).getMonth());
            targetDate.setMonth(targetDate.getMonth() - (attempt - 1));
            const targetMonth = targetDate.toLocaleString('en-US', { month: 'long' });
            const targetYear = targetDate.getFullYear();
            const targetMonthYear = `${targetMonth} ${targetYear}`;
            
            // Build search query
            const query = `${targetMonthYear} Coal prices`;
            console.log(`     🔍 Searching: "${query}"`);
            
            // Perform Tavily search with domain restriction
            const searchResult = await tavilyClient.search(query, {
                maxResults: 3,
                includeDomains: ['tradingeconomics.com']
            });
            
            if (!searchResult.results || searchResult.results.length === 0) {
                throw new Error('No search results found');
            }
            
            console.log(`     ✓ Found ${searchResult.results.length} result(s)`);
            
            // Format search results for AI
            const searchText = searchResult.results
                .map(r => `[${r.title}] (${r.url}): ${r.content}`)
                .join('\n\n');
            
            // Extract data with AI
            const extracted = await extractPriceDataWithAI(
                searchText,
                'fuel',
                deviceDate.month,
                deviceDate.year
            );
            
            // Validate: Accept if data matches the search target OR if it's the last attempt
            const searchMonthMatch = extracted.month.toLowerCase() === targetMonth.toLowerCase();
            const searchYearMatch = extracted.year === targetYear;
            const isLastAttempt = attempt === maxAttempts;
            
            // Check if extracted data is reasonably recent (within same year or last year)
            const isRecentData = extracted.year >= deviceDate.year - 1;
            
            if (searchMonthMatch && searchYearMatch) {
                if (attempt === 1) {
                    console.log(`     ✓ Exact match: ${extracted.month} ${extracted.year}`);
                } else {
                    console.log(`     ✓ Found data from ${attempt - 1} month(s) ago: ${extracted.month} ${extracted.year}`);
                }
                console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
                console.log(`     ℹ️  ${extracted.description}`);
                return extracted;
            } else if (isLastAttempt && isRecentData) {
                // On last attempt, accept most recent available data
                console.log(`     ✓ Using most recent available data: ${extracted.month} ${extracted.year}`);
                console.log(`     ℹ️  Searched for ${targetMonth} ${targetYear}, but using latest available`);
                console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
                console.log(`     ℹ️  ${extracted.description}`);
                return extracted;
            } else {
                console.warn(`     ✗ Month/year mismatch: got ${extracted.month} ${extracted.year}, expected ${targetMonth} ${targetYear}`);
                if (attempt < maxAttempts) {
                    console.log(`     ⏳ Retrying with previous month in 2 seconds...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
        } catch (err: any) {
            console.error(`     ✗ Attempt ${attempt} failed: ${err.message}`);
            if (attempt < maxAttempts) {
                console.log(`     ⏳ Retrying in 2 seconds...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
    
    // All attempts failed
    throw new Error(`Failed to fetch fuel prices after ${maxAttempts} attempts`);
}

// --- Build Prompt ------------------------------------------------------------

export function buildInsightsPrompt(
    bills: BillDocument[],
    kwhRetailPrice: number,
    fuelPrice: number,
    locationLabel: string
): string {
    const billCount = bills.length;
    const sortedBills = [...bills].sort((a, b) =>
        new Date(a.start_date || a.end_date || 0).getTime() -
        new Date(b.start_date || b.end_date || 0).getTime()
    );
    const billsJson = JSON.stringify(sortedBills, null, 2);
    const kwhList = billCount > 0
        ? sortedBills.map(b => `${b.start_date}: ${b.total_kwh_used} kWh`).join(', ')
        : 'No bills uploaded yet';

    return `Expert Philippine electricity analyst. Analyze ${billCount > 0 ? `ALL ${billCount} Meralco bill(s)` : 'the user situation (no bills uploaded yet)'}.

${billCount > 0 ? `IMPORTANT: There are exactly ${billCount} bill(s). You MUST use ALL of them.
Bill kWh chronologically: [${kwhList}]

BILLS:
${billsJson}` : 'No bills uploaded. Use generic Filipino household estimates (~200 kWh/month).'}

════════════════════════════════════════════════
CURRENT ENERGY MARKET DATA:
- Meralco kWh Retail Price: ${kwhRetailPrice} PHP/kWh
- Coal Fuel Price: ${fuelPrice} USD/ton
════════════════════════════════════════════════

Location: ${locationLabel}

Return JSON with "insights" and "justifications" keys ONLY. No markdown.

"insights": {
  "total_kwh_used": number,
  "avg_kwh_per_day": number,
  "consumer_profile_class": "Low"|"Medium"|"High",
  "efficiency_trend": "improving"|"declining"|"stable",
  "monthly_consumption_trend": number (% change, most recent two bills),
  "fuel_prices": ${fuelPrice},
  "kwh_retail_price": ${kwhRetailPrice},
  "risk_level": "low"|"moderate"|"high" (Derive from price trends. If prices are rising or volatile, risk is higher.),
  "percentile_rank": number 0–100
}

"justifications": keyed by field, each: {
  "value": <same as insights field>,
  "reasoning": "up to 2 short sentence with simple math if applicable",
  "source": "cite specific data source or 'calculation'",
  "methodology": "direct_calculation"|"classification_rule"|"web_search"|"estimation"|"trend_analysis"
}`;
}

// --- Call DeepSeek -----------------------------------------------------------

export async function callAIForInsights(prompt: string): Promise<InsightsWithJustifications & { grounding_sources: string[] }> {
    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                const waitSec = attempt * 3;
                console.log(`  [RETRY] attempt ${attempt}/${maxRetries} - waiting ${waitSec}s...`);
                await new Promise((r) => setTimeout(r, waitSec * 1000));
            }

            console.log(`  🤖 Sending prompt to DeepSeek V3.1...`);
            console.log(`     Model: ${AI_MODEL}`);
            console.log(`     Max tokens: 2000 | Temperature: 0.1`);

            const response = await Promise.race([
                ai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [
                        { role: 'system', content: 'You are a JSON-only API. Return raw JSON, no markdown, no commentary.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0,
                    max_tokens: 2000,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout waiting for AI')), 60000)
                ),
            ]);

            const rawText = response.choices[0]?.message?.content;

            if (!rawText) {
                throw new Error('AI returned an empty response');
            }

            let jsonString = rawText.trim();
            const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                jsonString = jsonMatch[1].trim();
            } else {
                const firstBrace = jsonString.indexOf('{');
                const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                }
            }

            let parsed: any;
            try {
                parsed = JSON.parse(jsonString);
            } catch (err) {
                console.error('[ERROR] Failed to parse AI response as JSON.');
                console.error('Raw response:\n', rawText);
                throw new Error('AI did not return valid JSON');
            }

            if (!parsed.insights || !parsed.justifications) {
                if (parsed.total_kwh_used !== undefined) {
                    console.warn('  [WARN] AI returned flat structure - wrapping...');
                    parsed = { insights: parsed, justifications: {} };
                } else {
                    throw new Error('Response missing "insights" or "justifications" keys');
                }
            }

            const requiredFields = [
                'total_kwh_used', 'avg_kwh_per_day', 'consumer_profile_class',
                'efficiency_trend', 'monthly_consumption_trend', 'fuel_prices',
                'kwh_retail_price', 'risk_level', 'percentile_rank',
            ];

            const stringFields = new Set(['consumer_profile_class', 'efficiency_trend', 'risk_level']);

            for (const field of requiredFields) {
                if (parsed.insights[field] === undefined || parsed.insights[field] === null) {
                    console.warn(`  [WARN] Missing field "${field}" in AI response, defaulting`);
                    parsed.insights[field] = stringFields.has(field) ? 'unknown' : 0;
                }
            }

            return {
                insights: parsed.insights as InsightsResult,
                justifications: parsed.justifications || {},
                grounding_sources: [],
            };

        } catch (err: any) {
            lastError = err;
            const isRetryable =
                err?.status === 429 || err?.status === 503 ||
                err?.message?.includes('empty response') ||
                err?.message?.includes('valid JSON') ||
                err?.message?.includes('Timeout');

            if (isRetryable && attempt < maxRetries) {
                console.warn(`  [WARN] Error (${err?.status || err?.message}).`);
                continue;
            }
            throw err;
        }
    }

    throw lastError;
}

// --- Save to Firestore -------------------------------------------------------

const INSIGHTS_DESCRIPTION_FIELDS = [
    'consumer_profile_class', 'efficiency_trend', 'monthly_consumption_trend',
    'total_kwh_used', 'avg_kwh_per_day', 'fuel_prices', 'kwh_retail_price', 'risk_level',
];

export async function saveInsights(
    uid: string,
    insights: InsightsResult,
    justifications: Record<string, FieldJustification>,
): Promise<void> {
    const docData: any = {
        ...insights,
        account_id: uid,
        latitude: insights.latitude ?? null,
        longitude: insights.longitude ?? null,
        generated_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    for (const field of INSIGHTS_DESCRIPTION_FIELDS) {
        const justification = justifications[field];
        docData[`${field}_description`] = justification?.reasoning || '';
    }

    await db.collection('insights').doc(uid).set(docData, { merge: true });
}

// --- Get Cached Insights -----------------------------------------------------

export async function getInsights(uid: string): Promise<InsightsResult | null> {
    const doc = await db.collection('insights').doc(uid).get();
    if (!doc.exists) return null;
    return doc.data() as InsightsResult;
}

// --- Status Updates ----------------------------------------------------------

export async function updateStatus(uid: string, feature: 'insights' | 'prediction', message: string) {
    try {
        await db.collection('user_status').doc(uid).set({
            [feature]: message,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.error(`Failed to update ${feature} status:`, e);
    }
}

// --- Full Pipeline -----------------------------------------------------------

export async function generateInsights(
    uid: string,
    latitude: number | null = null,
    longitude: number | null = null,
): Promise<InsightsWithJustifications> {
    console.log(`\n  📋 Step 1/8: Fetching historical utility bills...`);
    await updateStatus(uid, 'insights', 'Fetching historical utility bills...');
    const bills = await fetchBillsForUser(uid);
    console.log(`     ✓ Found ${bills.length} bill(s)`);

    // ── Auto-resolve coordinates from prediction doc if not provided ──
    if (latitude === null || longitude === null) {
        console.log(`\n  📍 Step 2/8: Resolving user location...`);
        await updateStatus(uid, 'insights', 'Resolving user location...');
        try {
            const predDoc = await db.collection('prediction').doc(uid).get();
            if (predDoc.exists) {
                const predData = predDoc.data();
                if (predData?.latitude && predData?.longitude) {
                    latitude = predData.latitude;
                    longitude = predData.longitude;
                    console.log(`     ✓ Location from prediction: ${latitude}, ${longitude}`);
                }
            }
        } catch (e) {
            console.warn(`     ⚠️ Could not fetch prediction for coordinates`);
        }

        if (latitude === null || longitude === null) {
            // Fallback to hardcoded default (Metro Manila)
            latitude = 14.5995;
            longitude = 120.9842;
            console.log(`     ℹ️ Using default Manila coordinates: ${latitude}, ${longitude}`);
        }
    } else {
        console.log(`\n  📍 Step 2/8: Using provided coordinates: ${latitude}, ${longitude}`);
    }

    const locationDesc = `${latitude},${longitude}`;
    const locationLabel = `Coordinates: ${locationDesc}`;

    // ── Get device date ──
    console.log(`\n  📅 Step 3/8: Getting device date...`);
    const deviceDate = getDeviceDate();
    console.log(`     ✓ Device date: ${deviceDate.monthYear}`);

    // ── Fetch kWh retail price ──
    console.log(`\n  ⚡ Step 4/8: Fetching current Meralco kWh retail price...`);
    await updateStatus(uid, 'insights', 'Fetching current Meralco kWh retail price...');
    const kwhRetailPriceData = await fetchAndExtractKwhRetailPrice(deviceDate);
    console.log(`     ✓ kWh retail price: ${kwhRetailPriceData.value}`);

    // ── Fetch fuel prices ──
    console.log(`\n  ⛏️  Step 5/8: Fetching current coal prices...`);
    await updateStatus(uid, 'insights', 'Fetching current coal prices...');
    const fuelPriceData = await fetchAndExtractFuelPrices(deviceDate);
    console.log(`     ✓ Fuel price: ${fuelPriceData.value}`);

    // ── Build prompt ──
    console.log(`\n  📝 Step 6/8: Building AI analysis prompt...`);
    await updateStatus(uid, 'insights', 'Preparing data for AI analysis...');
    const prompt = buildInsightsPrompt(bills, kwhRetailPriceData.value, fuelPriceData.value, locationLabel);
    console.log(`     ✓ Prompt built (${prompt.length} chars)`);

    // ── Generate insights ──
    console.log(`\n  🧠 Step 7/8: Generating AI insights...`);
    await updateStatus(uid, 'insights', 'Generating AI insights...');
    const startAI = Date.now();
    const result = await callAIForInsights(prompt);
    const aiElapsed = ((Date.now() - startAI) / 1000).toFixed(1);
    console.log(`     ✓ AI response received (${aiElapsed}s)`);

    result.insights.latitude = latitude;
    result.insights.longitude = longitude;
    result.grounding_sources = [
        kwhRetailPriceData.description,
        fuelPriceData.description
    ];

    // Add price descriptions to justifications
    result.justifications.kwh_retail_price = {
        value: kwhRetailPriceData.value,
        reasoning: kwhRetailPriceData.description,
        source: kwhRetailPriceData.source || 'company.meralco.com.ph',
        methodology: 'web_search'
    };
    
    result.justifications.fuel_prices = {
        value: fuelPriceData.value,
        reasoning: fuelPriceData.description,
        source: fuelPriceData.source || 'tradingeconomics.com',
        methodology: 'web_search'
    };

    // ── Save to Firestore ──
    console.log(`\n  💾 Step 8/8: Saving insights to Firestore...`);
    await updateStatus(uid, 'insights', 'Saving insights securely...');
    await saveInsights(uid, result.insights, result.justifications);
    console.log(`     ✓ Saved to insights/${uid}`);

    await updateStatus(uid, 'insights', 'Done');
    console.log(`\n  ✅ Insights generation complete!`);
    return result;
}