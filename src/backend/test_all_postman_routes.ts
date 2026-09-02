import { getStreamGuysAccessToken } from './src/services/streamGuysService';

async function testAllPostmanRoutes() {
  const token = await getStreamGuysAccessToken();
  console.log('Testing Bearer token on Postman routes:', token ? `${token.slice(0, 25)}...` : 'NULL');

  if (!token) return;

  const host = 'https://atunwadigital-recast.streamguys1.com';
  const routes = [
    '/api/v1/sgrecast/podcasts/feeds',
    '/api/v1/sgrecast/podcasts/players',
    '/api/v1/sgrecast/servers',
    '/api/v1/sgrecast/sidechannels/broadcasts',
    '/api/v1/sgrecast/sidechannels/records',
    '/api/v1/sgrecast/tags',
  ];

  for (const route of routes) {
    const url = `${host}${route}`;
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });
      console.log(`Route: ${route} | Status: ${res.status}`);
      if (res.ok) {
        const body: any = await res.json();
        console.log(`  SUCCESS! Body keys: ${Object.keys(body).join(', ')}`);
      } else {
        const errText = await res.text();
        console.log(`  Error body: ${errText.slice(0, 200)}`);
      }
    } catch (e: any) {
      console.log(`Route: ${route} | Error: ${e.message}`);
    }
  }
}

testAllPostmanRoutes();
