import http from 'http';
import https from 'https';
import { URL } from 'url';

// Increase maxSockets for high concurrency test runner
http.globalAgent.maxSockets = Infinity;
https.globalAgent.maxSockets = Infinity;

interface LoadTestConfig {
  targetUrl: string;
  mode: 'stream' | 'metadata' | 'news' | 'mixed';
  vus: number;
  durationSeconds: number;
  rampUpSeconds: number;
  pollIntervalMs: number;
}

function parseArgs(): LoadTestConfig {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string): string => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.split('=')[1] : fallback;
  };

  const targetUrl = process.env.TARGET_URL || getArg('target', 'http://localhost:3000');
  const modeVal = (process.env.MODE || getArg('mode', 'mixed')).toLowerCase();
  const mode: 'stream' | 'metadata' | 'news' | 'mixed' = ['stream', 'metadata', 'news', 'mixed'].includes(modeVal)
    ? (modeVal as any)
    : 'mixed';
  const vus = parseInt(process.env.VUS || getArg('vus', '100'), 10);
  const durationSeconds = parseInt(process.env.DURATION || getArg('duration', '30'), 10);
  const rampUpSeconds = parseInt(process.env.RAMP || getArg('ramp', '5'), 10);
  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL || getArg('poll', '3000'), 10);

  return { targetUrl, mode, vus, durationSeconds, rampUpSeconds, pollIntervalMs };
}

interface Metrics {
  activeStreamers: number;
  totalStreamsAttempted: number;
  successfulStreams: number;
  failedStreams: number;
  streamDrops: number;
  bytesReceived: number;
  chunksReceived: number;
  ttfbMsList: number[];
  statusCodes: Record<number, number>;
  errorReasons: Record<string, number>;
  metadataRequestsAttempted: number;
  metadataRequestsSuccess: number;
  metadataRequestsFailed: number;
  newsRequestsAttempted: number;
  newsRequestsSuccess: number;
  newsRequestsFailed: number;
  newsLatencyMsList: number[];
}

const metrics: Metrics = {
  activeStreamers: 0,
  totalStreamsAttempted: 0,
  successfulStreams: 0,
  failedStreams: 0,
  streamDrops: 0,
  bytesReceived: 0,
  chunksReceived: 0,
  ttfbMsList: [],
  statusCodes: {},
  errorReasons: {},
  metadataRequestsAttempted: 0,
  metadataRequestsSuccess: 0,
  metadataRequestsFailed: 0,
  newsRequestsAttempted: 0,
  newsRequestsSuccess: 0,
  newsRequestsFailed: 0,
  newsLatencyMsList: [],
};

let isRunning = true;

function recordStatus(statusCode: number) {
  metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;
}

function recordError(reason: string) {
  metrics.errorReasons[reason] = (metrics.errorReasons[reason] || 0) + 1;
}

/**
 * Simulates a single long-lived audio streaming Virtual User (VU)
 */
function launchStreamer(vuId: number, targetBaseUrl: string) {
  if (!isRunning) return;

  metrics.totalStreamsAttempted++;
  const startTime = Date.now();
  const streamEndpoint = `${targetBaseUrl.replace(/\/$/, '')}/api/v1/stream/listen`;

  const parsedUrl = new URL(streamEndpoint);
  const isHttps = parsedUrl.protocol === 'https:';
  const clientLib = isHttps ? https : http;

  const reqOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': `CapitalFMLoadTester/1.0 (VU-${vuId})`,
      'Accept': 'audio/mpeg, audio/aac, */*',
      'Connection': 'keep-alive',
    },
  };

  let ttfbRecorded = false;

  const req = clientLib.request(reqOptions, (res) => {
    recordStatus(res.statusCode || 0);

    if (res.statusCode === 200) {
      metrics.successfulStreams++;
      metrics.activeStreamers++;

      res.on('data', (chunk: Buffer) => {
        if (!ttfbRecorded) {
          ttfbRecorded = true;
          metrics.ttfbMsList.push(Date.now() - startTime);
        }
        metrics.bytesReceived += chunk.length;
        metrics.chunksReceived++;
      });

      res.on('end', () => {
        metrics.activeStreamers = Math.max(0, metrics.activeStreamers - 1);
        metrics.streamDrops++;
      });

      res.on('error', (err) => {
        metrics.activeStreamers = Math.max(0, metrics.activeStreamers - 1);
        recordError(err.message || 'Stream socket error');
      });
    } else {
      metrics.failedStreams++;
      recordError(`HTTP Status ${res.statusCode}`);
    }
  });

  req.on('error', (err) => {
    metrics.failedStreams++;
    recordError(err.message || 'Connection failed');
  });

  req.end();
}

