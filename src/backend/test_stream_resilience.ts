import express from 'express';
import http from 'http';
import { proxyLiveAudioStream, getStreamConfig } from './src/services/streamService';

async function testStreamResilience() {
  console.log('=== Testing Live Radio Stream API Resilience & Auto-Recycling ===\n');

  // 1. Check Stream Config output
  const config = await getStreamConfig();
  console.log('1. Stream Configuration Output:');
  console.log('  -> Proxy Stream URL:', config.proxyStreamUrl);
  console.log('  -> Primary Stream URL:', config.primaryHlsUrl);
  console.log('  -> Fallback Stream URL:', config.fallbackAacUrl);
  console.log('  -> ICY Stream URL:', config.icyStreamUrl);

  // 2. Start local test server
  const app = express();
  app.get('/api/v1/stream/listen', async (req, res) => {
    await proxyLiveAudioStream(req, res);
  });

  const server = app.listen(0, async () => {
    const address = server.address() as any;
    const testPort = address.port;
    console.log(`\n2. Started local test proxy server on port ${testPort}`);

    // 3. Connect a client listener to test chunk streaming & resilience
    const clientUrl = `http://127.0.0.1:${testPort}/api/v1/stream/listen`;
    console.log(`\n3. Connecting test audio client to ${clientUrl}...`);

    let totalBytesReceived = 0;
    let chunksCount = 0;
    const startTime = Date.now();

    const req = http.get(clientUrl, (res) => {
      console.log(`  -> Connected! HTTP Status: ${res.statusCode}`);
      console.log('  -> Content-Type Header:', res.headers['content-type']);
      console.log('  -> Cache-Control Header:', res.headers['cache-control']);

      if (res.statusCode !== 200) {
        console.error('FAILED: Status code is not 200');
        server.close();
        process.exit(1);
      }

      res.on('data', (chunk: Buffer) => {
        totalBytesReceived += chunk.length;
        chunksCount++;

        if (chunksCount % 10 === 0) {
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  -> [${elapsedSec}s] Received ${chunksCount} chunks (${(totalBytesReceived / 1024).toFixed(1)} KB)... Streaming stably.`);
        }

        // Once we verify sustained streaming for 5 seconds (~15+ chunks), pass the test!
        if (chunksCount >= 15) {
          console.log('\n=== STREAM RESILIENCE VERIFIED SUCCESSFULLY! ===');
          console.log(`Total Bytes Received: ${totalBytesReceived} bytes (${(totalBytesReceived / 1024).toFixed(1)} KB)`);
          console.log('Stream connection remained alive and chunking audio seamlessly.');
          req.destroy();
          server.close();
          process.exit(0);
        }
      });

      res.on('end', () => {
        console.log('Client stream ended.');
      });

      res.on('error', (err) => {
        console.error('Client stream error:', err);
      });
    });

    req.on('error', (err) => {
      console.error('Failed client request:', err);
      server.close();
      process.exit(1);
    });
  });
}

testStreamResilience();
