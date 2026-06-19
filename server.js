import 'dotenv/config.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 4010;
const BP_API_KEY = process.env.BLACKPOINT_API_KEY || '';

console.log('Loaded BP_API_KEY:', BP_API_KEY ? '✓ PRESENT' : '✗ MISSING');

// Load tenants configuration
let tenants = [];
try {
  const tenantsPath = path.join(__dirname, 'config', 'tenants.json');
  if (fs.existsSync(tenantsPath)) {
    const tenantsData = JSON.parse(fs.readFileSync(tenantsPath, 'utf8'));
    tenants = tenantsData.map(t => ({
      alias: t.alias,
      displayName: t.displayName,
      enabled: t.enabled,
      hasBlackpoint: !!t.blackpoint,
      hasMicrosoft: !!t.microsoft,
    }));
  }
} catch (err) {
  console.warn('Failed to load tenants configuration:', err.message);
}

// Proxy /v1 requests to the Blackpoint CompassOne API
// Add authentication header before proxying
if (BP_API_KEY) {
  app.use('/v1', (req, res, next) => {
    // Add the API key to the request before proxying
    req.headers['authorization'] = 'Bearer ' + BP_API_KEY;
    console.log('[Auth] Added Bearer token to /v1 request:', req.path);
    next();
  });
}

app.use('/v1', createProxyMiddleware({
  target: 'https://api.blackpointcyber.com/v1',
  changeOrigin: true,
  logLevel: 'debug'
}));

// Optional backend proxies
if (process.env.DEFENDER_XDR_PROXY_TARGET) {
  app.use('/api/defender-xdr', createProxyMiddleware({
    target: process.env.DEFENDER_XDR_PROXY_TARGET,
    changeOrigin: true,
  }));
}
if (process.env.O365_PROXY_TARGET) {
  app.use('/api/o365', createProxyMiddleware({
    target: process.env.O365_PROXY_TARGET,
    changeOrigin: true,
  }));
}
if (process.env.SENTINEL_PROXY_TARGET) {
  app.use('/api/sentinel', createProxyMiddleware({
    target: process.env.SENTINEL_PROXY_TARGET,
    changeOrigin: true,
  }));
}
if (process.env.DEFENDER_MCP_PROXY_TARGET) {
  app.use('/api/defender-mcp', createProxyMiddleware({
    target: process.env.DEFENDER_MCP_PROXY_TARGET,
    changeOrigin: true,
  }));
}

// API Routes — proxy /api/tenants/* to the full TypeScript backend on port 3001
// Use pathFilter (not app.use path) so the full path is preserved when forwarding
app.use(createProxyMiddleware({
  pathFilter: '/api/tenants',
  target: 'http://localhost:3001',
  changeOrigin: true,
}));

// Top-level tenants list (served locally for tenant selector)
app.get('/api/tenants-list', (req, res) => {
  res.json(tenants);
});

// Serve static files from the React build directory
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Dashboard running on port ' + PORT);
  if (!BP_API_KEY) {
    console.warn('WARNING: BLACKPOINT_API_KEY not set - API calls will fail');
  }
});