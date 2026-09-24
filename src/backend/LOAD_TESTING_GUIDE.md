# 🚀 Capital FM Audio Streaming & Gateway Load Testing Guide

This guide provides step-by-step instructions, benchmarking scripts, and capacity planning formulas to determine **how many concurrent live audio streamers and mobile app users** the Capital FM Backend Gateway can handle simultaneously.

---

## 📐 1. Capacity & Bandwidth Math

Live audio streaming bandwidth and server memory requirements scale predictably based on stream bitrate (128 kbps AAC/MP3):

| Concurrent Streamers | Audio Bitrate | Gateway Outbound Bandwidth | Estimated RAM Usage |
| :--- | :--- | :--- | :--- |
| **50 Streamers** | 128 kbps | 6.4 Mbps (~0.8 MB/s) | ~40 MB |
| **200 Streamers** | 128 kbps | 25.6 Mbps (~3.2 MB/s) | ~60 MB |
| **500 Streamers** | 128 kbps | 64 Mbps (~8.0 MB/s) | ~120 MB |
| **1,000 Streamers** | 128 kbps | 128 Mbps (~16.0 MB/s) | ~220 MB |
| **5,000 Streamers** | 128 kbps | 640 Mbps (~80.0 MB/s) | ~850 MB |
| **10,000 Streamers** | 128 kbps | 1.28 Gbps (~160.0 MB/s) | ~1.6 GB |

> [!IMPORTANT]
> **Direct HLS vs. BFF Stream Proxy:**
> - Mobile apps fetching `/api/v1/stream/config` receive the **`primaryHlsUrl`**, which streams directly from **StreamGuys CDN edge servers**. This architecture offloads traffic from the BFF gateway and supports **100,000+ concurrent listeners**.
> - The **BFF Proxy endpoint** (`/api/v1/stream/listen`) handles fallback mobile browser HTML5 players. The load tests below benchmark this proxy endpoint as well as metadata API polling.

---

## 🛠️ 2. Running Load Tests Locally

We provide **two load testing methods**:
1. **Native TypeScript Load Runner** (No external software installation required; uses standard Node.js).
2. **Grafana k6 Script** (Industry-standard DevOps tool).

---

### Option A: Native TypeScript Load Test (Recommended)

Run from `capital-app/src/backend`:

```bash
cd capital-app/src/backend
```

#### Test Modes & Execution Commands

##### 1. Stream Proxy Load Test (Tests `/api/v1/stream/listen`)
Simulates concurrent long-lived live radio listeners holding audio streams open:
```bash
npm run loadtest:stream
```
*Customizing parameters:*
```bash
npx ts-node scripts/loadtest.ts --target=http://localhost:3000 --mode=stream --vus=250 --duration=60 --ramp=10
```

##### 2. Mixed Mobile App Profile (Streaming + Periodic Metadata Polling)
Simulates real mobile app users listening to radio while polling track info & show schedules:
```bash
npm run loadtest:mixed
```
*Customizing parameters:*
```bash
npx ts-node scripts/loadtest.ts --target=https://api.datalait.co.ke --mode=mixed --vus=500 --duration=60
```

##### 3. CLI Options Matrix
| Flag | Environment Var | Description | Default |
| :--- | :--- | :--- | :--- |
| `--target` | `TARGET_URL` | Target Gateway URL | `http://localhost:3000` |
| `--mode` | `MODE` | Test mode (`stream`, `metadata`, `mixed`) | `mixed` |
| `--vus` | `VUS` | Target concurrent Virtual Users (streamers) | `100` |
| `--duration`| `DURATION` | Total duration of test in seconds | `30` |
| `--ramp` | `RAMP` | Seconds to ramp up from 1 VU to max VUs | `5` |
| `--poll` | `POLL_INTERVAL`| Metadata polling interval in ms | `3000` |

---

### Option B: Grafana k6 Load Test

If Grafana `k6` is installed on your machine or CI/CD runner:

```bash
cd capital-app/src/backend
k6 run scripts/k6-loadtest.js -e TARGET_URL=http://localhost:3000
```

---

## ☁️ 3. Azure DevOps Integration

We have integrated load testing into Azure DevOps in two ways:

### 1. Automated Post-Deployment Stage (`azure-pipelines.yml`)
Every push to production automatically triggers Stage 4 (**Post-Deploy Streaming Load Test**), running 200 concurrent streamer Virtual Users against `https://api.datalait.co.ke` to verify performance immediately after deployment.

### 2. Dedicated On-Demand Pipeline (`azure-pipelines-loadtest.yml`)
To run manual or scheduled load tests in Azure DevOps:
1. Go to **Azure DevOps** -> **Pipelines** -> **New Pipeline**.
2. Select your repository and point to `azure-pipelines-loadtest.yml`.
3. Set variables (`TARGET_URL`, `VUS`, `DURATION`, `MODE`) and click **Run Pipeline**.

### 3. Azure Managed Load Testing (`AzureLoadTest@1`)
If using Azure Managed Load Testing resource in Azure Portal:
Add the following task to your pipeline:
```yaml
- task: AzureLoadTest@1
  inputs:
    azureSubscription: 'Azure-ServiceConnection'
    loadTestConfigFile: 'src/backend/scripts/k6-loadtest.js'
    loadTestResource: 'capital-app-loadtest-resource'
    resourceGroup: 'capital-fm-rg'
```

---

## 📊 4. Understanding Load Test Results

When running `npm run loadtest`, the script outputs real-time stats followed by a summary report:

```text
===============================================================
 📊 LOAD TEST EXECUTION SUMMARY REPORT
===============================================================
 Total Test Duration          : 60.00 seconds
 Target Concurrency           : 500 VUs
 Max Active Streamers Reached  : 500
 Stream Attempts              : 500
 Successful Streams           : 498
 Failed Stream Connections    : 2
 Stream Disconnections/Drops  : 0
 Total Audio Data Received   : 472.50 MB
 Avg Bitrate Per Streamer    : 128.4 kbps
 ---------------------------------------------------------------
 ⏱️ Time-To-First-Byte (TTFB Latency):
    Median (P50)              : 42 ms
    95th Percentile (P95)     : 115 ms
    99th Percentile (P99)     : 310 ms
 ---------------------------------------------------------------
 🏷️ HTTP Status Code Breakdown:
    HTTP 200                  : 498
    HTTP 429                  : 2
===============================================================
 ✅ VERDICT: EXCELLENT PASS! Service successfully sustained 500 concurrent streamers (99.6% success rate).
```

---

## ⚙️ 5. System Tuning & OS Prerequisites for High Concurrency (1,000+ Streamers)

To support **1,000 to 10,000+ concurrent streaming sockets** on a Linux server or Azure Container App:

1. **Increase OS File Descriptors (`ulimit -n 65535`)**: Linux defaults to 1,024 open file descriptors per process.
2. **Rate Limiting**: Set `DISABLE_RATE_LIMIT=true` on your staging server during load test runs.
3. **PM2 / Cluster Scaling**: Run with `pm2 start dist/server.js -i max` to scale across all server CPU cores.
