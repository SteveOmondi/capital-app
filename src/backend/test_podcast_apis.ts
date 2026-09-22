import { getStreamGuysAccessToken } from './src/services/streamGuysService';

async function testApis() {
  console.log('=== 1. Checking WP Public API: /wp-json/capitalfm/v1/podcasts ===');
  try {
    const wpRes = await fetch('https://capitalfm.africa/wp-json/capitalfm/v1/podcasts');
    console.log('WP Status:', wpRes.status);
    if (wpRes.ok) {
      const wpData: any = await wpRes.json();
      console.log('WP Response snippet:', JSON.stringify(wpData, null, 2).slice(0, 800));
    }
  } catch (e: any) {
    console.log('WP Error:', e.message);
  }

  console.log('\n=== 2. Checking WP Public API: /wp-json/capitalfm/v1/podcasts/groups ===');
  try {
    const res = await fetch('https://capitalfm.africa/wp-json/capitalfm/v1/podcasts/groups');
    console.log('Groups Status:', res.status);
    if (res.ok) {
      const data: any = await res.json();
      console.log('Groups Response:', JSON.stringify(data, null, 2));
    }
  } catch (e: any) {
    console.log('Groups Error:', e.message);
  }

  console.log('\n=== 3. Checking WP Public API: /wp-json/capitalfm/v1/podcasts/episodes ===');
  try {
    const res = await fetch('https://capitalfm.africa/wp-json/capitalfm/v1/podcasts/episodes');
    console.log('Episodes Status:', res.status);
    if (res.ok) {
      const data: any = await res.json();
      console.log('Episodes count:', data.data?.length || data.length);
      if (data.data && data.data.length > 0) {
        console.log('Sample Episode:', JSON.stringify(data.data[0], null, 2));
      }
    }
  } catch (e: any) {
    console.log('Episodes Error:', e.message);
  }
}

testApis();
