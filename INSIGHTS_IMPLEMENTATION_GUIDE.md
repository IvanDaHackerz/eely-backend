# Insights Service Implementation Guide

## Code Structure Overview

The revised `insights.service.ts` will have the following structure:

```
1. Imports & Configuration
2. Type Definitions (NEW)
3. Utility Functions
   - getDeviceDate() (NEW)
   - extractPriceDataWithAI() (NEW)
4. Price Fetching Loops (NEW)
   - fetchAndExtractKwhRetailPrice()
   - fetchAndExtractFuelPrices()
5. Existing Functions (Modified)
   - fetchBillsForUser() (unchanged)
   - fetchInsightsForUser() (unchanged)
   - fetchMonthlyReportForUser() (unchanged)
   - buildInsightsPrompt() (modified - remove webContext)
   - callAIForInsights() (unchanged)
   - saveInsights() (unchanged)
   - getInsights() (unchanged)
   - updateStatus() (unchanged)
   - generateInsights() (modified - use new loops)
6. Remove
   - fetchWebContext() (DELETE)
   - WebQuery interface (DELETE)
```

## Detailed Code Examples

### 1. New Type Definitions

```typescript
// Add after existing type definitions (around line 63)

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
}

/**
 * Device date information for search queries and validation
 */
interface DeviceDate {
  month: string; // e.g., "January"
  year: number; // e.g., 2026
  monthYear: string; // e.g., "January 2026"
}
```

### 2. Get Device Date Function

```typescript
/**
 * Gets the current device date for search queries and validation
 * @returns DeviceDate object with month, year, and combined string
 */
function getDeviceDate(): DeviceDate {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();
  const monthYear = `${month} ${year}`;

  return { month, year, monthYear };
}
```

### 3. AI Extraction Function

````typescript
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
  priceType: "kwh_retail" | "fuel",
  targetMonth: string,
  targetYear: number,
): Promise<ExtractedPriceData> {
  const priceLabel =
    priceType === "kwh_retail" ? "Meralco kWh retail price" : "coal price";

  const prompt = `Extract the ${priceLabel} from the following search results.

Target month: ${targetMonth}
Target year: ${targetYear}

Search Results:
${searchResults}

Return ONLY valid JSON in this exact format (no markdown, no commentary):
{
  "value": <number>,
  "unit": <string, e.g., "PHP/kWh" or "USD/ton">,
  "month": <string, e.g., "January">,
  "year": <number>,
  "description": <string, max 2 sentences describing the price and context>
}`;

  console.log(`     🤖 Extracting ${priceLabel} data with AI...`);

  try {
    const response = await ai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a JSON-only API that extracts price data. Return raw JSON only, no markdown, no commentary.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 500,
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) {
      throw new Error("AI returned empty response");
    }

    // Parse JSON (handle markdown code blocks if present)
    let jsonString = rawText.trim();
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonString);

    // Validate required fields
    if (
      !parsed.value ||
      !parsed.unit ||
      !parsed.month ||
      !parsed.year ||
      !parsed.description
    ) {
      throw new Error("Missing required fields in AI response");
    }

    return {
      value: Number(parsed.value),
      unit: String(parsed.unit),
      month: String(parsed.month),
      year: Number(parsed.year),
      description: String(parsed.description),
    };
  } catch (err: any) {
    console.error(`     ✗ AI extraction failed: ${err.message}`);
    throw err;
  }
}
````

### 4. kWh Retail Price Loop

