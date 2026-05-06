import * as admin from 'firebase-admin';
import { tavilyClient } from '../config/gemini';
import { db } from '../config/firebase';
import { BillDocument, fetchBillsForUser, updateStatus } from './insights.service';
import { performRegression, predict, RegressionData } from '../utils/regression';
import { fetchCoalPrice } from './bill-enrichment.service';

// ============================================================================
// PREDICTION SERVICE - MULTILINEAR REGRESSION
// ============================================================================
//
// Predicts next month's electricity rate using multilinear regression:
// predicted_rate = β₀ + β₁(temp) + β₂(humidity) + β₃(coal_price)
//
// Then calculates predicted bill:
// predicted_bill = (predicted_kwh × predicted_rate) + appliance_price_adjustments
//
// ============================================================================

// --- Types -------------------------------------------------------------------

export interface ApplianceDocument {
    is_added: boolean;
    kwh: number;
    name: string;
    use_duration: number;
    rate_per_kwh?: number;
    price?: number;
}

export interface ApplianceRecord extends ApplianceDocument {
    _doc_id?: string;
}

export interface RegressionCoefficients {
    beta0: number;  // intercept
    beta1_temp: number;
    beta2_humidity: number;
    beta3_coal: number;
}

export interface CurrentConditions {
    temperature: number;
    humidity: number;
    coal_price: number;
    city: string;
    latitude: number;
    longitude: number;
}

export interface PredictionResult {
    anomaly_detected: boolean;
    anomaly_description: string;
    seasonal_bill_surge_prediction: string;
    predicted_kwh_next: number;
    predicted_bill: number;
    historical_baseline_kwh: number;
    location: string;
    city: string;
    avg_temp: number;
    humidity: number;
    temp_change: number;
    kwh_change_prediction: number;
    latitude: number | null;
    longitude: number | null;
    generated_at?: any;
    
    // New regression fields
    predicted_rate_per_kwh: number;
    regression_coefficients: RegressionCoefficients;
    regression_r_squared: number;
    regression_data_points: number;
    current_temperature: number;
    current_humidity: number;
    current_coal_price: number;
    previous_month_kwh: number;
    appliance_kwh_adjustment: number;
    appliance_price_adjustment: number;
    temperature_difference: number;
    humidity_difference: number;
    coal_price_difference: number;
}

export interface PredictionWithJustifications {
    prediction: PredictionResult;
    appliances: ApplianceDocument[];
    appliance_total_monthly_cost: number;
    justifications: Record<string, any>;
    grounding_sources: string[];
}

// --- Fetch Appliances --------------------------------------------------------

export async function fetchAppliancesForUser(uid: string): Promise<ApplianceDocument[]> {
    const snapshot = await db
        .collection('prediction')
        .doc(uid)
        .collection('appliances')
        .get();

    if (snapshot.empty) return [];

    const appliances: ApplianceDocument[] = [];
    snapshot.forEach((doc) => {
        const data = doc.data();
        appliances.push({
            is_added: data.is_added ?? false,
            kwh: data.kwh ?? 0,
            name: data.name ?? 'Unknown',
            use_duration: data.use_duration ?? 0,
            price: data.price ?? 0,
        });
    });

    return appliances;
}

export async function fetchApplianceRecordsForUser(uid: string): Promise<ApplianceRecord[]> {
    const snapshot = await db
        .collection('prediction')
        .doc(uid)
        .collection('appliances')
        .get();

    if (snapshot.empty) return [];

    return snapshot.docs.map((doc) => ({
        _doc_id: doc.id,
        ...(doc.data() as ApplianceDocument),
    }));
}

export async function fetchApplianceRecordForUser(uid: string, applianceId: string): Promise<ApplianceRecord | null> {
    const doc = await db
        .collection('prediction')
        .doc(uid)
        .collection('appliances')
        .doc(applianceId)
        .get();

    if (!doc.exists) return null;

    return {
        _doc_id: doc.id,
        ...(doc.data() as ApplianceDocument),
    };
}

export async function addApplianceForUser(uid: string, appliance: ApplianceDocument): Promise<ApplianceRecord> {
    const docRef = db
        .collection('prediction')
        .doc(uid)
        .collection('appliances')
        .doc();

    await docRef.set(appliance);

    return {
        _doc_id: docRef.id,
        ...appliance,
    };
}

