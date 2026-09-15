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

  console.log('\n=== 2. Checking Atunwa SGrecast REST API: /api/v1/sgrecast/podcasts/feeds ===');
  try {
    const token = await getStreamGuysAccessToken();
    if (token) {
      const res = await fetch('https://atunwadigital-recast.streamguys1.com/api/v1/sgrecast/podcasts/feeds', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });
      console.log('Atunwa API Status:', res.status);
      if (res.ok) {
        const data: any = await res.json();
        const items = data.data || data;
        console.log('Atunwa API count:', items.length);
        console.log('Sample item:', JSON.stringify(items[0], null, 2));
      }
    }
  } catch (e: any) {
    console.log('Atunwa API Error:', e.message);
  }
}

testApis();
