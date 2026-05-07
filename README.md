# Eely Backend Server

Express.js + TypeScript backend for the Eely energy analytics platform. Manages user accounts, AI-powered electricity bill insights, and predictive analytics via Together AI with real-time web search grounding.

## Tech Stack

This is the dedicated Express.js & Node.js backend server for the Eely application. It acts as an admin layer to safely manage and interact with Firebase/Firestore resources, including user account creation and bill ingestion after the frontend extracts bill data.

## 🚀 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database / Auth:** Firebase Admin SDK (Firestore)
- **AI:** Together AI (OpenAI-compatible) + Tavily web search grounding
- **OCR:** Google Cloud Vision API

---

## Setup & Installation

### 1. Install Dependencies

Make sure you have Node.js installed, then run:

```bash
npm install
```

### 2. Firebase Service Account

To allow this backend to write securely to your database, you need your Firebase Service Account key.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project -> **Project settings** (Gear Icon) -> **Service accounts**.
3. Click **Generate new private key** and download the `.json` file.
4. For local development, place it in the `backend/` root as `serviceAccountKey.json`.
5. For Railway, store the JSON contents in an environment variable instead of a file.

### 3. Environment Variables

Copy [.env.example](.env.example) to `backend/.env` and fill in the values:

```env
PORT=3000

# Railway: paste full JSON string
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Local dev file path
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

GOOGLE_VISION_API_KEY=
TOGETHER_API_KEY=
TAVILY_API_KEY=
```

---

## Running the Server

**Development Mode (Auto-reloads on save):**

```bash
npm run dev
```

**Production Build:**

```bash
npm run build   # Compiles TypeScript into JavaScript inside /dist
npm start       # Runs the compiled JavaScript
```

Default: `http://localhost:3000`

---

## Railway Deployment

1. Set the build command to `npm run build`.
2. Set the start command to `npm start`.
3. Add environment variables in Railway:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `GOOGLE_VISION_API_KEY`
  - `TOGETHER_API_KEY`
  - `TAVILY_API_KEY`

Railway automatically injects `PORT`, which the server already reads via `process.env.PORT`.

## API Endpoints

### Health Check

| Method | URL | Description         |
| ------ | --- | ------------------- |
| `GET`  | `/` | Server status check |

---

### Accounts

### 1. Health Check

Checks if the server is currently online.

- **URL:** `/`
- **Method:** `GET`
- **Response:** `200 OK - "Eely Backend Server is running"`

### 2. Create Account Profile

Creates a new document inside the Firestore `accounts` collection. Should be called immediately after a user signs up on the frontend using Firebase Authentication.

| Method | URL                  | Description            |
| ------ | -------------------- | ---------------------- |
| `POST` | `/api/accounts`      | Create account profile |
| `GET`  | `/api/accounts/:uid` | Get account profile    |

**POST /api/accounts**
**Request Body:**

```json
{
  "uid": "firebase-auth-uid",
  "email": "user@example.com",
  "full_name": "John Doe"
}
```

---

### Insights (AI Energy Analysis)

| Method | URL                      | Description                            |
| ------ | ------------------------ | -------------------------------------- |
| `POST` | `/api/insights/generate/:uid` | Generate AI insights (triggers Gemini) |
| `GET`  | `/api/insights/:uid`     | Get cached insights from Firestore     |

**POST /api/insights/generate/:uid**

Recommended payload:

```json
{
  "latitude": 14.6495,
  "longitude": 121.1163
}
```

Legacy fallback still supported:

```json
{
  "uid": "account-id",
  "latitude": 14.6495,
  "longitude": 121.1163
}
```
**Success Response (201 Created):**

```json
{
  "uid": "account-id",
  "latitude": 14.6495,
  "longitude": 121.1163
}
```

> `latitude` and `longitude` are optional (default `null`). Used for location-specific analysis.

**Response fields saved to Firestore (`insights/{uid}`):**