export async function deleteApplianceForUser(uid: string, applianceId: string): Promise<boolean> {
    const docRef = db
        .collection('prediction')
        .doc(uid)
        .collection('appliances')
        .doc(applianceId);

    const existing = await docRef.get();
    if (!existing.exists) return false;

    await docRef.delete();
    return true;
}

// --- Fetch Current Conditions ------------------------------------------------

async function fetchCurrentWeather(
    latitude: number,
    longitude: number
): Promise<{ temperature: number; humidity: number }> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=Asia/Manila`;
    
    console.log(`     🌡️  Fetching current weather...`);
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Weather API failed: ${response.status}`);
    }
    
    const data = await response.json();
    const temperature = data.current?.temperature_2m;
    const humidity = data.current?.relative_humidity_2m;
    
    if (temperature === undefined || humidity === undefined) {
        throw new Error('Missing temperature or humidity in weather response');
    }
    
    console.log(`     ✓ Current: ${temperature}°C, ${humidity}%`);
    
    return { temperature, humidity };
}

async function fetchCityName(
    latitude: number,
    longitude: number
): Promise<string> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
    
    console.log(`     🗺️  Fetching city name...`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Eely-App/1.0'  // Required by Nominatim
        }
    });
    
    if (!response.ok) {
        console.warn(`     ⚠️  Geocoding API failed: ${response.status}, using default`);
        return 'Metro Manila';
    }
    
    const data = await response.json();
    const city = data.address?.city 
        || data.address?.town 
        || data.address?.municipality 
        || data.address?.county 
        || 'Metro Manila';
    
    console.log(`     ✓ City: ${city}`);
    
    return city;
}

async function fetchCurrentConditions(
    latitude: number,
    longitude: number
): Promise<CurrentConditions> {
    console.log(`\n  🌐 Step 4/6: Fetching current conditions...`);
    
    // Fetch in parallel
    const [weather, coalData, city] = await Promise.all([
        fetchCurrentWeather(latitude, longitude),
        fetchCoalPrice(new Date().toISOString().split('T')[0]),
        fetchCityName(latitude, longitude),
    ]);
    
    console.log(`     ✓ Coal price: $${coalData.value}/ton`);
    
    return {
        temperature: weather.temperature,
        humidity: weather.humidity,
        coal_price: coalData.value,
        city,
        latitude,
        longitude,
    };
}

// --- Regression Functions ----------------------------------------------------

function prepareRegressionData(bills: BillDocument[]): RegressionData | null {
    console.log(`     📋 Total bills fetched: ${bills.length}`);
    
    // Count bills by missing fields
    let missingTemp = 0;
    let missingHumidity = 0;
    let missingCoal = 0;
    let missingRate = 0;
    
    bills.forEach(bill => {
        if (bill.avg_temperature === null || bill.avg_temperature === undefined) missingTemp++;
        if (bill.avg_humidity === null || bill.avg_humidity === undefined) missingHumidity++;
        if (bill.coal_price === null || bill.coal_price === undefined) missingCoal++;
        if (bill.rate_per_kwh === null || bill.rate_per_kwh === undefined || bill.rate_per_kwh <= 0) missingRate++;
    });
    
    console.log(`     📊 Bills missing data:`);
    console.log(`        - Temperature: ${missingTemp} bills`);
    console.log(`        - Humidity: ${missingHumidity} bills`);
    console.log(`        - Coal Price: ${missingCoal} bills`);
    console.log(`        - Rate per kWh: ${missingRate} bills`);
    
    const validBills = bills.filter(bill =>
        bill.avg_temperature !== null &&
        bill.avg_temperature !== undefined &&
        bill.avg_humidity !== null &&
        bill.avg_humidity !== undefined &&
        bill.coal_price !== null &&
        bill.coal_price !== undefined &&
        bill.rate_per_kwh !== null &&
        bill.rate_per_kwh !== undefined &&
        bill.rate_per_kwh > 0 &&
        isFinite(bill.avg_temperature) &&
        isFinite(bill.avg_humidity) &&
        isFinite(bill.coal_price) &&
        isFinite(bill.rate_per_kwh)
    );
    
    console.log(`     ✓ Bills with complete data: ${validBills.length}`);
    
    if (validBills.length < 4) {
        console.warn(`     ⚠️  Insufficient data: ${validBills.length} bills with complete data (need ≥4)`);
        console.warn(`     💡 TIP: Run bill enrichment to add weather and coal price data to your bills`);
        console.warn(`     💡 Endpoint: POST /api/bills/:billId/enrich`);
        return null;
    }
    
    const independent: number[][] = [];
    const dependent: number[] = [];
    
    for (const bill of validBills) {
        independent.push([
            bill.avg_temperature!,
            bill.avg_humidity!,
            bill.coal_price!,
        ]);
        dependent.push(bill.rate_per_kwh!);
    }
    
    console.log(`     ✓ Prepared ${validBills.length} data points for regression`);
    
    // Debug: Log the data ranges
    const temps = independent.map(row => row[0]);
    const humidities = independent.map(row => row[1]);
    const coalPrices = independent.map(row => row[2]);
    
    console.log(`     📊 Data ranges:`);
    console.log(`        Temperature: ${Math.min(...temps).toFixed(2)}°C - ${Math.max(...temps).toFixed(2)}°C`);
    console.log(`        Humidity: ${Math.min(...humidities).toFixed(2)}% - ${Math.max(...humidities).toFixed(2)}%`);
    console.log(`        Coal Price: $${Math.min(...coalPrices).toFixed(2)} - $${Math.max(...coalPrices).toFixed(2)}`);
    console.log(`        Rate: ₱${Math.min(...dependent).toFixed(2)} - ₱${Math.max(...dependent).toFixed(2)}/kWh`);
    
    return { independent, dependent };
}

