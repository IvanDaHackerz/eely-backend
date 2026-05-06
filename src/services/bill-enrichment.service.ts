import { tavilyClient, ai, AI_MODEL } from '../config/gemini';
import { db } from '../config/firebase';

interface WeatherData {
    avg_temperature: number;
    avg_humidity: number;
    latitude: number;
    longitude: number;
}

interface ExtractedPriceData {
    value: number;
    unit: string;
    month: string;
    year: number;
    announcementDate?: string;
    source: string;
    description: string;
}

/**
 * Fetch average temperature for billing period using Open-Meteo Archive API
 */
export async function fetchWeatherData(
    startDate: string, // YYYY-MM-DD
    endDate: string,   // YYYY-MM-DD
    latitude: number,
    longitude: number
): Promise<WeatherData> {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_mean,relative_humidity_2m_mean&timezone=Asia/Manila`;

    console.log(`[Weather] Fetching weather data: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Weather API failed: ${response.status}`);
    }

    const data = await response.json();
    const temperatures = data.daily?.temperature_2m_mean || [];
    const humidities = data.daily?.relative_humidity_2m_mean || [];

    if (temperatures.length === 0) {
        throw new Error('No temperature data available for the specified period');
    }

    if (humidities.length === 0) {
        throw new Error('No humidity data available for the specified period');
    }

    // Calculate average temperature
    const tempSum = temperatures.reduce((acc: number, temp: number) => acc + temp, 0);
    const avg_temperature = Math.round((tempSum / temperatures.length) * 100) / 100;

    // Calculate average humidity
    const humiditySum = humidities.reduce((acc: number, humidity: number) => acc + humidity, 0);
    const avg_humidity = Math.round((humiditySum / humidities.length) * 100) / 100;

    console.log(`[Weather] Average temperature: ${avg_temperature}°C`);
    console.log(`[Weather] Average humidity: ${avg_humidity}%`);

    return { avg_temperature, avg_humidity, latitude, longitude };
}

/**
 * Extracts coal price data from search results using AI
 * Same pattern as insights.service.ts extractPriceDataWithAI
 */
async function extractCoalPriceWithAI(
    searchResults: string,
    targetMonth: string,
    targetYear: number
): Promise<ExtractedPriceData> {
    const prompt = `Extract the coal price from the following search results.

Target month: ${targetMonth}
Target year: ${targetYear}

Search Results:
${searchResults}

Return ONLY valid JSON in this exact format (no markdown, no commentary):
{
  "value": <number - the price value only>,
  "unit": <string - must be "USD/ton">,
  "month": <string - e.g., "January">,
  "year": <number - e.g., 2026>,
  "announcementDate": <string - when was this price announced/reported, e.g., "March 10, 2026">,
  "source": <string - the website or organization, e.g., "tradingeconomics.com">
}

Extract the announcement date and source from the search results.`;

    console.log(`     🤖 Extracting coal price data with AI...`);

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

        // Construct description
        const announcementDate = parsed.announcementDate || 'recently';
        const source = parsed.source || 'official sources';

        const description = `Coal price of $${parsed.value}/ton for ${parsed.month} ${parsed.year} was announced ${announcementDate} via ${source}`;

        return {
            value: parsed.value,
            unit: parsed.unit,
            month: parsed.month,
            year: parsed.year,
            announcementDate: parsed.announcementDate,
            source: parsed.source,
            description,
        };
    } catch (err: any) {
        console.error(`     ✗ AI extraction failed: ${err.message}`);
        throw new Error(`Failed to extract coal price: ${err.message}`);
    }
}

/**
 * Fetch coal price for the billing month using Tavily search + AI extraction
 * Exact pattern from insights.service.ts fetchAndExtractFuelPrices
 */
export async function fetchCoalPrice(
    startDate: string,
    maxAttempts: number = 3
): Promise<ExtractedPriceData> {
    // Extract year and month from start date
    const date = new Date(startDate);
    const year = date.getFullYear();
    const month = date.toLocaleString('en-US', { month: 'long' });

    console.log(`\n  ⛏️  Fetching coal prices for ${month} ${year}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`     Attempt ${attempt}/${maxAttempts}`);

            // Calculate target month based on attempt (try current month, then previous months)
            const targetDate = new Date(year, new Date(`${month} 1, ${year}`).getMonth());
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
            const extracted = await extractCoalPriceWithAI(
                searchText,
                month,
                year
            );

            // Validate: Accept if data matches the search target OR if it's the last attempt
            const searchMonthMatch = extracted.month.toLowerCase() === targetMonth.toLowerCase();
            const searchYearMatch = extracted.year === targetYear;
            const isLastAttempt = attempt === maxAttempts;

            // Check if extracted data is reasonably recent (within same year or last year)
            const isRecentData = extracted.year >= year - 1;

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
    throw new Error(`Failed to fetch coal prices after ${maxAttempts} attempts`);
}

/**
 * Enrich bill with weather and coal price data
 */
export async function enrichBillData(
    billId: string,
    startDate: string,
    endDate: string,
    latitude: number = 14.5995, // Default: Manila
    longitude: number = 120.9842
): Promise<void> {
    console.log(`[Enrichment] Starting enrichment for bill ${billId}`);

    try {
        // Fetch weather and coal price in parallel
        const [weatherData, coalData] = await Promise.all([
            fetchWeatherData(startDate, endDate, latitude, longitude),
            fetchCoalPrice(startDate),
        ]);

        // Update bill document with enrichment data
        await db.collection('bills').doc(billId).update({
            avg_temperature: weatherData.avg_temperature,
            avg_humidity: weatherData.avg_humidity,
            coal_price: coalData.value,
            coal_price_unit: coalData.unit,
            coal_price_month: coalData.month,
            coal_price_year: coalData.year,
            coal_price_source: coalData.source,
            enrichment_completed_at: new Date().toISOString(),
        });

        console.log(`[Enrichment] Successfully enriched bill ${billId}`);
        console.log(`  - Temperature: ${weatherData.avg_temperature}°C`);
        console.log(`  - Humidity: ${weatherData.avg_humidity}%`);
        console.log(`  - Coal Price: ${coalData.value} ${coalData.unit}`);
    } catch (error) {
        console.error(`[Enrichment] Failed to enrich bill ${billId}:`, error);
        throw error;
    }
}

// Made with Bob