| Field                       | Type           | Description                                                   |
| --------------------------- | -------------- | ------------------------------------------------------------- |
| `total_kwh_used`            | number         | Sum of kWh across all bills                                   |
| `avg_kwh_per_day`           | number         | Total kWh / total billing days                                |
| `consumer_profile_class`    | string         | `"Low"` / `"Medium"` / `"High"` based on monthly avg          |
| `efficiency_trend`          | string         | `"improving"` / `"declining"` / `"stable"`                    |
| `monthly_consumption_trend` | number         | % change between two most recent bills                        |
| `fuel_prices`               | number         | Current coal price (USD/ton) via web search                   |
| `kwh_retail_price`          | number         | Current Meralco PHP/kWh rate via web search                   |
| `temperature_impact`        | number         | Estimated extra PHP cost from heat (no appliance assumptions) |
| `estimated_bill_impact`     | number         | Composite projected PHP change (temp + fuel + rate factors)   |
| `risk_level`                | string         | `"low"` / `"moderate"` / `"high"`                             |
| `percentile_rank`           | number         | 0-100 vs PH average (~200 kWh/month = 50th)                   |
| `latitude`                  | number \| null | User-provided latitude                                        |
| `longitude`                 | number \| null | User-provided longitude                                       |
| `{field}_description`       | string         | AI reasoning for each key field (auto-generated)              |
| `generated_at`              | timestamp      | Server timestamp                                              |

**Direct import:**

```ts
import { generateInsights, getInsights } from './services/insights.service';
### 3. Get Account Profile

Fetches an existing user profile from the Firestore `accounts` collection using their UID.

// Generate fresh insights (triggers AI)
const result = await generateInsights('account-id', 14.6495, 121.1163);
console.log(result.insights.total_kwh_used);
console.log(result.insights.risk_level);
console.log(result.justifications.fuel_prices.reasoning);

// Get cached insights (no AI call)
const cached = await getInsights('account-id');
```

---

### Prediction (AI Predictive Analytics)

| Method | URL                        | Description                                               |
| ------ | -------------------------- | --------------------------------------------------------- |
| `POST` | `/api/prediction/generate/:uid` | Generate prediction + appliance analysis (single AI call) |
| `GET`  | `/api/prediction/:uid`     | Get cached prediction from Firestore                      |

**POST /api/prediction/generate/:uid**

Recommended payload:

```json
{
  "latitude": 14.6495,
  "longitude": 121.1163
}
```

Legacy fallback still supported:

```json
{
  "uid": "account-id",
  "latitude": 14.6495,
  "longitude": 121.1163
}
```
**Success Response (200 OK):**

```json
{
  "uid": "account-id",
  "latitude": 14.6495,
  "longitude": 121.1163
}
```

> `latitude` and `longitude` are optional. When provided, the AI uses coordinates for location-specific weather, electricity rates, and city identification.

**Response fields saved to Firestore (`prediction/{uid}`):**

| Field                            | Type           | Description                                                    |
| -------------------------------- | -------------- | -------------------------------------------------------------- |
| `anomaly_detected`               | boolean        | Whether usage is anomalous vs PH average                       |
| `anomaly_description`            | string         | Cause of anomaly or `"No anomaly detected"`                    |
| `seasonal_bill_surge_prediction` | string         | Next-cycle surge prediction based on season                    |
| `predicted_kwh_next`             | number         | Predicted kWh for next billing cycle                           |
| `predicted_bill`                 | number         | Predicted bill amount (PHP) using area-specific rate breakdown |
| `historical_baseline_kwh`        | number         | Previous month's kWh (used as prediction baseline)             |
| `location`                       | string         | Full location name from coordinates                            |
| `city`                           | string         | City/municipality name from coordinates                        |
| `avg_temp`                       | number         | Current temperature at user's coordinates (°C)                 |
| `humidity`                       | number         | Current humidity at user's coordinates (%)                     |
| `temp_change`                    | number         | Temperature change vs previous month (°C)                      |
| `kwh_change_prediction`          | number         | Predicted % kWh change from heat index                         |
| `latitude`                       | number \| null | User-provided latitude                                         |
| `longitude`                      | number \| null | User-provided longitude                                        |
| `predicted_kwh_next_description` | string         | AI reasoning for the kWh prediction                            |
| `appliance_analysis`             | array          | Per-appliance analysis (if appliances exist)                   |
| `appliance_total_monthly_cost`   | number         | Total estimated monthly cost from appliances                   |
| `generated_at`                   | timestamp      | Server timestamp                                               |

