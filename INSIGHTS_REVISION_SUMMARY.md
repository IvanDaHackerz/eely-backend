# Insights Service Revision - Summary

## What's Changing

We're completely revising the search algorithm in `insights.service.ts` to fetch fuel prices and kWh retail prices using individual loops with AI extraction and validation.

## Key Changes

### 1. **Individual Loops Instead of Batch Search**

- **Before**: Single web search fetches all data at once (coal, Meralco, temperature)
- **After**: Two separate loops, each with retry logic:
  - Loop 1: kWh retail price (Meralco)
  - Loop 2: Fuel prices (Coal)

### 2. **AI Extraction with Validation**

- Tavily searches for current month/year data
- AI extracts structured data: `{ value, unit, month, year, description }`
- Validates extracted month/year matches device date
- Retries up to 3 times if mismatch

### 3. **Domain-Specific Searches**

- **kWh retail price**: Limited to `company.meralco.com.ph`
- **Fuel prices**: Limited to `tradingeconomics.com`

### 4. **Storage Format**

- Only numeric values stored in Firestore (unchanged schema)
- Full extracted format used internally for validation only

## New Functions

1. `getDeviceDate()` - Gets current month/year
2. `extractPriceDataWithAI()` - AI extraction helper
3. `fetchAndExtractKwhRetailPrice()` - Loop 1 implementation
4. `fetchAndExtractFuelPrices()` - Loop 2 implementation

## Modified Functions

1. `buildInsightsPrompt()` - Remove webContext parameter, add price parameters
2. `generateInsights()` - Use new loop functions instead of fetchWebContext

## Removed Functions

1. `fetchWebContext()` - Replaced by individual loops
2. `WebQuery` interface - No longer needed

## Flow Comparison

### Current Flow (7 steps)

```
1. Fetch Bills
2. Resolve Location
3. Search Web (all data)
4. Build Prompt
5. Generate Insights
6. Save to Firestore
7. Done
```

### New Flow (8 steps)

```
1. Fetch Bills
2. Resolve Location
3. Get Device Date
4. Loop: Fetch kWh Price (with retry)
5. Loop: Fetch Fuel Price (with retry)
6. Build Prompt
7. Generate Insights
8. Save to Firestore
9. Done
```

## Retry Logic

Each loop attempts up to 3 times:

1. **Attempt 1**: Search → Extract → Validate
2. **If mismatch**: Wait 2s, new search with same query
3. **Attempt 2**: Search → Extract → Validate
4. **If mismatch**: Wait 2s, new search with same query
5. **Attempt 3**: Search → Extract → Validate
6. **If still fails**: Throw error

## Search Queries

### kWh Retail Price

```
Query: "January 2026 Meralco kwh retail price"
Domain: company.meralco.com.ph
Max Results: 3
```

### Fuel Prices

```
Query: "January 2026 Coal prices"
Domain: tradingeconomics.com
Max Results: 3
```

## AI Extraction Format

AI returns structured JSON:

```json
{
  "value": 12.5,
  "unit": "PHP/kWh",
  "month": "January",
  "year": 2026,
  "description": "Meralco retail rate for January 2026 is 12.5 PHP/kWh. This reflects current market conditions."
}
```

## Validation Rules

✅ **Pass**: `extracted.month === device.month AND extracted.year === device.year`
❌ **Fail**: Month or year mismatch → Retry with new search

## Error Handling

- **Search fails**: Wait 2s, retry (up to 3 attempts)
- **AI extraction fails**: Wait 2s, retry (up to 3 attempts)
- **Validation fails**: New search, retry (up to 3 attempts)
- **All attempts fail**: Throw error with clear message

## Status Updates

User sees progress:

1. "Fetching historical utility bills..."
2. "Resolving user location..."
3. "Fetching current Meralco kWh retail price..." ← NEW
4. "Fetching current coal prices..." ← NEW
5. "Preparing data for AI analysis..."
6. "Generating AI insights..."
7. "Saving insights securely..."
8. "Done"

## No Breaking Changes

- ✅ API endpoints unchanged
- ✅ Request/response format unchanged
- ✅ Firestore schema unchanged
- ✅ Frontend integration unchanged
- ✅ Controllers unchanged

## Benefits

1. **More Accurate**: Validates data matches current month/year
2. **More Reliable**: Retry logic handles temporary failures
3. **More Specific**: Domain-restricted searches get better results
4. **More Transparent**: Clear status updates for each step
5. **More Maintainable**: Separate concerns, easier to debug

## Implementation Files

All planning documents created:

- ✅ `INSIGHTS_REVISION_PLAN.md` - Detailed technical plan
- ✅ `INSIGHTS_FLOW_DIAGRAM.md` - Visual flow diagrams
- ✅ `INSIGHTS_IMPLEMENTATION_GUIDE.md` - Code examples
- ✅ `INSIGHTS_REVISION_SUMMARY.md` - This summary

## Next Steps

Ready to implement? The plan includes:

- Complete code examples for all new functions
- Step-by-step modification guide
- Testing checklist
- Migration steps

Everything else stays the same - no changes to controllers, routes, or frontend.
