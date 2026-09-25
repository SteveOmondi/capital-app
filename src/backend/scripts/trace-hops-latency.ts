import https from 'https';
import http from 'http';
import { URL } from 'url';

interface HopMeasurement {
  hopName: string;
  targetUrl: string;
  dnsTimeMs: number;
  connectTimeMs: number;
  tlsHandshakeMs: number;
  ttfbMs: number;
  totalTimeMs: number;
  statusCode: number;
}

function measureHopLatency(urlStr: string): Promise<HopMeasurement> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const clientLib = isHttps ? https : http;

    let dnsStart = 0;
    let dnsEnd = 0;
    let connectEnd = 0;
    let tlsEnd = 0;
    let ttfbEnd = 0;

    const startTime = Date.now();

    const req = clientLib.get(urlStr, { headers: { 'User-Agent': 'CapitalFMHopTracer/1.0' } }, (res) => {
      ttfbEnd = Date.now();
      let bytes = 0;

      res.on('data', (chunk) => {
        bytes += chunk.length;
      });

      res.on('end', () => {
        const totalTimeMs = Date.now() - startTime;
        const dnsTimeMs = dnsEnd ? dnsEnd - dnsStart : 0;
        const connectTimeMs = connectEnd ? connectEnd - (dnsEnd || startTime) : 0;
        const tlsHandshakeMs = isHttps && tlsEnd ? tlsEnd - connectEnd : 0;
        const ttfbMs = ttfbEnd - startTime;

        resolve({
          hopName: parsedUrl.hostname,
          targetUrl: urlStr,
          dnsTimeMs,
          connectTimeMs,
          tlsHandshakeMs,
          ttfbMs,
          totalTimeMs,
          statusCode: res.statusCode || 0,
        });
      });
    });

    req.on('socket', (socket: any) => {
      dnsStart = Date.now();

      socket.on('lookup', () => {
        dnsEnd = Date.now();
      });

      socket.on('connect', () => {
        connectEnd = Date.now();
      });

      socket.on('secureConnect', () => {
        tlsEnd = Date.now();
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

async function runHopTracing() {
  console.log('\n===============================================================');
  console.log(' 🔬 CAPITAL FM HOP-BY-HOP LATENCY & BOTTLENECK ANALYSIS');
  console.log('===============================================================');

  const hopsToTest = [
    { name: 'Hop 1: Gateway Ingress (api.datalait.co.ke)', url: 'https://api.datalait.co.ke/health' },
    { name: 'Hop 2: Upstream WordPress CMS API (capitalfm.africa)', url: 'https://capitalfm.africa/wp-json/capitalfm/v1/articles?per_page=5' },
    { name: 'Hop 3: StreamGuys Recast OAuth API', url: 'https://atunwadigital-recast.streamguys1.com/login' },
    { name: 'Hop 4: iTunes Artwork Enrichment API', url: 'https://itunes.apple.com/search?term=Capital+FM&limit=1' },
  ];

  for (const h of hopsToTest) {
    try {
      const res = await measureHopLatency(h.url);
      console.log(`\n📍 ${h.name}`);
      console.log(`   URL              : ${h.url}`);
      console.log(`   HTTP Status      : ${res.statusCode}`);
      console.log(`   DNS Resolution   : ${res.dnsTimeMs} ms`);
      console.log(`   TCP Connect      : ${res.connectTimeMs} ms`);
      if (res.tlsHandshakeMs > 0) {
        console.log(`   TLS Handshake    : ${res.tlsHandshakeMs} ms`);
      }
      console.log(`   Time-To-First-Byte (TTFB): ${res.ttfbMs} ms`);
      console.log(`   Total Request Time       : ${res.totalTimeMs} ms`);
    } catch (err: any) {
      console.log(`\n📍 ${h.name} - Failed: ${err.message}`);
    }
  }

  console.log('\n===============================================================\n');
}

runHopTracing().catch(console.error);
