import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge, Trend } from 'k6/metrics';

// Custom metrics for k6 dashboard
const activeStreamers = new Gauge('active_streamers');
const streamBytesReceived = new Counter('stream_bytes_received');
const ttfbTrend = new Trend('stream_ttfb_ms');
const streamErrorCounter = new Counter('stream_errors');

export const options = {
  scenarios: {
    // Stage 1: Ramp up streaming VUs
    audio_streamers: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 50 },  // Ramp to 50 users
        { duration: '20s', target: 200 }, // Ramp to 200 users
        { duration: '30s', target: 500 }, // Ramp to 500 users
        { duration: '10s', target: 0 },   // Graceful ramp down
      ],
      gracefulStop: '5s',
    },
    // Stage 2: Periodic metadata API polling (simulates Flutter app UI refreshes)
    metadata_pollers: {
      executor: 'constant-vus',
      vus: 20,
      duration: '70s',
      exec: 'pollMetadata',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'], // Error rate less than 2%
    http_req_duration: ['p(95)<1000'], // 95% of requests respond < 1000ms
    stream_ttfb_ms: ['p(95)<1500'],
  },
};

export default function () {
  const targetHost = __ENV.TARGET_URL || 'http://localhost:3000';
  const url = `${targetHost}/api/v1/stream/listen`;

  const params = {
    headers: {
      'User-Agent': 'k6-StreamGuys-LoadTest/1.0',
      'Accept': 'audio/mpeg, audio/aac, */*',
    },
    timeout: '10s',
    responseType: 'none', // Do not buffer full binary audio stream in memory
  };

  const startTime = Date.now();
  activeStreamers.add(1);

  const res = http.get(url, params);

  const ttfb = Date.now() - startTime;
  ttfbTrend.add(ttfb);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'content type is audio': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('audio'),
  });

  if (!success) {
    streamErrorCounter.add(1);
  }

  activeStreamers.add(-1);
  sleep(1);
}

export function pollMetadata() {
  const targetHost = __ENV.TARGET_URL || 'http://localhost:3000';

  const res1 = http.get(`${targetHost}/api/v1/stream/nowplaying`);
  check(res1, { 'nowplaying 200': (r) => r.status === 200 });

  const res2 = http.get(`${targetHost}/api/v1/stream/config`);
  check(res2, { 'config 200': (r) => r.status === 200 });

  sleep(3);
}