```typescript
/**
 * Fetches and extracts Meralco kWh retail price with retry logic
 * @param deviceDate - Current device date for validation
 * @param maxAttempts - Maximum retry attempts (default: 3)
 * @returns Extracted price value
 */
async function fetchAndExtractKwhRetailPrice(
  deviceDate: DeviceDate,
  maxAttempts: number = 3,
): Promise<number> {
  console.log(
    `\n  ⚡ Fetching Meralco kWh retail price for ${deviceDate.monthYear}...`,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`     Attempt ${attempt}/${maxAttempts}`);

      // Build search query
      const query = `${deviceDate.monthYear} Meralco kwh retail price`;
      console.log(`     🔍 Searching: "${query}"`);

      // Perform Tavily search with domain restriction
      const searchResult = await tavilyClient.search(query, {
        maxResults: 3,
        includeDomains: ["company.meralco.com.ph"],
      });

      if (!searchResult.results || searchResult.results.length === 0) {
        throw new Error("No search results found");
      }

      console.log(`     ✓ Found ${searchResult.results.length} result(s)`);

      // Format search results for AI
      const searchText = searchResult.results
        .map((r) => `[${r.title}] (${r.url}): ${r.content}`)
        .join("\n\n");

      // Extract data with AI
      const extracted = await extractPriceDataWithAI(
        searchText,
        "kwh_retail",
        deviceDate.month,
        deviceDate.year,
      );

      // Validate month/year match
      const monthMatch =
        extracted.month.toLowerCase() === deviceDate.month.toLowerCase();
      const yearMatch = extracted.year === deviceDate.year;

      if (monthMatch && yearMatch) {
        console.log(
          `     ✓ Validation passed: ${extracted.month} ${extracted.year}`,
        );
        console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
        console.log(`     ℹ️  ${extracted.description}`);
        return extracted.value;
      } else {
        console.warn(
          `     ✗ Month/year mismatch: got ${extracted.month} ${extracted.year}, expected ${deviceDate.month} ${deviceDate.year}`,
        );
        if (attempt < maxAttempts) {
          console.log(`     ⏳ Retrying in 2 seconds...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch (err: any) {
      console.error(`     ✗ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        console.log(`     ⏳ Retrying in 2 seconds...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // All attempts failed
  throw new Error(
    `Failed to fetch kWh retail price after ${maxAttempts} attempts`,
  );
}
```

### 5. Fuel Prices Loop

```typescript
/**
 * Fetches and extracts coal fuel prices with retry logic
 * @param deviceDate - Current device date for validation
 * @param maxAttempts - Maximum retry attempts (default: 3)
 * @returns Extracted price value
 */
async function fetchAndExtractFuelPrices(
  deviceDate: DeviceDate,
  maxAttempts: number = 3,
): Promise<number> {
  console.log(`\n  ⛏️  Fetching coal prices for ${deviceDate.monthYear}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`     Attempt ${attempt}/${maxAttempts}`);

      // Build search query
      const query = `${deviceDate.monthYear} Coal prices`;
      console.log(`     🔍 Searching: "${query}"`);

      // Perform Tavily search with domain restriction
      const searchResult = await tavilyClient.search(query, {
        maxResults: 3,
        includeDomains: ["tradingeconomics.com"],
      });

      if (!searchResult.results || searchResult.results.length === 0) {
        throw new Error("No search results found");
      }

      console.log(`     ✓ Found ${searchResult.results.length} result(s)`);

      // Format search results for AI
      const searchText = searchResult.results
        .map((r) => `[${r.title}] (${r.url}): ${r.content}`)
        .join("\n\n");

      // Extract data with AI
      const extracted = await extractPriceDataWithAI(
        searchText,
        "fuel",
        deviceDate.month,
        deviceDate.year,
      );

      // Validate month/year match
      const monthMatch =
        extracted.month.toLowerCase() === deviceDate.month.toLowerCase();
      const yearMatch = extracted.year === deviceDate.year;

      if (monthMatch && yearMatch) {
        console.log(
          `     ✓ Validation passed: ${extracted.month} ${extracted.year}`,
        );
        console.log(`     ✓ Extracted: ${extracted.value} ${extracted.unit}`);
        console.log(`     ℹ️  ${extracted.description}`);
        return extracted.value;
      } else {
        console.warn(
          `     ✗ Month/year mismatch: got ${extracted.month} ${extracted.year}, expected ${deviceDate.month} ${deviceDate.year}`,
        );
        if (attempt < maxAttempts) {
          console.log(`     ⏳ Retrying in 2 seconds...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch (err: any) {
      console.error(`     ✗ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        console.log(`     ⏳ Retrying in 2 seconds...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // All attempts failed
  throw new Error(`Failed to fetch fuel prices after ${maxAttempts} attempts`);
}
```

### 6. Updated buildInsightsPrompt

```typescript
/**
 * Builds the AI prompt for insights generation
 * @param bills - User's electricity bills
 * @param kwhRetailPrice - Extracted kWh retail price
 * @param fuelPrice - Extracted fuel price
 * @param locationLabel - Location description
 * @returns Formatted prompt string
 */
export function buildInsightsPrompt(
  bills: BillDocument[],
  kwhRetailPrice: number,
  fuelPrice: number,
  locationLabel: string,
): string {
  const billCount = bills.length;
  const sortedBills = [...bills].sort(
    (a, b) =>
      new Date(a.start_date || a.end_date || 0).getTime() -
      new Date(b.start_date || b.end_date || 0).getTime(),
  );
  const billsJson = JSON.stringify(sortedBills, null, 2);
  const kwhList =
    billCount > 0
      ? sortedBills
          .map((b) => `${b.start_date}: ${b.total_kwh_used} kWh`)
          .join(", ")
      : "No bills uploaded yet";

  return `Expert Philippine electricity analyst. Analyze ${billCount > 0 ? `ALL ${billCount} Meralco bill(s)` : "the user situation (no bills uploaded yet)"}.

${
  billCount > 0
    ? `IMPORTANT: There are exactly ${billCount} bill(s). You MUST use ALL of them.
Bill kWh chronologically: [${kwhList}]

BILLS:
${billsJson}`
    : "No bills uploaded. Use generic Filipino household estimates (~200 kWh/month)."
}

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
```

### 7. Updated generateInsights

```typescript
/**
 * Main pipeline for generating insights
 * @param uid - User account ID
 * @param latitude - User latitude (optional)
 * @param longitude - User longitude (optional)
 * @returns Generated insights with justifications
 */
export async function generateInsights(
  uid: string,
  latitude: number | null = null,
  longitude: number | null = null,
): Promise<InsightsWithJustifications> {
  console.log(`\n  📋 Step 1/7: Fetching historical utility bills...`);
  await updateStatus(uid, "insights", "Fetching historical utility bills...");
  const bills = await fetchBillsForUser(uid);
  console.log(`     ✓ Found ${bills.length} bill(s)`);

  // ── Auto-resolve coordinates from prediction doc if not provided ──
  if (latitude === null || longitude === null) {
    console.log(`\n  📍 Step 2/7: Resolving user location...`);
    await updateStatus(uid, "insights", "Resolving user location...");
    try {
      const predDoc = await db.collection("prediction").doc(uid).get();
      if (predDoc.exists) {
        const predData = predDoc.data();
        if (predData?.latitude && predData?.longitude) {
          latitude = predData.latitude;
          longitude = predData.longitude;
          console.log(
            `     ✓ Location from prediction: ${latitude}, ${longitude}`,
          );
        }
      }
    } catch (e) {
      console.warn(`     ⚠️ Could not fetch prediction for coordinates`);
    }

    if (latitude === null || longitude === null) {
      latitude = 14.5995;
      longitude = 120.9842;
      console.log(
        `     ℹ️ Using default Manila coordinates: ${latitude}, ${longitude}`,
      );
    }
  } else {
    console.log(
      `\n  📍 Step 2/7: Using provided coordinates: ${latitude}, ${longitude}`,
    );
  }

  const locationDesc = `${latitude},${longitude}`;
  const locationLabel = `Coordinates: ${locationDesc}`;

  // ── Get device date ──
  console.log(`\n  📅 Step 3/7: Getting device date...`);
  const deviceDate = getDeviceDate();
  console.log(`     ✓ Device date: ${deviceDate.monthYear}`);

  // ── Fetch kWh retail price ──
  console.log(`\n  ⚡ Step 4/7: Fetching current Meralco kWh retail price...`);
  await updateStatus(
    uid,
    "insights",
    "Fetching current Meralco kWh retail price...",
  );
  const kwhRetailPrice = await fetchAndExtractKwhRetailPrice(deviceDate);
  console.log(`     ✓ kWh retail price: ${kwhRetailPrice}`);

  // ── Fetch fuel prices ──
  console.log(`\n  ⛏️  Step 5/7: Fetching current coal prices...`);
  await updateStatus(uid, "insights", "Fetching current coal prices...");
  const fuelPrice = await fetchAndExtractFuelPrices(deviceDate);
  console.log(`     ✓ Fuel price: ${fuelPrice}`);

  // ── Build prompt ──
  console.log(`\n  📝 Step 6/7: Building AI analysis prompt...`);
  await updateStatus(uid, "insights", "Preparing data for AI analysis...");
  const prompt = buildInsightsPrompt(
    bills,
    kwhRetailPrice,
    fuelPrice,
    locationLabel,
  );
  console.log(`     ✓ Prompt built (${prompt.length} chars)`);

  // ── Generate insights ──
  console.log(`\n  🧠 Step 7/7: Generating AI insights...`);
  await updateStatus(uid, "insights", "Generating AI insights...");
  const startAI = Date.now();
  const result = await callAIForInsights(prompt);
  const aiElapsed = ((Date.now() - startAI) / 1000).toFixed(1);
  console.log(`     ✓ AI response received (${aiElapsed}s)`);

  result.insights.latitude = latitude;
  result.insights.longitude = longitude;
  result.grounding_sources = [
    `Meralco kWh Retail Price: ${kwhRetailPrice} PHP/kWh (${deviceDate.monthYear})`,
    `Coal Fuel Price: ${fuelPrice} USD/ton (${deviceDate.monthYear})`,
  ];

  // ── Save to Firestore ──
  console.log(`\n  💾 Step 8/7: Saving insights to Firestore...`);
  await updateStatus(uid, "insights", "Saving insights securely...");
  await saveInsights(uid, result.insights, result.justifications);
  console.log(`     ✓ Saved to insights/${uid}`);

  await updateStatus(uid, "insights", "Done");
  console.log(`\n  ✅ Insights generation complete!`);
  return result;
}
```

## Functions to Remove

Delete these completely:

```typescript
// DELETE: interface WebQuery
// DELETE: async function fetchWebContext()
```

## Testing Checklist

- [ ] Test with current month/year data (should succeed on first attempt)
- [ ] Test with mismatched month/year (should retry and succeed)
- [ ] Test with no matching data (should fail after 3 attempts)
- [ ] Test with Tavily API failures
- [ ] Test with AI extraction failures
- [ ] Test with invalid JSON responses
- [ ] Test with missing bills
- [ ] Test with multiple bills
- [ ] Verify Firestore storage format
- [ ] Verify status updates appear correctly
- [ ] Test error handling and fallbacks

## Migration Steps

1. Backup current `insights.service.ts`
2. Add new type definitions
3. Add new utility functions
4. Add new loop functions
5. Update `buildInsightsPrompt` signature
6. Update `generateInsights` implementation
7. Remove `fetchWebContext` and `WebQuery`
8. Test thoroughly
9. Deploy
