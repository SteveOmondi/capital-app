import https from 'https';
import http from 'http';
import { URL } from 'url';

interface EndpointBenchmarkResult {
  endpoint: string;
  name: string;
  statusCode: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  coldStartMs: number;
  warmMs: number;
  samples: number[];
  success: boolean;
  contentLengthBytes: number;
}

const TARGET_HOST = process.env.TARGET_URL || 'https://api.datalait.co.ke';
const SAMPLE_COUNT = 5; // Number of warm requests per endpoint to calculate averages

const ENDPOINTS_TO_TEST = [
  { name: 'Stream Config', path: '/api/v1/stream/config' },
  { name: 'Stream Now Playing', path: '/api/v1/stream/nowplaying' },
  { name: 'News Categories', path: '/api/v1/news/categories' },
  { name: 'News Feed (Articles)', path: '/api/v1/news?page=1&limit=10' },
  { name: 'Trending Articles', path: '/api/v1/news/trending' },
  { name: 'Podcasts Feed', path: '/api/v1/podcasts?page=1&limit=10' },
  { name: 'Radio Schedules', path: '/api/v1/schedules?day=today' },
  { name: 'On-Air Presenters', path: '/api/v1/presenters' },
  { name: 'Events List', path: '/api/v1/events' },
  { name: 'Health Check', path: '/health' },
];

function measureRequest(urlStr: string): Promise<{ durationMs: number; statusCode: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const clientLib = isHttps ? https : http;

    const req = clientLib.get(urlStr, { headers: { 'User-Agent': 'CapitalFMApiBenchmarker/1.0' } }, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
      });
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        resolve({ durationMs, statusCode: res.statusCode || 0, bytes });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function calculatePercentile(sortedList: number[], percentile: number): number {
  if (sortedList.length === 0) return 0;
  const idx = Math.ceil((percentile / 100) * sortedList.length) - 1;
  return sortedList[Math.max(0, idx)];
}

async function runProductionBenchmark() {
  console.log('\n===============================================================');
  console.log(' ⚡ CAPITAL FM PRODUCTION API RESPONSE TIME BENCHMARK');
  console.log('===============================================================');
  console.log(` Target Host          : ${TARGET_HOST}`);
  console.log(` Samples Per Endpoint : ${SAMPLE_COUNT} requests`);
  console.log(` Timestamp            : ${new Date().toISOString()}`);
  console.log('===============================================================\n');

  const results: EndpointBenchmarkResult[] = [];

  for (const ep of ENDPOINTS_TO_TEST) {
    const fullUrl = `${TARGET_HOST.replace(/\/$/, '')}${ep.path}`;
    process.stdout.write(`Benchmarking ${ep.name.padEnd(25)} [${ep.path}] ... `);

    const samples: number[] = [];
    let statusCode = 0;
    let bytes = 0;
    let success = true;
    let coldStartMs = 0;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      try {
        const res = await measureRequest(fullUrl);
        if (i === 0) coldStartMs = res.durationMs;
        samples.push(res.durationMs);
        statusCode = res.statusCode;
        bytes = res.bytes;
      } catch (err: any) {
        success = false;
        process.stdout.write(` [ERR: ${err.message}]`);
      }
      // Small 100ms pause between requests
      await new Promise((r) => setTimeout(r, 100));
    }

    if (samples.length > 0) {
      const sorted = [...samples].sort((a, b) => a - b);
      const minMs = sorted[0];
      const maxMs = sorted[sorted.length - 1];
      const avgMs = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
      const p95Ms = calculatePercentile(sorted, 95);
      const warmMs = samples.length > 1 ? Math.round(samples.slice(1).reduce((a, b) => a + b, 0) / (samples.length - 1)) : minMs;

      results.push({
        endpoint: ep.path,
        name: ep.name,
        statusCode,
        minMs,
        maxMs,
        avgMs,
        p95Ms,
        coldStartMs,
        warmMs,
        samples,
        success,
        contentLengthBytes: bytes,
      });

      console.log(`HTTP ${statusCode} | Cold: ${coldStartMs}ms | Avg: ${avgMs}ms | Warm: ${warmMs}ms`);
    } else {
      console.log(`FAILED to connect to ${fullUrl}`);
    }
  }

  console.log('\n===================================================================================================');
  console.log(' 📊 PRODUCTION API BENCHMARK SUMMARY REPORT');
  console.log('===================================================================================================');
  console.log(
    ' API Endpoint'.padEnd(26) +
    ' Path'.padEnd(32) +
    ' Status'.padEnd(10) +
    ' Cold (1st)'.padEnd(12) +
    ' Warm (Avg)'.padEnd(12) +
    ' P95 Latency'.padEnd(12)
  );
  console.log('---------------------------------------------------------------------------------------------------');

  for (const r of results) {
    const statusStr = r.statusCode === 200 ? `✅ ${r.statusCode}` : `❌ ${r.statusCode}`;
    console.log(
      ` ${r.name.padEnd(25)}` +
      ` ${r.endpoint.padEnd(31)}` +
      ` ${statusStr.padEnd(11)}` +
      ` ${String(r.coldStartMs + ' ms').padEnd(11)}` +
      ` ${String(r.warmMs + ' ms').padEnd(11)}` +
      ` ${String(r.p95Ms + ' ms').padEnd(11)}`
    );
  }

  console.log('===================================================================================================\n');

  // Print JSON outcome for structured output
  console.log('--- JSON OUTCOME BENCHMARK SUMMARY ---');
  console.log(JSON.stringify(results, null, 2));
}

runProductionBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