function validateRegressionResult(
    coefficients: number[],
    rSquared: number,
    predictedRate: number
): boolean {
    // Check R-squared
    if (rSquared < 0.3) {
        console.warn(`     ⚠️  Low R²: ${rSquared.toFixed(4)} (model may not fit well)`);
    }
    
    // Check predicted rate
    if (predictedRate < 5 || predictedRate > 20) {
        console.warn(`     ⚠️  Unrealistic rate: ₱${predictedRate.toFixed(2)}/kWh`);
        return false;
    }
    
    // Check coefficients for NaN or Infinity
    if (coefficients.some(c => !isFinite(c))) {
        console.warn(`     ⚠️  Invalid coefficients`);
        return false;
    }
    
    return true;
}

// --- Appliance Calculations --------------------------------------------------

function computeApplianceKwhAdjustment(appliances: ApplianceDocument[]): number {
    return appliances.reduce((sum, a) => {
        const monthlyKwh = a.kwh * 30;
        return sum + (a.is_added ? monthlyKwh : -monthlyKwh);
    }, 0);
}

function computeAppliancePriceAdjustment(appliances: ApplianceDocument[]): number {
    return appliances.reduce((sum, a) => {
        const monthlyPrice = (a.price || 0) * 30;
        return sum + (a.is_added ? monthlyPrice : -monthlyPrice);
    }, 0);
}

// --- Save to Firestore -------------------------------------------------------