/**
 * Simulates metadata polling (e.g. nowplaying and config endpoints)
 */
async function launchMetadataPoller(targetBaseUrl: string, intervalMs: number) {
  const endpoints = ['/api/v1/stream/nowplaying', '/api/v1/stream/config'];

  while (isRunning) {
    for (const endpoint of endpoints) {
      if (!isRunning) break;

      metrics.metadataRequestsAttempted++;
      const urlStr = `${targetBaseUrl.replace(/\/$/, '')}${endpoint}`;

      try {
        const parsedUrl = new URL(urlStr);
        const isHttps = parsedUrl.protocol === 'https:';
        const clientLib = isHttps ? https : http;

        await new Promise<void>((resolve) => {
          const req = clientLib.get(urlStr, (res) => {
            recordStatus(res.statusCode || 0);
            if (res.statusCode === 200) {
              metrics.metadataRequestsSuccess++;
            } else {
              metrics.metadataRequestsFailed++;
            }
            res.resume(); // consume response body
            res.on('end', resolve);
          });
          req.on('error', (err) => {
            metrics.metadataRequestsFailed++;
            recordError(`Metadata Poll Error: ${err.message}`);
            resolve();
          });
        });
      } catch (err: any) {
        metrics.metadataRequestsFailed++;
        recordError(`Metadata Exception: ${err.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Simulates Virtual Users continuously fetching News API endpoints
 */
async function launchNewsPoller(vuId: number, targetBaseUrl: string) {
  const endpoints = [
    '/api/v1/news',
    '/api/v1/news?category=news',
    '/api/v1/news?category=sports',
    '/api/v1/news?category=business',
    '/api/v1/news?page=2',
    '/api/v1/news/trending',
  ];

  let epIndex = vuId % endpoints.length;

  while (isRunning) {
    const endpoint = endpoints[epIndex];
    epIndex = (epIndex + 1) % endpoints.length;

    metrics.newsRequestsAttempted++;
    const startTime = Date.now();
    const urlStr = `${targetBaseUrl.replace(/\/$/, '')}${endpoint}`;

    try {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const clientLib = isHttps ? https : http;

      await new Promise<void>((resolve) => {
        const req = clientLib.get(urlStr, (res) => {
          recordStatus(res.statusCode || 0);
          if (res.statusCode === 200) {
            metrics.newsRequestsSuccess++;
            metrics.newsLatencyMsList.push(Date.now() - startTime);
          } else {
            metrics.newsRequestsFailed++;
          }
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', (err) => {
          metrics.newsRequestsFailed++;
          recordError(`News Poll Error: ${err.message}`);
          resolve();
        });
      });
    } catch (err: any) {
      metrics.newsRequestsFailed++;
      recordError(`News Exception: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 100));
  }
}

function calculatePercentiles(list: number[], percentiles: number[]): Record<string, number> {
  if (list.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...list].sort((a, b) => a - b);
  const result: Record<string, number> = {};
  for (const p of percentiles) {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    result[`p${p}`] = sorted[Math.max(0, idx)];
  }
  return result;
}

async function runLoadTest() {
  const config = parseArgs();

  console.log('\n===============================================================');
  console.log(' 🔥 CAPITAL FM BACKEND GATEWAY STREAMING & NEWS LOAD TEST');
  console.log('===============================================================');
  console.log(` Target Server URL    : ${config.targetUrl}`);
  console.log(` Test Mode            : ${config.mode.toUpperCase()}`);
  console.log(` Target Concurrency   : ${config.vus} Virtual Users`);
  console.log(` Ramp-Up Duration     : ${config.rampUpSeconds} seconds`);
  console.log(` Total Test Duration  : ${config.durationSeconds} seconds`);
  console.log('===============================================================\n');

  let lastBytes = 0;
  const startTime = Date.now();

  // Start periodic status logger
  const timer = setInterval(() => {
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const bytesDelta = metrics.bytesReceived - lastBytes;
    lastBytes = metrics.bytesReceived;
    const throughputKbps = ((bytesDelta / 1024) * 8).toFixed(1);
    const totalMb = (metrics.bytesReceived / (1024 * 1024)).toFixed(2);
    const ramMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    if (config.mode === 'news') {
      console.log(
        `[${elapsedSec}s] News Requests: ${metrics.newsRequestsAttempted} | ` +
        `Success: ${metrics.newsRequestsSuccess} | ` +
        `Failed: ${metrics.newsRequestsFailed} | ` +
        `RAM: ${ramMb} MB`
      );
    } else {
      console.log(
        `[${elapsedSec}s] Active Streamers: ${metrics.activeStreamers}/${config.vus} | ` +
        `Total Downloaded: ${totalMb} MB | ` +
        `Throughput: ${throughputKbps} kbps | ` +
        `Errors: ${metrics.failedStreams} | ` +
        `RAM: ${ramMb} MB`
      );
    }
  }, 1000);

  // Ramp up VUs
  const rampStepMs = (config.rampUpSeconds * 1000) / config.vus;

  if (config.mode === 'stream' || config.mode === 'mixed') {
    for (let i = 1; i <= config.vus; i++) {
      if (!isRunning) break;
      launchStreamer(i, config.targetUrl);
      if (rampStepMs > 0) {
        await new Promise((r) => setTimeout(r, rampStepMs));
      }
    }
  }

  if (config.mode === 'news') {
    for (let i = 1; i <= config.vus; i++) {
      if (!isRunning) break;
      launchNewsPoller(i, config.targetUrl);
      if (rampStepMs > 0) {
        await new Promise((r) => setTimeout(r, rampStepMs));
      }
    }
  }

  if (config.mode === 'metadata' || config.mode === 'mixed') {
    for (let i = 0; i < Math.min(20, Math.ceil(config.vus / 5)); i++) {
      launchMetadataPoller(config.targetUrl, config.pollIntervalMs);
    }
  }

  // Wait for total test duration
  const remainingTime = config.durationSeconds * 1000 - (Date.now() - startTime);
  if (remainingTime > 0) {
    await new Promise((r) => setTimeout(r, remainingTime));
  }

  // Stop test
  isRunning = false;
  clearInterval(timer);

  const totalDurationSec = (Date.now() - startTime) / 1000;
  const totalMb = (metrics.bytesReceived / (1024 * 1024)).toFixed(2);
  const avgBitratePerUserKbps =
    metrics.activeStreamers > 0
      ? (((metrics.bytesReceived * 8) / (totalDurationSec * metrics.activeStreamers * 1024))).toFixed(1)
      : '0.0';

  console.log('\n===============================================================');
  console.log(' 📊 LOAD TEST EXECUTION SUMMARY REPORT');
  console.log('===============================================================');
  console.log(` Total Test Duration          : ${totalDurationSec.toFixed(2)} seconds`);
  console.log(` Target Concurrency           : ${config.vus} VUs`);

  if (config.mode === 'news') {
    const newsLatencyPercentiles = calculatePercentiles(metrics.newsLatencyMsList, [50, 95, 99]);
    const rps = (metrics.newsRequestsSuccess / totalDurationSec).toFixed(1);

    console.log(` Total News Requests Attempted: ${metrics.newsRequestsAttempted}`);
    console.log(` Successful (HTTP 200)        : ${metrics.newsRequestsSuccess}`);
    console.log(` Failed Requests              : ${metrics.newsRequestsFailed}`);
    console.log(` Average Throughput (RPS)     : ${rps} req/sec`);
    console.log(' ---------------------------------------------------------------');
    console.log(' ⏱️ News Endpoint Latency (ms):');
    console.log(`    Median (P50)              : ${newsLatencyPercentiles.p50} ms`);
    console.log(`    95th Percentile (P95)     : ${newsLatencyPercentiles.p95} ms`);
    console.log(`    99th Percentile (P99)     : ${newsLatencyPercentiles.p99} ms`);
  } else {
    const ttfbPercentiles = calculatePercentiles(metrics.ttfbMsList, [50, 95, 99]);
    console.log(` Max Active Streamers Reached  : ${metrics.activeStreamers}`);
    console.log(` Stream Attempts              : ${metrics.totalStreamsAttempted}`);
    console.log(` Successful Streams           : ${metrics.successfulStreams}`);
    console.log(` Failed Stream Connections    : ${metrics.failedStreams}`);
    console.log(` Stream Disconnections/Drops  : ${metrics.streamDrops}`);
    console.log(` Total Audio Data Received   : ${totalMb} MB`);
    console.log(` Avg Bitrate Per Streamer    : ${avgBitratePerUserKbps} kbps`);
    console.log(' ---------------------------------------------------------------');
    console.log(' ⏱️ Time-To-First-Byte (TTFB Latency):');
    console.log(`    Median (P50)              : ${ttfbPercentiles.p50} ms`);
    console.log(`    95th Percentile (P95)     : ${ttfbPercentiles.p95} ms`);
    console.log(`    99th Percentile (P99)     : ${ttfbPercentiles.p99} ms`);
  }

  console.log(' ---------------------------------------------------------------');
  console.log(' 🏷️ HTTP Status Code Breakdown:');
  for (const [status, count] of Object.entries(metrics.statusCodes)) {
    console.log(`    HTTP ${status}                   : ${count}`);
  }
  if (Object.keys(metrics.errorReasons).length > 0) {
    console.log(' ---------------------------------------------------------------');
    console.log(' ⚠️ Error Breakdown:');
    for (const [err, count] of Object.entries(metrics.errorReasons)) {
      console.log(`    ${err} : ${count}`);
    }
  }
  console.log('===============================================================\n');

  if (config.mode === 'news') {
    const successRate = metrics.newsRequestsAttempted > 0
      ? (metrics.newsRequestsSuccess / metrics.newsRequestsAttempted) * 100
      : 100;
    if (successRate >= 98) {
      console.log(` ✅ VERDICT: EXCELLENT PASS! News APIs sustained ${config.vus} VUs with ${successRate.toFixed(1)}% success rate.\n`);
      process.exit(0);
    } else {
      console.log(` ❌ VERDICT: BOTTLENECK REACHED. News API success rate: ${successRate.toFixed(1)}%.\n`);
      process.exit(1);
    }
  } else {
    const successRate = metrics.totalStreamsAttempted > 0
      ? (metrics.successfulStreams / metrics.totalStreamsAttempted) * 100
      : 100;
    if (successRate >= 98 && metrics.activeStreamers >= config.vus * 0.9) {
      console.log(` ✅ VERDICT: EXCELLENT PASS! Service successfully sustained ${metrics.activeStreamers} concurrent streamers (${successRate.toFixed(1)}% success rate).\n`);
      process.exit(0);
    } else {
      console.log(` ❌ VERDICT: DEGRADED / BOTTLENECK REACHED.\n`);
      process.exit(1);
    }
  }
}

runLoadTest().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
