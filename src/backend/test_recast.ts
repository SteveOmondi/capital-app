import { streamGuysService } from './src/services/streamGuysService';

async function testFetchRecastApi() {
  console.log('Authenticating with StreamGuys Recast Portal API...');
  const authenticated = await streamGuysService.authenticate();
  console.log('Authentication result:', authenticated);

  if (authenticated) {
    console.log('Fetching podcast feeds list from StreamGuys API...');
    const feedsUrl = 'https://atunwadigital-recast.streamguys1.com/sgrecast/podcasts/feeds/list?page=1&table-id=0&ct-length=50&ct-sort-column=created_at&ct-sort-order=desc';
    
    const res = await streamGuysService.fetchWithAuth(feedsUrl);
    console.log('API Status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('API Response keys:', Object.keys(data));
      console.log('Data snippet:', JSON.stringify(data).slice(0, 1000));
    }
  }
}

testFetchRecastApi();
