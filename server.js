import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.DASHBOARD_PORT || 4010;
const API_TARGET = process.env.UNIFIED_API_TARGET || 'http://localhost:3001';
const BP_API_KEY = process.env.BLACKPOINT_API_KEY || '';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const requestTimestamps = new Map();

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of requestTimestamps) {
    const active = timestamps.filter((timestamp) => timestamp > cutoff);
    if (active.length) {
      requestTimestamps.set(ip, active);
    } else {
      requestTimestamps.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

app.use((req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const timestamps = (requestTimestamps.get(ip) || []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  timestamps.push(now);
  requestTimestamps.set(ip, timestamps);
  next();
});

let tenants = [];
try {
  const tenantsPath = path.join(__dirname, 'config', 'tenants.json');
  if (fs.existsSync(tenantsPath)) {
    const tenantsData = JSON.parse(fs.readFileSync(tenantsPath, 'utf8'));
    tenants = tenantsData.map((tenant) => ({
      alias: tenant.alias,
      displayName: tenant.displayName,
      enabled: tenant.enabled,
      hasBlackpoint: Boolean(tenant.blackpoint),
      hasMicrosoft: Boolean(tenant.microsoft),
    }));
  }
} catch (error) {
  console.warn('Failed to load tenants configuration:', error.message);
}

app.use('/api', createProxyMiddleware({
  target: API_TARGET,
  changeOrigin: true,
  pathRewrite: (requestPath) => `/api${requestPath}`,
}));

app.get('/api/tenants-list', (req, res) => {
  res.json(tenants);
});

const v1ProxyOptions = {
  target: process.env.BLACKPOINT_API_URL || 'https://api.blackpointcyber.com/v1',
  changeOrigin: true,
};

if (BP_API_KEY) {
  v1ProxyOptions.headers = { Authorization: `Bearer ${BP_API_KEY}` };
}

app.use('/v1', createProxyMiddleware(v1ProxyOptions));

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
  console.log(`Proxying unified API requests to ${API_TARGET}`);
  if (!BP_API_KEY) {
    console.warn('WARNING: BLACKPOINT_API_KEY not set - legacy /v1 API calls will fail');
  }
});