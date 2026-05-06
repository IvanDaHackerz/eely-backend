import { generatePrediction } from './services/prediction.service';

/**
 * Test script for multilinear regression prediction system
 * 
 * Usage:
 * 1. Replace TEST_UID with an actual user ID that has bills
 * 2. Run: npx ts-node src/test-prediction-regression.ts
 */

const TEST_UID = 'YOUR_USER_ID_HERE';  // Replace with actual UID
const TEST_LATITUDE = 14.5995;   // Manila coordinates
const TEST_LONGITUDE = 120.9842;

async function testPrediction() {
    console.log('='.repeat(80));
    console.log('TESTING MULTILINEAR REGRESSION PREDICTION SYSTEM');
    console.log('='.repeat(80));
    console.log(`\nUser ID: ${TEST_UID}`);
    console.log(`Location: ${TEST_LATITUDE}, ${TEST_LONGITUDE}\n`);
    
    try {
        const result = await generatePrediction(TEST_UID, TEST_LATITUDE, TEST_LONGITUDE);
        
        console.log('\n' + '='.repeat(80));
        console.log('PREDICTION RESULT');
        console.log('='.repeat(80));
        
        console.log('\n📊 REGRESSION MODEL:');
        console.log(`   R² (goodness of fit): ${result.prediction.regression_r_squared.toFixed(4)}`);
        console.log(`   Data points used: ${result.prediction.regression_data_points}`);
        console.log(`   Coefficients:`);
        console.log(`     β₀ (intercept):     ${result.prediction.regression_coefficients.beta0.toFixed(6)}`);
        console.log(`     β₁ (temperature):   ${result.prediction.regression_coefficients.beta1_temp.toFixed(6)}`);
        console.log(`     β₂ (humidity):      ${result.prediction.regression_coefficients.beta2_humidity.toFixed(6)}`);
        console.log(`     β₃ (coal price):    ${result.prediction.regression_coefficients.beta3_coal.toFixed(6)}`);
        
        console.log('\n🌐 CURRENT CONDITIONS:');
        console.log(`   Location: ${result.prediction.city}`);
        console.log(`   Temperature: ${result.prediction.current_temperature}°C`);
        console.log(`   Humidity: ${result.prediction.current_humidity}%`);
        console.log(`   Coal Price: $${result.prediction.current_coal_price}/ton`);
        
        console.log('\n📈 CHANGES FROM PREVIOUS MONTH:');
        console.log(`   Temperature: ${result.prediction.temperature_difference > 0 ? '+' : ''}${result.prediction.temperature_difference.toFixed(2)}°C`);
        console.log(`   Humidity: ${result.prediction.humidity_difference > 0 ? '+' : ''}${result.prediction.humidity_difference.toFixed(2)}%`);
        console.log(`   Coal Price: ${result.prediction.coal_price_difference > 0 ? '+' : ''}$${result.prediction.coal_price_difference.toFixed(2)}/ton`);
        
        console.log('\n⚡ ELECTRICITY RATE:');
        console.log(`   Predicted Rate: ₱${result.prediction.predicted_rate_per_kwh.toFixed(2)}/kWh`);
        
        console.log('\n🔌 CONSUMPTION:');
        console.log(`   Previous Month: ${result.prediction.previous_month_kwh} kWh`);
        console.log(`   Appliance Adjustment: ${result.prediction.appliance_kwh_adjustment > 0 ? '+' : ''}${result.prediction.appliance_kwh_adjustment.toFixed(2)} kWh`);
        console.log(`   Predicted Next Month: ${result.prediction.predicted_kwh_next.toFixed(2)} kWh`);
        console.log(`   Change: ${result.prediction.kwh_change_prediction > 0 ? '+' : ''}${result.prediction.kwh_change_prediction.toFixed(2)}%`);
        
        console.log('\n💰 BILL PREDICTION:');
        console.log(`   Base Bill: ₱${(result.prediction.predicted_kwh_next * result.prediction.predicted_rate_per_kwh).toFixed(2)}`);
        console.log(`   Appliance Adjustment: ${result.prediction.appliance_price_adjustment > 0 ? '+' : ''}₱${result.prediction.appliance_price_adjustment.toFixed(2)}`);
        console.log(`   TOTAL PREDICTED BILL: ₱${result.prediction.predicted_bill.toFixed(2)}`);
        
        if (result.appliances.length > 0) {
            console.log('\n🏠 APPLIANCES:');
            result.appliances.forEach(appliance => {
                const status = appliance.is_added ? '✅ ADDED' : '❌ REMOVED';
                console.log(`   ${status} ${appliance.name}: ${appliance.kwh} kWh/use, ${appliance.use_duration}h/day, ₱${appliance.price || 0}/day`);
            });
            console.log(`   Total Monthly Impact: ₱${result.appliance_total_monthly_cost.toFixed(2)}`);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ TEST COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
        
        // Output full JSON for debugging
        console.log('\n📋 FULL JSON OUTPUT:');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error: any) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ TEST FAILED');
        console.error('='.repeat(80));
        console.error('\nError:', error.message);
        if (error.stack) {
            console.error('\nStack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run the test
testPrediction().then(() => {
    console.log('\n✅ Test script completed');
    process.exit(0);
}).catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
});

// Made with Bob
