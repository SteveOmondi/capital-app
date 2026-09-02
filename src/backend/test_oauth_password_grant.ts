import { config } from './src/config';

async function testOAuthPasswordGrant() {
  const host = config.streamguys.host || 'https://atunwadigital-recast.streamguys1.com';
  const tokenUrl = `${host.replace(/\/$/, '')}/oauth/token`;
  
  console.log('Testing OAuth Password Grant:', tokenUrl);

  const payload = {
    grant_type: 'password',
    client_id: config.streamguys.clientId || '17',
    client_secret: config.streamguys.clientSecret || 'rKwdzxQRLgTv2ZnfuGa5629TGjqbq16GRqFfny32',
    username: config.streamguys.username || 'kenkipkorir',
    password: config.streamguys.password || '$P$BauGLJ5MZftON3OF1/',
    scope: '*',
  };

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('Token Status:', res.status);
    const data: any = await res.json();
    console.log('Token Response:', JSON.stringify(data, null, 2));

    if (res.ok && data.access_token) {
      const accessToken = data.access_token;
      console.log('\nSUCCESS! Received Access Token. Testing GET /api/v1/sgrecast/podcasts/feeds...');

      const listRes = await fetch(`${host}/api/v1/sgrecast/podcasts/feeds`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      console.log('List Feeds Status:', listRes.status);
      const feedsData: any = await listRes.json();
      console.log('List Feeds Response:', JSON.stringify(feedsData, null, 2).slice(0, 1500));
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

testOAuthPasswordGrant();