**Prediction model:**

```
predicted_kwh_next = (baseline + net_appliance_kwh) × (1 + temp_factor) × (1 + seasonal_factor)
predicted_bill    = predicted_kwh_next × area_rate_breakdown
```

- **Baseline:** Most recent bill's kWh
- **Appliance adjustment:** Realistic monthly kWh per appliance (validated via web search, not blind multiplication)
- **Temperature factor:** +2-4% per degree above 30°C heat index
- **Seasonal factor:** Dry (Mar-May) +10-20%, Wet (Jun-Nov) -5-10%, Cool (Dec-Feb) -5%
- **Rate breakdown:** Generation + Transmission + System Loss + Distribution + Taxes + Universal charges

### Appliance Subcollection

Manage the `prediction/{uid}/appliances` subcollection directly.

| Method   | URL                                   | Description                     |
| -------- | ------------------------------------- | ------------------------------- |
| `POST`   | `/api/prediction/:uid/appliances`     | Add a new appliance document    |
| `GET`    | `/api/prediction/:uid/appliances`     | Get all appliance documents     |
| `GET`    | `/api/prediction/:uid/appliances/:id` | Read one appliance document     |
| `DELETE` | `/api/prediction/:uid/appliances/:id` | Remove a specific appliance doc |

**POST /api/prediction/:uid/appliances**

Request body:

```json
{
  "name": "Tesla Model 3",
  "kwh": 10,
  "use_duration": 12,
  "is_added": false
}
```

Success response:

```json
{
  "data": {
    "_doc_id": "Ex9aNxYA4hEaCzQKhEFU",
    "name": "Tesla Model 3",
    "kwh": 10,
    "use_duration": 12,
    "is_added": false
  }
}
```

**GET /api/prediction/:uid/appliances**

Returns:

```json
{
  "data": [
    {
      "_doc_id": "Ex9aNxYA4hEaCzQKhEFU",
      "name": "Tesla Model 3",
      "kwh": 10,
      "use_duration": 12,
      "is_added": false
    }
  ]
}
```

**GET /api/prediction/:uid/appliances/:id**

Returns one appliance document:

```json
{
  "data": {
    "_doc_id": "Ex9aNxYA4hEaCzQKhEFU",
    "name": "Tesla Model 3",
    "kwh": 10,
    "use_duration": 12,
    "is_added": false
  }
}
```

**DELETE /api/prediction/:uid/appliances/:id**

Returns:

```json
{
  "message": "Appliance removed successfully"
}
```

**Appliance subcollection (`prediction/{uid}/appliances/{docId}`):**

| Field          | Type    | Description                                                    |
| -------------- | ------- | -------------------------------------------------------------- |
| `name`         | string  | Appliance name (e.g. "Tesla Model 3")                          |
| `kwh`          | number  | kWh rating (may be battery capacity for EVs)                   |
| `use_duration` | number  | Hours of use per day                                           |
| `is_added`     | boolean | `true` = adds to consumption, `false` = considered for removal |

**Direct import:**

```ts
import {
  generatePrediction,
  getPrediction,
} from "./services/prediction.service";

// Generate prediction + appliance analysis (single AI call)
const result = await generatePrediction("account-id", 14.6495, 121.1163);
console.log(result.prediction.predicted_kwh_next);
console.log(result.prediction.predicted_bill);
console.log(result.prediction.city);
console.log(result.appliances); // appliance analysis array
console.log(result.appliance_total_monthly_cost); // total PHP/month
console.log(result.justifications); // AI reasoning per field
console.log(result.grounding_sources); // Google Search URLs used

// Get cached prediction (no AI call)
const cached = await getPrediction("account-id");
```

---

### User Data Bundle

Fetches the cached insights and prediction documents for a user in one request. The backend first tries the document ID, then falls back to the `account_id` field so older records still resolve correctly.

