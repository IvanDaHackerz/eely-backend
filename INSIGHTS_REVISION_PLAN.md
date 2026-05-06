# Insights Service Revision Plan

## Overview

Complete revision of `insights.service.ts` to implement individual loop-based fetching for fuel prices and kWh retail prices with AI extraction and validation.

## Current vs New Architecture

### Current Flow

1. Fetch all bills
2. Perform single web search for all data (coal, Meralco, temperature)
3. Build prompt with web context
4. AI analyzes everything at once
5. Save results

### New Flow

1. Fetch all bills
2. Get device date (current month/year)
3. **Loop 1: Fetch kWh Retail Price**
   - Search Tavily with specific query
   - Extract data with AI
   - Validate month/year matches device date
   - Retry up to 3 times if mismatch
4. **Loop 2: Fetch Fuel Prices**
   - Search Tavily with specific query
   - Extract data with AI
   - Validate month/year matches device date
   - Retry up to 3 times if mismatch
5. Build prompt with extracted prices
6. AI analyzes bills with price context
7. Save results

## Detailed Implementation Plan

### 1. New Type Definitions

```typescript
interface ExtractedPriceData {
  value: number;
  unit: string;
  month: string;
  year: number;
  description: string;
}

interface DeviceDate {
  month: string; // e.g., "January"
  year: number; // e.g., 2026
  monthYear: string; // e.g., "January 2026"
}
```

### 2. Device Date Function

```typescript
function getDeviceDate(): DeviceDate;
```

- Gets current date from device
- Returns formatted month name, year, and combined string
- Used for search queries and validation

### 3. kWh Retail Price Loop

```typescript
async function fetchAndExtractKwhRetailPrice(
  deviceDate: DeviceDate,
  maxAttempts: number = 3,
): Promise<number>;
```

**Flow:**

1. Attempt counter = 1
2. Build query: `"${deviceDate.monthYear} Meralco kwh retail price"`
3. Call Tavily search with domain restriction: `https://company.meralco.com.ph/`
4. Call AI to extract: `{ value, unit, month, year, description }`
5. Validate: extracted month/year === device month/year
6. If match: return value
7. If mismatch and attempts < 3: increment attempt, go to step 2
8. If max attempts reached: throw error or return fallback

**AI Extraction Prompt:**

```
Extract the Meralco kWh retail price from the following search results.
Target month: ${deviceDate.month}
Target year: ${deviceDate.year}

Search Results:
${searchResults}

Return JSON only:
{
  "value": <number>,
  "unit": <string, e.g., "PHP/kWh">,
  "month": <string, e.g., "January">,
  "year": <number>,
  "description": <string, max 2 sentences>
}
```

### 4. Fuel Prices Loop

```typescript
async function fetchAndExtractFuelPrices(
  deviceDate: DeviceDate,
  maxAttempts: number = 3,
): Promise<number>;
```

**Flow:**

1. Attempt counter = 1
2. Build query: `"${deviceDate.monthYear} Coal prices"`
3. Call Tavily search with domain restriction: `https://tradingeconomics.com/`
4. Call AI to extract: `{ value, unit, month, year, description }`
5. Validate: extracted month/year === device month/year
6. If match: return value
7. If mismatch and attempts < 3: increment attempt, go to step 2
8. If max attempts reached: throw error or return fallback

**AI Extraction Prompt:**

```
Extract the coal price from the following search results.
Target month: ${deviceDate.month}
Target year: ${deviceDate.year}

Search Results:
${searchResults}

Return JSON only:
{
  "value": <number>,
  "unit": <string, e.g., "USD/ton">,
  "month": <string, e.g., "January">,
  "year": <number>,
  "description": <string, max 2 sentences>
}
```

### 5. AI Extraction Helper Function

```typescript
async function extractPriceDataWithAI(
  searchResults: string,
  priceType: "kwh_retail" | "fuel",
  targetMonth: string,
  targetYear: number,
): Promise<ExtractedPriceData>;
```

- Calls Together AI (DeepSeek V3)
- Parses JSON response
- Validates required fields
- Returns structured data

### 6. Updated Main Pipeline

```typescript
async function generateInsights(
  uid: string,
  latitude: number | null = null,
  longitude: number | null = null,
): Promise<InsightsWithJustifications>;
```

**New Steps:**

1. Fetch bills (unchanged)
2. Resolve location (unchanged)
3. **Get device date**
4. **Fetch kWh retail price (loop)**
5. **Fetch fuel prices (loop)**
6. Build AI prompt with extracted prices
7. Generate insights with AI
8. Save to Firestore

### 7. Interface Updates

**Keep InsightsResult unchanged:**

```typescript
export interface InsightsResult {
  // ... existing fields
  fuel_prices: number; // Store only numeric value
  kwh_retail_price: number; // Store only numeric value
  // ... rest unchanged
}
```

**Internal use only (not stored):**

- `ExtractedPriceData` used during extraction/validation
- Only final numeric values stored in Firestore

### 8. Removed/Modified Functions

**Remove:**

- `fetchWebContext()` - replaced by individual loops

**Modify:**

- `buildInsightsPrompt()` - remove webContext parameter
- `generateInsights()` - use new loop functions

**Keep unchanged:**

- `fetchBillsForUser()`
- `fetchInsightsForUser()`
- `fetchMonthlyReportForUser()`
- `callAIForInsights()`
- `saveInsights()`
- `getInsights()`
- `updateStatus()`

## Error Handling

### Retry Logic

- Each loop: max 3 attempts
- On mismatch: new Tavily search with same query
- On search failure: wait 2s, retry
- On AI extraction failure: wait 2s, retry

### Fallback Strategy

- If all attempts fail for kWh price: use last known value or default
- If all attempts fail for fuel price: use last known value or default
- Log warnings for fallback usage

## Status Updates

Update user status at each major step:

1. "Fetching historical utility bills..."
2. "Resolving user location..."
3. "Fetching current Meralco kWh retail price..."
4. "Fetching current coal prices..."
5. "Preparing data for AI analysis..."
6. "Generating AI insights..."
7. "Saving insights securely..."
8. "Done"

## Testing Considerations

1. Test with matching month/year (should succeed on first attempt)
2. Test with mismatched data (should retry and succeed)
3. Test with no matching data (should fail after 3 attempts)
4. Test with Tavily API failures
5. Test with AI extraction failures
6. Test with invalid JSON responses

## Migration Notes

- No database schema changes required
- Existing insights documents remain compatible
- Controllers and routes unchanged
- Frontend API calls unchanged

## Key Differences from Current Implementation

1. **Sequential vs Parallel**: Prices fetched individually, not in batch
2. **Validation**: Month/year validation added with retry logic
3. **Extraction**: AI extracts structured data, not just analysis
4. **Storage**: Only numeric values stored (no metadata)
5. **Queries**: More specific, targeted search queries
6. **Domain Restrictions**: Enforced per requirement

## Implementation Order

1. ✅ Create type definitions
2. ✅ Implement `getDeviceDate()`
3. ✅ Implement `extractPriceDataWithAI()`
4. ✅ Implement `fetchAndExtractKwhRetailPrice()`
5. ✅ Implement `fetchAndExtractFuelPrices()`
6. ✅ Update `generateInsights()` to use new functions
7. ✅ Remove `fetchWebContext()`
8. ✅ Update `buildInsightsPrompt()` signature
9. ✅ Test complete flow
10. ✅ Update documentation
