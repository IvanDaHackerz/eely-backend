# Insights Service Flow Diagram

## New Architecture Flow

```mermaid
graph TD
    A[Start: generateInsights] --> B[Step 1: Fetch Bills]
    B --> C[Step 2: Resolve Location]
    C --> D[Step 3: Get Device Date]
    D --> E[Step 4: Loop 1 - kWh Retail Price]
    E --> F[Step 5: Loop 2 - Fuel Prices]
    F --> G[Step 6: Build AI Prompt]
    G --> H[Step 7: Generate Insights]
    H --> I[Step 8: Save to Firestore]
    I --> J[End: Return Results]

    E --> E1[kWh Price Loop Details]
    E1 --> E2{Attempt <= 3?}
    E2 -->|Yes| E3[Tavily Search: Month Year Meralco kwh retail price]
    E3 --> E4[AI Extract: value, unit, month, year, description]
    E4 --> E5{Month/Year Match?}
    E5 -->|Yes| E6[Return Price Value]
    E5 -->|No| E7[Increment Attempt]
    E7 --> E2
    E2 -->|No| E8[Throw Error / Use Fallback]

    F --> F1[Fuel Price Loop Details]
    F1 --> F2{Attempt <= 3?}
    F2 -->|Yes| F3[Tavily Search: Month Year Coal prices]
    F3 --> F4[AI Extract: value, unit, month, year, description]
    F4 --> F5{Month/Year Match?}
    F5 -->|Yes| F6[Return Price Value]
    F5 -->|No| F7[Increment Attempt]
    F7 --> F2
    F2 -->|No| F8[Throw Error / Use Fallback]
```

## Loop 1: kWh Retail Price Fetching

```mermaid
sequenceDiagram
    participant Service as Insights Service
    participant Tavily as Tavily API
    participant AI as Together AI (DeepSeek)
    participant Validator as Month/Year Validator

    Service->>Service: Get Device Date (e.g., "January 2026")

    loop Max 3 Attempts
        Service->>Tavily: Search "January 2026 Meralco kwh retail price"
        Note over Tavily: Domain: company.meralco.com.ph
        Tavily-->>Service: Search Results

        Service->>AI: Extract price data from results
        Note over AI: Extract: value, unit, month, year, description
        AI-->>Service: Extracted Data

        Service->>Validator: Validate month/year match
        alt Month/Year Matches
            Validator-->>Service: Valid ✓
            Service->>Service: Return price value
        else Month/Year Mismatch
            Validator-->>Service: Invalid ✗
            Service->>Service: Retry with new search
        end
    end
```

## Loop 2: Fuel Prices Fetching

```mermaid
sequenceDiagram
    participant Service as Insights Service
    participant Tavily as Tavily API
    participant AI as Together AI (DeepSeek)
    participant Validator as Month/Year Validator

    Service->>Service: Get Device Date (e.g., "January 2026")

    loop Max 3 Attempts
        Service->>Tavily: Search "January 2026 Coal prices"
        Note over Tavily: Domain: tradingeconomics.com
        Tavily-->>Service: Search Results

        Service->>AI: Extract price data from results
        Note over AI: Extract: value, unit, month, year, description
        AI-->>Service: Extracted Data

        Service->>Validator: Validate month/year match
        alt Month/Year Matches
            Validator-->>Service: Valid ✓
            Service->>Service: Return price value
        else Month/Year Mismatch
            Validator-->>Service: Invalid ✗
            Service->>Service: Retry with new search
        end
    end
```

## Data Flow

```mermaid
graph LR
    A[Device Date] --> B[Loop 1: kWh Price]
    A --> C[Loop 2: Fuel Price]

    B --> D[Tavily Search]
    D --> E[AI Extraction]
    E --> F{Validate}
    F -->|Match| G[Price Value]
    F -->|Mismatch| D

    C --> H[Tavily Search]
    H --> I[AI Extraction]
    I --> J{Validate}
    J -->|Match| K[Price Value]
    J -->|Mismatch| H

    G --> L[Build Prompt]
    K --> L
    L --> M[AI Analysis]
    M --> N[Firestore]
```

## Key Changes from Current Implementation

### Before (Current)

```
1. Fetch Bills
2. Single Web Search (all data at once)
   - Coal prices
   - Meralco rates
   - Temperature
3. AI analyzes everything together
4. Save results
```

### After (New)

```
1. Fetch Bills
2. Get Device Date
3. Individual Loop: kWh Retail Price
   - Search → Extract → Validate → Retry if needed
4. Individual Loop: Fuel Prices
   - Search → Extract → Validate → Retry if needed
5. AI analyzes with extracted prices
6. Save results
```

## Error Handling Flow

```mermaid
graph TD
    A[Start Loop] --> B{Attempt <= 3?}
    B -->|Yes| C[Tavily Search]
    C --> D{Search Success?}
    D -->|Yes| E[AI Extraction]
    D -->|No| F[Wait 2s]
    F --> G[Increment Attempt]
    G --> B

    E --> H{Extraction Success?}
    H -->|Yes| I{Month/Year Match?}
    H -->|No| J[Wait 2s]
    J --> G

    I -->|Yes| K[Return Value]
    I -->|No| G

    B -->|No| L{Fallback Available?}
    L -->|Yes| M[Use Last Known Value]
    L -->|No| N[Throw Error]
```

## Status Updates Timeline

```
User sees:
├─ "Fetching historical utility bills..." (Step 1)
├─ "Resolving user location..." (Step 2)
├─ "Fetching current Meralco kWh retail price..." (Step 4)
│  └─ (Loop may retry up to 3 times)
├─ "Fetching current coal prices..." (Step 5)
│  └─ (Loop may retry up to 3 times)
├─ "Preparing data for AI analysis..." (Step 6)
├─ "Generating AI insights..." (Step 7)
├─ "Saving insights securely..." (Step 8)
└─ "Done"
```
