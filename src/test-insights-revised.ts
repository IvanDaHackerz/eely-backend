/**
 * Test script for revised insights service
 * 
 * This tests the new individual loop-based fetching for fuel prices and kWh retail prices
 * 
 * Usage:
 *   npx ts-node src/test-insights-revised.ts <uid>
 * 
 * Example:
 *   npx ts-node src/test-insights-revised.ts test-user-123
 */

import { generateInsights, getInsights } from './services/insights.service';

async function testRevisedInsights() {
    const uid = process.argv[2];
    
    if (!uid) {
        console.error('❌ Error: Please provide a user ID');
        console.log('Usage: npx ts-node src/test-insights-revised.ts <uid>');
        process.exit(1);
    }

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         TESTING REVISED INSIGHTS SERVICE                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n🔍 Testing for user: ${uid}\n`);

    try {
        console.log('📊 Generating insights with new loop-based fetching...\n');
        const startTime = Date.now();
        
        const result = await generateInsights(uid);
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                    RESULTS                                     ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');
        
        console.log('✅ Insights generated successfully!\n');
        console.log(`⏱️  Total time: ${elapsed}s\n`);
        
        console.log('📈 Key Metrics:');
        console.log(`   • Total kWh Used: ${result.insights.total_kwh_used}`);
        console.log(`   • Avg kWh/Day: ${result.insights.avg_kwh_per_day}`);
        console.log(`   • Consumer Profile: ${result.insights.consumer_profile_class}`);
        console.log(`   • Efficiency Trend: ${result.insights.efficiency_trend}`);
        console.log(`   • Monthly Trend: ${result.insights.monthly_consumption_trend}%`);
        
        console.log('\n💰 Price Data (NEW LOOP-BASED FETCHING):');
        console.log(`   • kWh Retail Price: ${result.insights.kwh_retail_price} PHP/kWh`);
        console.log(`   • Fuel Price: ${result.insights.fuel_prices} USD/ton`);
        console.log(`   • Risk Level: ${result.insights.risk_level}`);
        
        console.log('\n📍 Location:');
        console.log(`   • Latitude: ${result.insights.latitude}`);
        console.log(`   • Longitude: ${result.insights.longitude}`);
        
        console.log('\n🔗 Grounding Sources:');
        result.grounding_sources.forEach((source, idx) => {
            console.log(`   ${idx + 1}. ${source}`);
        });
        
        console.log('\n📝 Sample Justifications:');
        const sampleFields = ['fuel_prices', 'kwh_retail_price', 'risk_level'];
        sampleFields.forEach(field => {
            const just = result.justifications[field];
            if (just) {
                console.log(`\n   ${field}:`);
                console.log(`   • Value: ${just.value}`);
                console.log(`   • Reasoning: ${just.reasoning}`);
                console.log(`   • Source: ${just.source}`);
                console.log(`   • Methodology: ${just.methodology}`);
            }
        });
        
        console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║              VERIFICATION CHECKLIST                            ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');
        
        const checks = [
            { name: 'kWh retail price is a number', pass: typeof result.insights.kwh_retail_price === 'number' },
            { name: 'Fuel price is a number', pass: typeof result.insights.fuel_prices === 'number' },
            { name: 'Grounding sources include price data', pass: result.grounding_sources.some(s => s.includes('kWh') || s.includes('Coal')) },
            { name: 'Risk level is set', pass: ['low', 'moderate', 'high'].includes(result.insights.risk_level) },
            { name: 'Justifications exist for prices', pass: !!result.justifications.fuel_prices && !!result.justifications.kwh_retail_price },
        ];
        
        checks.forEach(check => {
            const icon = check.pass ? '✅' : '❌';
            console.log(`${icon} ${check.name}`);
        });
        
        const allPassed = checks.every(c => c.pass);
        
        if (allPassed) {
            console.log('\n🎉 All checks passed! The revised implementation is working correctly.\n');
        } else {
            console.log('\n⚠️  Some checks failed. Please review the implementation.\n');
        }
        
        // Test retrieval
        console.log('🔄 Testing cached insights retrieval...');
        const cached = await getInsights(uid);
        if (cached) {
            console.log('✅ Successfully retrieved cached insights from Firestore\n');
        } else {
            console.log('❌ Failed to retrieve cached insights\n');
        }
        
    } catch (error: any) {
        console.error('\n❌ Error generating insights:');
        console.error(error.message);
        console.error('\nStack trace:');
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testRevisedInsights().then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});

// Made with Bob