| Method | URL                   | Description                                        |
| ------ | --------------------- | -------------------------------------------------- |
| `GET`  | `/api/user-data/:uid` | Get cached insights and prediction docs for a user |

**Response:**

```json
{
  "data": {
    "uid": "account-id",
    "insights": {
      "total_kwh_used": 0,
      "avg_kwh_per_day": 0,
      "consumer_profile_class": "Low"
    },
    "prediction": {
      "anomaly_detected": false,
      "predicted_kwh_next": 0,
      "predicted_bill": 0
    }
  }
}
```

If only one document exists, the other field is returned as `null`. If neither exists, the API returns `404`.

---

## Test Runners

CLI test scripts for validating the AI pipelines without the Express server:

```bash
# Test insights pipeline
npx ts-node src/test-insights.ts

# Test prediction pipeline
npx ts-node src/test-prediction.ts

# Test Firestore connectivity
npx ts-node src/test-firestore.ts
```

---

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── firebase.ts          # Firebase Admin SDK init
│   │   └── gemini.ts            # Google Gemini AI client init
│   ├── controllers/
│   │   ├── account.controller.ts
│   │   ├── insights.controller.ts
│   │   └── prediction.controller.ts
│   ├── models/
│   │   └── account.model.ts
│   ├── routes/
│   │   ├── account.routes.ts
│   │   ├── insights.routes.ts
│   │   └── prediction.routes.ts
│   ├── services/
│   │   ├── insights.service.ts   # AI insights generation + Firestore persistence
│   │   └── prediction.service.ts # AI prediction + appliance analysis (single call)
│   ├── index.ts                  # Express server entry point
│   ├── test-insights.ts          # CLI test runner for insights
│   ├── test-prediction.ts        # CLI test runner for prediction
│   └── test-firestore.ts         # CLI test runner for Firestore
├── .env
├── .gitignore
├── serviceAccountKey.json        # Firebase credentials (git-ignored)
├── package.json
└── tsconfig.json
```

---

## Firestore Collections

| Collection                    | Document ID | Description                                                 |
| ----------------------------- | ----------- | ----------------------------------------------------------- |
| `accounts`                    | `{uid}`     | User profile (email, full_name, createdAt)                  |
| `bills`                       | `{auto-id}` | Scanned electricity bills (account_id, kWh, charges, dates) |
| `insights`                    | `{uid}`     | AI-generated energy analysis + field descriptions           |
| `prediction`                  | `{uid}`     | AI-generated predictions + appliance analysis               |
| `prediction/{uid}/appliances` | `{auto-id}` | User-defined appliances for prediction model                |

---

## Error Responses

| Status | Description                                                  |
| ------ | ------------------------------------------------------------ |
| `400`  | Missing or invalid required fields                           |
| `404`  | Requested resource not found                                 |
| `500`  | Server error (Firestore, Gemini API, or configuration issue) |

### 4. Store Bill Data

Creates a new document in the Firestore `bills` collection. This endpoint is designed for bill data already extracted by OCR or AI parsing.

- **URL:** `/api/bills`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

**Request Body:**

```json
{
  "uid": "test-user-123",
  "bill": {
    "account_number": "1622091553",
    "account_name": "MAGPANTAY, JAMES RANDALL",
    "service_address": "231, The Greatest James Street",
    "start_date": "2026-08-30",
    "end_date": "2026-09-29",
    "due_date": "2026-10-14",
    "previous_reading": 3510,
    "current_reading": 4109,
    "total_kwh_used": 599,
    "total_amount_due": 8614.44,
    "generation": 4678.49,
    "transmission": 673.76,
    "system_loss": 411.69,
    "distribution": 1652.04,
    "government_taxes": 927.83,
    "universal_charges": 145.03,
    "fit_all": 71.22,
    "gea_all": 0,
    "lifeline_subsidy": 0,
    "senior_citizen_subsidy": 0,
    "other_charges": 55.34
  }
}
```

**Storage Rules:**

- The backend stores the document in the `bills` collection using an auto-generated Firestore document ID.
- The submitted `uid` is saved as `account_id` so existing bill queries continue to work.
- Incoming date strings are validated and stored as Firestore timestamps.

**Success Response (201 Created):**

```json
{
  "message": "Bill stored successfully",
  "id": "FIRESTORE_DOCUMENT_ID",
  "data": {
    "account_id": "test-user-123",
    "account_number": "1622091553",
    "account_name": "MAGPANTAY, JAMES RANDALL",
    "service_address": "231, The Greatest James Street",
    "start_date": { "_seconds": 1787779200, "_nanoseconds": 0 },
    "end_date": { "_seconds": 1790318400, "_nanoseconds": 0 },
    "due_date": { "_seconds": 1792060800, "_nanoseconds": 0 },
    "previous_reading": 3510,
    "current_reading": 4109,
    "total_kwh_used": 599,
    "total_amount_due": 8614.44,
    "generation": 4678.49,
    "transmission": 673.76,
    "system_loss": 411.69,
    "distribution": 1652.04,
    "government_taxes": 927.83,
    "universal_charges": 145.03,
    "fit_all": 71.22,
    "gea_all": 0,
    "lifeline_subsidy": 0,
    "senior_citizen_subsidy": 0,
    "other_charges": 55.34
  }
}
```

### 5. Get All Bills for a User

Fetches every bill document for a user by matching the `account_id` field in the Firestore `bills` collection.

- **URL:** `/api/bills/:uid`
- **Method:** `GET`

**How it works:**

- The `uid` path parameter is compared against the `account_id` field stored in each bill document.
- Returned documents include the Firestore document ID as `_doc_id`.
- Firestore timestamps are serialized to ISO strings in the response.
- Results are sorted by `due_date` in descending order when that field is available.

**Success Response (200 OK):**

```json
{
  "data": [
    {
      "_doc_id": "oUwzEadTODQx6j5PKtNc",
      "account_id": "CEIHujiEc5TSpV6JZB1DbbBKhI92",
      "account_name": "LORLOP, JULIE C",
      "account_number": "1738203978",
      "current_reading": 1950,
      "distribution": 253,
      "due_date": "2026-04-10T00:00:00.000Z",
      "end_date": "2026-03-29T00:00:00.000Z",
      "fit_all": 5.34,
      "gea_all": 0
    }
  ]
}
```

If the user has no matching bills, the endpoint still returns `200 OK` with an empty `data` array.

### 6. Get Insights Document

Fetches the saved insights document for a given account id. The API first checks the document ID and then falls back to the `account_id` field if needed.

The response includes every field stored in the Firestore document, including matching description fields such as `efficiency_trend_description`, `consumer_profile_class_description`, and so on for each insights value.

- **URL:** `/api/insights/:uid`
- **Method:** `GET`

**Success Response (200 OK):**

```json
{
  "data": {
    "account_id": "test-user-123",
    "total_kwh_used": 1920,
    "avg_kwh_per_day": 10.6,
    "consumer_profile_class": "Residential",
    "consumer_profile_class_description": "This account is classified as Residential based on the observed monthly consumption pattern.",
    "efficiency_trend": "improving",
    "efficiency_trend_description": "Consumption is trending downward across the available bills.",
    "monthly_consumption_trend": 320,
    "monthly_consumption_trend_description": "Latest usage is 320 kWh higher than the previous billing cycle.",
    "fuel_prices": 64.2,
    "fuel_prices_description": "Coal prices remain elevated, which may affect generation charges.",
    "kwh_retail_price": 12.1,
    "kwh_retail_price_description": "Latest residential rate used for the estimate.",
    "temperature_impact": 0.45,
    "temperature_impact_description": "Estimated cooling impact based on current weather and usage.",
    "estimated_bill_impact": 140,
    "estimated_bill_impact_description": "Projected next-cycle change based on recent rate adjustments.",
    "risk_level": "Moderate",
    "risk_level_description": "Moderate volatility based on current fuel and rate trends.",
    "percentile_rank": 0,
    "percentile_rank_description": "Compared against the approximate 200 kWh monthly household baseline.",
    "generated_at": {
      "_seconds": 1714897358,
      "_nanoseconds": 0
    }
  }
}
```

### 7. Get Monthly Report

Returns all bills for the account grouped by month, with each item containing the billing month, the summed bill amount, and the summed consumption for that month.

- **URL:** `/api/insights/:uid/monthly-report`
- **Method:** `GET`

**Success Response (200 OK):**

```json
{
  "data": [
    {
      "month": "August 2025",
      "bill": 8614.44,
      "consumption": 599
    },
    {
      "month": "September 2025",
      "bill": 9050.12,
      "consumption": 621.5
    }
  ]
}
```

The previous `/monthly-consumption` path is still available as an alias, but `/monthly-report` is the preferred name.

## ⚖️ Error Responses

- `400 Bad Request`: Missing or invalid required fields (e.g., missing `uid`, `email`, or `full_name`).
- `400 Bad Request`: Missing or invalid required fields for bill ingestion, including `uid`, `bill`, or any required bill property.
- `404 Not Found`: The requested resource (e.g., account profile) does not exist.
- `500 Internal Server Error`: Generic server error, typically due to Firestore communication issues or improper configuration.

---

## Sample Curl Commands

Replace `YOUR_UID` with the user UID and `APPLIANCE_ID` with the appliance document ID.

```powershell
# Generate insights
curl.exe -X POST "http://localhost:3000/api/insights/generate/YOUR_UID" ^
  -H "Content-Type: application/json" ^
  -d "{\"latitude\":14.6495,\"longitude\":121.1163}"

