import { getStreamGuysAccessToken } from './src/services/streamGuysService';

async function testOfficialPostmanApi() {
  console.log('Obtaining Bearer token from StreamGuys OAuth API...');
  const token = await getStreamGuysAccessToken();
  console.log('OAuth Token:', token ? `${token.slice(0, 20)}...` : 'NULL');

  if (!token) {
    console.log('Failed to obtain OAuth token.');
    return;
  }

  const host = 'https://atunwadigital-recast.streamguys1.com';
  
  // 1. Test List Podcasts API
  const listPodcastsUrl = `${host}/api/v1/sgrecast/podcasts/feeds`;
  console.log('\nTesting List Podcasts API:', listPodcastsUrl);
  try {
    const res1 = await fetch(listPodcastsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    console.log('List Podcasts Status:', res1.status);
    if (res1.ok) {
      const data1: any = await res1.json();
      console.log('List Podcasts Data:', JSON.stringify(data1, null, 2).slice(0, 1500));

      // If podcasts exist, test listing episodes for the first podcast
      const podcasts = Array.isArray(data1) ? data1 : (data1.data || data1.podcasts || []);
      if (podcasts.length > 0) {
        const podcastId = podcasts[0].id || podcasts[0].podcast_id || '1';
        const epUrl = `${host}/api/v1/sgrecast/podcasts/episodes/${podcastId}`;
        console.log(`\nTesting List Episodes for Podcast ${podcastId}:`, epUrl);
        const res2 = await fetch(epUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });
        console.log('Episodes API Status:', res2.status);
        if (res2.ok) {
          const data2: any = await res2.json();
          console.log('Episodes Data:', JSON.stringify(data2, null, 2).slice(0, 1500));
        }
      }
    } else {
      console.log('List Podcasts Error Body:', await res1.text());
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

testOfficialPostmanApi();
