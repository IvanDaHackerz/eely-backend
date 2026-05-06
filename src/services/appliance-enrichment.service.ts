import { tavilyClient, ai, AI_MODEL } from '../config/gemini';

export interface ApplianceKwhExtraction {
    /** Typical kWh consumed when the appliance runs for one hour at normal load. */
    kwh: number;
    /** Short citation (URL or site name) from the search results. */
    source: string;
}

const MERALCO_RATE_URL =
    'https://company.meralco.com.ph/news-and-advisories/higher-residential-rates-april-2026#:~:text=MANILA%2C%20PHILIPPINES%2C%2010%20APRIL%202026,8161%20per%20kWh%20in%20March.';

function stripJsonFences(raw: string): string {
    let s = raw.trim();
    const jsonMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        s = jsonMatch[1].trim();
    }
    return s;
}

/**
 * Extract typical hourly kWh from Tavily snippets using the configured LLM.
 */
async function extractApplianceKwhWithAI(
    searchResults: string,
    applianceName: string,
): Promise<ApplianceKwhExtraction> {
    const prompt = `You are given web search snippets about this appliance: "${applianceName}".

Search results:
${searchResults}

Infer the typical electrical energy use when the appliance runs for one continuous hour at normal residential use (not standby). The field "kwh" must be that value in kWh for one hour of operation (e.g. 1500 W draw → 1.5 kWh). If sources give watts, convert: kWh per hour = watts / 1000.

Return ONLY valid JSON (no markdown, no commentary):
{
  "kwh": <positive number>,
  "source": <string — primary URL or domain from the snippets, or "search synthesis">
}`;

    console.log(`[ApplianceEnrichment] Extracting kWh with AI for "${applianceName}"...`);

    try {
        const response = await ai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a JSON-only API. Return raw JSON only, no markdown, no commentary. Use conservative typical values for residential appliances.',
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0,
            max_tokens: 400,
        });

        const rawText = response.choices[0]?.message?.content;
        if (!rawText) {
            throw new Error('AI returned empty response');
        }

        const jsonString = stripJsonFences(rawText);
        const parsed = JSON.parse(jsonString) as { kwh?: unknown; source?: unknown };

        const kwh = typeof parsed.kwh === 'number' ? parsed.kwh : Number(parsed.kwh);
        const source = typeof parsed.source === 'string' ? parsed.source : 'unknown';

        if (!Number.isFinite(kwh) || kwh <= 0) {
            throw new Error('Invalid or non-positive kwh in AI response');
        }

        return { kwh, source };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ApplianceEnrichment] AI extraction failed: ${message}`);
        throw new Error(`Failed to extract appliance kWh: ${message}`);
    }
}

/**
 * Search the web (Tavily) and extract typical hourly kWh for an appliance name.
 */
export async function fetchApplianceKwh(
    name: string,
    maxAttempts: number = 3,
): Promise<ApplianceKwhExtraction> {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('Appliance name is required');
    }

    const queries = [
        `${trimmed} typical power consumption kWh wattage Philippines`,
        `${trimmed} energy use watts per hour electricity`,
        `${trimmed} how many kWh per hour`,
    ];

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const query = queries[(attempt - 1) % queries.length];
        console.log(`[ApplianceEnrichment] Attempt ${attempt}/${maxAttempts}: "${query}"`);

        try {
            const searchResult = await tavilyClient.search(query, {
                maxResults: 5,
            });

            if (!searchResult.results || searchResult.results.length === 0) {
                throw new Error('No search results found');
            }

            const searchText = searchResult.results
                .map((r) => `[${r.title}] (${r.url}): ${r.content}`)
                .join('\n\n');

            const extracted = await extractApplianceKwhWithAI(searchText, trimmed);
            console.log(`[ApplianceEnrichment] OK: kwh=${extracted.kwh}, source=${extracted.source}`);
            return extracted;
        } catch (err: unknown) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[ApplianceEnrichment] Attempt ${attempt} failed: ${lastError.message}`);
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 1500));
            }
        }
    }

    throw lastError ?? new Error(`Failed to fetch kWh for appliance after ${maxAttempts} attempts`);
}

/**
 * Fetch Meralco residential rate_per_kwh from the exact user-provided URL only.
 */
export async function fetchMeralcoRatePerKwh(): Promise<number> {
    console.log(`[ApplianceEnrichment] Fetching rate_per_kwh from fixed Meralco URL...`);

    const response = await fetch(MERALCO_RATE_URL);
    if (!response.ok) {
        throw new Error(`Meralco page fetch failed: ${response.status}`);
    }

    const html = await response.text();

    // Prefer the explicit "overall rate ... Pxx.xxxx per kWh" value.
    const overallRateMatch = html.match(
        /overall rate[^.]{0,220}?[P₱]\s*([0-9]+(?:\.[0-9]+)?)\s*per\s*kWh/i,
    );
    const genericRateMatch = html.match(/[P₱]\s*([0-9]+(?:\.[0-9]+)?)\s*per\s*kWh/i);
    const rateMatch = overallRateMatch ?? genericRateMatch;
    if (!rateMatch) {
        throw new Error('Could not find rate_per_kwh in Meralco page content');
    }

    const ratePerKwh = Number(rateMatch[1]);
    if (!Number.isFinite(ratePerKwh) || ratePerKwh <= 0) {
        throw new Error('Invalid rate_per_kwh extracted from Meralco page');
    }

    console.log(`[ApplianceEnrichment] rate_per_kwh=${ratePerKwh}`);
    return ratePerKwh;
}