# Generate prediction
curl.exe -X POST "http://localhost:3000/api/prediction/generate/YOUR_UID" ^
  -H "Content-Type: application/json" ^
  -d "{\"latitude\":14.6495,\"longitude\":121.1163}"

# Add a new appliance
curl.exe -X POST "http://localhost:3000/api/prediction/YOUR_UID/appliances" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Tesla Model 3\",\"kwh\":10,\"use_duration\":12,\"is_added\":false}"

# Get all appliances
curl.exe "http://localhost:3000/api/prediction/YOUR_UID/appliances"

# Get one appliance
curl.exe "http://localhost:3000/api/prediction/YOUR_UID/appliances/APPLIANCE_ID"

# Remove one appliance
curl.exe -X DELETE "http://localhost:3000/api/prediction/YOUR_UID/appliances/APPLIANCE_ID"
```

---

## AI Usage Guide

Use this backend in the following order when serving a signed-in user:

1. Resolve the logged-in user's UID from Firebase Auth.
2. Call `POST /api/insights/generate/:uid` when you want fresh insights.
3. Call `POST /api/prediction/generate/:uid` when you want fresh prediction data.
4. Call `GET /api/user-data/:uid` when you only need the cached insights and prediction documents.
5. Call `GET /api/prediction/:uid/appliances` when you need the raw appliance subcollection.
6. Call `GET /api/prediction/:uid/appliances/:id` when you need one appliance record.
7. Call `DELETE /api/prediction/:uid/appliances/:id` when you need to remove an appliance.

### Request rules

- Put `uid` in the URL path for generation and subcollection endpoints.
- Send `latitude` and `longitude` in the JSON body only for prediction generation if location-specific analysis is needed.
- Send `name`, `kwh`, `use_duration`, and `is_added` when creating an appliance.
- Treat `_doc_id` as the Firestore document identifier returned by the API.

### Recommended AI workflow

```text
if the user is new:
  create account profile

if bills were updated or first-time analysis is needed:
  generate insights
  generate prediction

if the UI needs cached data only:
  fetch user-data bundle

if the UI manages appliances:
  list appliances
  add appliance
  read appliance
  delete appliance
```

### Response expectations

- `GET /api/user-data/:uid` returns `{ data: { uid, insights, prediction } }`.
- `GET /api/prediction/:uid/appliances` returns `{ data: [] }` when the user has no appliances.
- `GET /api/prediction/:uid/appliances/:id` returns one appliance or `404` if it does not exist.
- `DELETE /api/prediction/:uid/appliances/:id` returns a success message when deletion succeeds.
- Generation endpoints return the full AI output plus saved fields.
