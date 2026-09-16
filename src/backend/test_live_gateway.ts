import { getLiveState } from './src/services/scheduleService';

async function testLiveGateway() {
  console.log('Testing getLiveState() in backend scheduleService...');
  try {
    const liveState = await getLiveState();
    console.log('\n=== LIVE STATE ENDPOINT RESULT ===');
    console.log(JSON.stringify(liveState, null, 2));
    console.log('\n=== LIVE GATEWAY TEST PASSED! ===');
  } catch (err: any) {
    console.error('Error testing live gateway:', err.message);
  }
}

testLiveGateway();
