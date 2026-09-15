import { config } from './src/config';

async function testStreamGuysApiAuth() {
  console.log('=== Testing StreamGuys API Authentication & Podcast Endpoint ===\n');

  const host = config.streamguys.host || 'https://atunwadigital-recast.streamguys1.com';
  const clientId = config.streamguys.clientId;
  const clientSecret = config.streamguys.clientSecret;
  const username = config.streamguys.username;
  const password = config.streamguys.password;

  console.log('Target Host:', host);
  console.log('Client ID:', clientId);
  console.log('Username:', username);

  // 1. Try OAuth Client Credentials (/oauth/token)
  console.log('\n--- 1. Testing /oauth/token ---');
  try {
    const res1 = await fetch(`${host}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: '*',
      }),
    });
    console.log('Status:', res1.status);
    const body1 = await res1.text();
    console.log('Response:', body1);

    if (res1.ok) {
      const tokenData = JSON.parse(body1);
      const token = tokenData.access_token;
      console.log('\nToken obtained:', token.slice(0, 25) + '...');

      // Probe podcast API endpoints using Bearer token
      const endpoints = [
        '/api/v1/sgrecast/podcasts/feeds',
        '/api/v1/podcasts',
        '/api/v1/feeds',
        '/api/v1/podcasts/feeds',
        '/sgrecast/podcasts/feeds/list',
      ];

      for (const ep of endpoints) {
        console.log(`\nTesting Bearer Token on ${ep}...`);
        const epRes = await fetch(`${host}${ep}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });
        console.log(`Status ${epRes.status} for ${ep}`);
        if (epRes.ok) {
          const epData = await epRes.json();
          console.log(`SUCCESS on ${ep}! Data snippet:`, JSON.stringify(epData).slice(0, 500));
        } else {
          console.log(`Error body for ${ep}:`, (await epRes.text()).slice(0, 200));
        }
      }
    }
  } catch (err: any) {
    console.error('OAuth token test error:', err.message);
  }

  // 2. Try REST API Login (/api/v1/login or /api/login)
  console.log('\n--- 2. Testing API Login Endpoints ---');
  const loginEndpoints = [
    '/api/v1/login',
    '/api/login',
    '/api/v1/auth/login',
    '/api/auth/login',
  ];

  for (const loginEp of loginEndpoints) {
    try {
      console.log(`Testing API login: ${loginEp}...`);
      const resLogin = await fetch(`${host}${loginEp}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });
      console.log(`Status ${resLogin.status} for ${loginEp}`);
      if (resLogin.ok) {
        const loginData = await resLogin.json();
        console.log(`SUCCESS API Login on ${loginEp}!`, JSON.stringify(loginData).slice(0, 500));
      } else {
        const errText = await resLogin.text();
        console.log(`Error body for ${loginEp}:`, errText.slice(0, 150));
      }
    } catch (err: any) {
      console.log(`Error testing ${loginEp}:`, err.message);
    }
  }

  // 3. Try Basic Auth API
  console.log('\n--- 3. Testing Basic Auth on API endpoints ---');
  const basicAuthHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const apiEndpoints = [
    '/api/v1/sgrecast/podcasts/feeds',
    '/api/v1/podcasts',
    '/api/v1/feeds',
    '/sgrecast/podcasts/feeds/list',
  ];

  for (const ep of apiEndpoints) {
    try {
      console.log(`Testing Basic Auth on ${ep}...`);
      const resBasic = await fetch(`${host}${ep}`, {
        headers: {
          'Authorization': basicAuthHeader,
          'Accept': 'application/json',
        },
      });
      console.log(`Status ${resBasic.status} for ${ep}`);
      if (resBasic.ok) {
        const data = await resBasic.json();
        console.log(`SUCCESS Basic Auth on ${ep}! Data snippet:`, JSON.stringify(data).slice(0, 500));
      }
    } catch (err: any) {
      console.log(`Error testing Basic Auth on ${ep}:`, err.message);
    }
  }
}

testStreamGuysApiAuth();