export async function savePrediction(uid: string, result: PredictionWithJustifications): Promise<void> {
    const docData: any = {
        ...result.prediction,
        account_id: uid,
        generated_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (result.appliances.length > 0) {
        docData.appliance_analysis = result.appliances;
        docData.appliance_total_monthly_cost = result.appliance_total_monthly_cost;
    }

    await db.collection('prediction').doc(uid).set(docData, { merge: true });
}

// --- Get Cached --------------------------------------------------------------

export async function getPrediction(uid: string): Promise<PredictionResult | null> {
    const doc = await db.collection('prediction').doc(uid).get();
    if (!doc.exists) return null;
    return doc.data() as PredictionResult;
}

export async function fetchPredictionForUser(uid: string): Promise<PredictionResult | null> {
    const directDoc = await db.collection('prediction').doc(uid).get();

    if (directDoc.exists) {
        return { ...directDoc.data(), _doc_id: directDoc.id } as any;
    }

    const fallbackSnapshot = await db
        .collection('prediction')
        .where('account_id', '==', uid)
        .limit(1)
        .get();

    if (fallbackSnapshot.empty) return null;

    const doc = fallbackSnapshot.docs[0];
    return { ...doc.data(), _doc_id: doc.id } as any;
}

// --- Full Pipeline -----------------------------------------------------------

export async function generatePrediction(
    uid: string,
    latitude: number | null = null,
    longitude: number | null = null,
): Promise<PredictionWithJustifications> {
    // Default to Manila if no coordinates
    const lat = latitude ?? 14.5995;
    const lon = longitude ?? 120.9842;
    
    console.log(`\n  📋 Step 1/6: Fetching historical bills...`);
    await updateStatus(uid, 'prediction', 'Fetching historical bills...');
    
    const bills = await fetchBillsForUser(uid);
    
    if (bills.length === 0) {
        throw new Error('No bills found. Add at least one bill to generate predictions.');
    }
    
    console.log(`     ✓ Found ${bills.length} bills`);
    
    console.log(`\n  📊 Step 2/6: Preparing regression data...`);
    await updateStatus(uid, 'prediction', 'Analyzing historical patterns...');
    
    const regressionData = prepareRegressionData(bills);
    
    let regression;
    let usedFallback = false;
    
    if (!regressionData) {
        console.warn(`     ⚠️  Insufficient data for regression (need 4 complete bills). Using historical average as fallback.`);
        usedFallback = true;
        
        // Calculate average rate from whatever bills have it
        const validRates = bills
            .map(b => b.rate_per_kwh)
            .filter(r => r !== null && r !== undefined && r > 0) as number[];
        
        const avgRate = validRates.length > 0 
            ? validRates.reduce((sum, r) => sum + r, 0) / validRates.length
            : 10.5; // Default Meralco-ish rate if no rates found
            
        regression = {
            coefficients: [avgRate, 0, 0, 0],
            rSquared: 0,
            dataPoints: validRates.length,
        };
    } else {
        console.log(`\n  🧮 Step 3/6: Calculating regression coefficients...`);
        await updateStatus(uid, 'prediction', 'Computing predictive model...');
        
        try {
            regression = performRegression(regressionData);
        
        // Check for NaN in coefficients
        if (regression.coefficients.some(c => !isFinite(c)) || !isFinite(regression.rSquared)) {
            throw new Error('Regression produced invalid coefficients (NaN or Infinity)');
        }
        
        console.log(`     ✓ R² = ${regression.rSquared.toFixed(4)}`);
        console.log(`     ✓ Coefficients: β₀=${regression.coefficients[0].toFixed(4)}, β₁=${regression.coefficients[1].toFixed(4)}, β₂=${regression.coefficients[2].toFixed(4)}, β₃=${regression.coefficients[3].toFixed(4)}`);
    } catch (error: any) {
        console.warn(`     ⚠️  Regression failed: ${error.message}`);
        console.warn(`     ⚠️  Using fallback: average of historical rates`);
        usedFallback = true;
        
        // Fallback: use average of historical rates
        const rates = regressionData.dependent;
        const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
        
        regression = {
            coefficients: [avgRate, 0, 0, 0],  // Only intercept, no variable effects
            rSquared: 0,
            dataPoints: rates.length,
        };
        
        console.log(`     ✓ Fallback average rate: ₱${avgRate.toFixed(2)}/kWh`);
        }
    }
    
    const current = await fetchCurrentConditions(lat, lon);
    
    console.log(`\n  ⚡ Step 5/6: Predicting kWh rate...`);
    await updateStatus(uid, 'prediction', 'Predicting electricity rate...');
    
    let predictedRate;
    
    if (usedFallback) {
        // Use the average rate directly
        predictedRate = regression.coefficients[0];
    } else {
        predictedRate = predict(regression.coefficients, [
            current.temperature,
            current.humidity,
            current.coal_price,
        ]);
    }
    
    console.log(`     ✓ Predicted rate: ₱${predictedRate.toFixed(2)}/kWh`);
    
    // Validate predicted rate
    const isValid = !usedFallback && validateRegressionResult(regression.coefficients, regression.rSquared, predictedRate);
    if (!isValid && !usedFallback) {
        console.warn(`     ⚠️  Predicted rate failed validation, using average of historical rates`);
        const rates = regressionData!.dependent;
        predictedRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
        usedFallback = true;
    }
    
    console.log(`\n  🔌 Step 6/6: Calculating final prediction...`);
    await updateStatus(uid, 'prediction', 'Finalizing predictions...');
    
    const appliances = await fetchAppliancesForUser(uid);
    const applianceKwhAdj = computeApplianceKwhAdjustment(appliances);
    const appliancePriceAdj = computeAppliancePriceAdjustment(appliances);
    
    // Get most recent bill's kWh and environmental data
    const sortedBills = [...bills].sort((a, b) =>
        new Date(b.end_date || b.start_date || 0).getTime() -
        new Date(a.end_date || a.start_date || 0).getTime()
    );
    const previousMonthKwh = sortedBills[0]?.total_kwh_used || 0;
    const previousMonthTemp = sortedBills[0]?.avg_temperature || null;
    const previousMonthHumidity = sortedBills[0]?.avg_humidity || null;
    const previousMonthCoalPrice = sortedBills[0]?.coal_price || null;
    
    // Calculate differences (current vs previous month)
    const temperatureDifference = previousMonthTemp !== null 
        ? current.temperature - previousMonthTemp 
        : 0;
    const humidityDifference = previousMonthHumidity !== null 
        ? current.humidity - previousMonthHumidity 
        : 0;
    const coalPriceDifference = previousMonthCoalPrice !== null 
        ? current.coal_price - previousMonthCoalPrice 
        : 0;
    
    // Calculate predicted kWh and bill
    // Note: price field already includes the full cost (kwh × rate), so we only add it to the bill
    const predictedKwh = previousMonthKwh + applianceKwhAdj;
    const predictedBill = (previousMonthKwh * predictedRate) + appliancePriceAdj;
    
    console.log(`     ✓ Previous month: ${previousMonthKwh} kWh`);
    console.log(`     ✓ Appliance kWh adjustment: ${applianceKwhAdj.toFixed(2)} kWh`);
    console.log(`     ✓ Predicted kWh (for display): ${predictedKwh.toFixed(2)} kWh`);
    console.log(`     ✓ Appliance price adjustment: ₱${appliancePriceAdj.toFixed(2)}`);
    console.log(`     ✓ Predicted bill: ₱${predictedBill.toFixed(2)}`);
    console.log(`     ✓ Temperature difference: ${temperatureDifference.toFixed(2)}°C`);
    console.log(`     ✓ Humidity difference: ${humidityDifference.toFixed(2)}%`);
    console.log(`     ✓ Coal price difference: $${coalPriceDifference.toFixed(2)}/ton`);
    
    // Build result
    const result: PredictionWithJustifications = {
        prediction: {
            anomaly_detected: false,
            anomaly_description: '',
            seasonal_bill_surge_prediction: `Based on current conditions (${current.temperature}°C, ${current.humidity}% humidity), your next bill is predicted to be ₱${predictedBill.toFixed(2)}.`,
            predicted_kwh_next: Math.round(predictedKwh * 100) / 100,
            predicted_bill: Math.round(predictedBill * 100) / 100,
            historical_baseline_kwh: previousMonthKwh,
            location: current.city,
            city: current.city,
            avg_temp: current.temperature,
            humidity: current.humidity,
            temp_change: Math.round(temperatureDifference * 100) / 100,
            kwh_change_prediction: previousMonthKwh > 0 
                ? Math.round(((predictedKwh - previousMonthKwh) / previousMonthKwh) * 10000) / 100
                : 0,
            latitude: lat,
            longitude: lon,
            predicted_rate_per_kwh: Math.round(predictedRate * 100) / 100,
            regression_coefficients: {
                beta0: regression.coefficients[0],
                beta1_temp: regression.coefficients[1],
                beta2_humidity: regression.coefficients[2],
                beta3_coal: regression.coefficients[3],
            },
            regression_r_squared: Math.round(regression.rSquared * 10000) / 10000,
            regression_data_points: regression.dataPoints,
            current_temperature: current.temperature,
            current_humidity: current.humidity,
            current_coal_price: current.coal_price,
            previous_month_kwh: previousMonthKwh,
            appliance_kwh_adjustment: Math.round(applianceKwhAdj * 100) / 100,
            appliance_price_adjustment: Math.round(appliancePriceAdj * 100) / 100,
            temperature_difference: Math.round(temperatureDifference * 100) / 100,
            humidity_difference: Math.round(humidityDifference * 100) / 100,
            coal_price_difference: Math.round(coalPriceDifference * 100) / 100,
        },
        appliances: appliances,
        appliance_total_monthly_cost: Math.round(Math.abs(appliancePriceAdj) * 100) / 100,
        justifications: {},
        grounding_sources: [],
    };
    
    // Save to Firestore
    await savePrediction(uid, result);
    
    await updateStatus(uid, 'prediction', 'Done');
    console.log(`\n  ✅ Prediction complete!`);
    return result;
}

// Made with Bob
