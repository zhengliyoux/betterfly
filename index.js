const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const os = require('os');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.enable("trust proxy");
app.set("json spaces", 2);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

app.use('/', express.static(path.join(__dirname, 'ui')));
app.use('/api', express.static(path.join(__dirname, 'api')));

/* ===============================
   GLOBAL FUNCTION
================================= */

global.getBuffer = async (url, options = {}) => {
  try {
    const res = await axios({
      method: 'get',
      url,
      headers: {
        'DNT': 1,
        'Upgrade-Insecure-Request': 1
      },
      ...options,
      responseType: 'arraybuffer'
    });
    return res.data;
  } catch (err) {
    return err;
  }
};

global.fetchJson = async (url, options = {}) => {
  try {
    const res = await axios({
      method: 'GET',
      url,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      ...options
    });
    return res.data;
  } catch (err) {
    return err;
  }
};

global.apikey = process.env.APIKEY || null;
global.totalreq = 0;

/* ===============================
   SETTINGS
================================= */

const settings = {
  creatorName: "Ganz SyahPutra",
  whatsappLink: "https://whatsapp.com/channel/0029Vb7oYaM11ulHhSLjhg35",
  apiTitle: "Phoenix Vision Api's",
  githubLink: "https://github.com/zhengliyoux/betterfly",
  instagramLink: "https://www.instagram.com/yoalahhasu?igsh=MTVobGsydHVkbTdidg=="
};

/* ===============================
   LIVE SECURITY SYSTEM
================================= */

const serverStart = Date.now();

const requestLogs = [];
const endpointHistory = [];
const liveLogs = [];

const ipRequests = {};
const blockedIPs = {};
const suspiciousIPs = {};

const RATE_LIMIT = 300;
const BLOCK_DURATION = 60 * 60 * 1000; // 1 JAM

const BAD_AGENTS = [
  'python-requests', 'curl', 'wget', 'scrapy',
  'nikto', 'sqlmap', 'nmap', 'masscan',
  'zgrab', 'go-http-client', 'libwww'
];

// ✅ Path internal yang DIKECUALIKAN dari rate limit & bad agent check
const INTERNAL_PATHS = [
  '/runtime',
  '/security-stats',
  '/live-logs',
  '/set',
  '/endpoints'
];

function formatRuntime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function addLiveLog(type, message) {
  liveLogs.unshift({
    type,
    time: new Date().toLocaleTimeString('id-ID'),
    message
  });
  if (liveLogs.length > 100) liveLogs.pop();
}

/* ===============================
   LOGGER + DDOS PROTECT
================================= */

app.use((req, res, next) => {

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown';

  const ua = req.headers['user-agent'] || '';
  const now = Date.now();

  // ✅ Skip semua pemeriksaan untuk internal paths (dashboard sendiri)
  if (INTERNAL_PATHS.includes(req.path)) {
    // Tetap log request tapi skip rate limit & bad agent
    const logData = {
      ip,
      method: req.method,
      path: req.path,
      time: new Date().toLocaleString('id-ID')
    };
    requestLogs.unshift(logData);
    if (requestLogs.length > 100) requestLogs.pop();
    return next();
  }

  // ✅ BLOCK 1: Bad User Agent (bot/scraper)
  const isBadAgent = BAD_AGENTS.some(b => ua.toLowerCase().includes(b));
  if (isBadAgent) {
    addLiveLog('blocked', `🚫 IP Blocked [Bad Agent]: ${ip} — UA: ${ua.slice(0, 40)}`);
    console.log(chalk.bgRed.white(` BAD AGENT `), chalk.red(ip), chalk.yellow(ua.slice(0, 40)));
    return res.status(403).json({
      status: false,
      code: 403,
      message: 'Forbidden.'
    });
  }

  // ✅ BLOCK 2: Cek IP yang sudah diblokir
  if (blockedIPs[ip]) {
    if (now < blockedIPs[ip]) {
      const sisaMenit = Math.ceil((blockedIPs[ip] - now) / 60000);
      addLiveLog('blocked', `🔒 IP Blocked [Still Blocked]: ${ip} — sisa ${sisaMenit} menit`);
      return res.status(429).json({
        status: false,
        code: 429,
        message: `IP kamu diblokir. Coba lagi dalam ${sisaMenit} menit.`
      });
    } else {
      // Unblock otomatis
      addLiveLog('success', `✅ IP Unblocked: ${ip}`);
      delete blockedIPs[ip];
      delete suspiciousIPs[ip];
    }
  }

  // ✅ BLOCK 3: Rate Limit
  if (!ipRequests[ip]) ipRequests[ip] = [];
  ipRequests[ip] = ipRequests[ip].filter(t => now - t < 60000);
  ipRequests[ip].push(now);

  const reqCount = ipRequests[ip].length;

  // Warning di 70% limit
  if (reqCount > RATE_LIMIT * 0.7 && reqCount <= RATE_LIMIT) {
    if (!suspiciousIPs[ip]) {
      suspiciousIPs[ip] = true;
      addLiveLog('warn', `⚠️ IP Suspicious: ${ip} — ${reqCount}/${RATE_LIMIT} req/menit`);
    }
  }

  if (reqCount > RATE_LIMIT) {
    blockedIPs[ip] = now + BLOCK_DURATION;
    addLiveLog('blocked', `🚫 IP Blocked [Rate Limit]: ${ip} — ${reqCount} req/menit — blocked 1 jam`);
    console.log(
      chalk.bgRed.white(` BLOCKED `),
      chalk.red(ip),
      chalk.yellow(`${reqCount} req/menit — spam detected`)
    );
    return res.status(429).json({
      status: false,
      code: 429,
      message: 'Terlalu banyak request. IP kamu diblokir 1 jam.'
    });
  }

  // ✅ Log normal request
  global.totalreq += 1;

  const logData = {
    ip,
    method: req.method,
    path: req.path,
    time: new Date().toLocaleString('id-ID')
  };

  requestLogs.unshift(logData);
  if (requestLogs.length > 100) requestLogs.pop();

  endpointHistory.unshift(logData);
  if (endpointHistory.length > 200) endpointHistory.pop();

  // Hanya log path API (bukan static file) ke live console
  if (!req.path.match(/\.(js|css|png|jpg|ico|html|map)$/)) {
    addLiveLog('request', `📡 ${req.method} ${req.path} — ${ip}`);
  }

  console.log(
    chalk.hex('#00cec9')(`[ ${logData.time} ]`),
    chalk.green(req.method),
    chalk.yellow(req.path),
    chalk.white(ip)
  );

  // ✅ Auto inject creator ke semua response JSON (dengan guard aman)
  const originalJson = res.json;
  res.json = function (data) {
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      req.path !== '/endpoints' &&
      req.path !== '/set'
    ) {
      return originalJson.call(this, {
        creator: settings.creatorName || 'Created Using SkyWings',
        ...data
      });
    }
    return originalJson.call(this, data);
  };

  next();
});

/* ===============================
   SETTINGS API
================================= */

app.get('/set', (req, res) => {
  res.json(settings);
});

/* ===============================
   RUNTIME API — Fix: include memory & CPU
================================= */

app.get('/runtime', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - serverStart) / 1000);

  // Memory dari Node.js process
  const mem = process.memoryUsage();

  // CPU info dari OS
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const cpuPct = Math.min(100, Math.round((loadAvg[0] / (cpus.length || 1)) * 100));

  res.json({
    status: true,
    uptime_seconds: uptimeSeconds,
    uptime_formatted: formatRuntime(uptimeSeconds),
    started_at: new Date(serverStart).toISOString(),
    total_request: global.totalreq,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external
    },
    cpu: cpuPct,
    cpu_cores: cpus.length,
    cpu_model: cpus[0]?.model || 'Unknown CPU',
    loadAvg: loadAvg
  });
});

/* ===============================
   SECURITY API
================================= */

app.get('/security-stats', (req, res) => {
  const now = Date.now();

  const blocked = Object.entries(blockedIPs)
    .map(([ip, expire]) => ({
      ip,
      sisaDetik: Math.max(0, Math.floor((expire - now) / 1000)),
      sisaMenit: Math.ceil(Math.max(0, (expire - now)) / 60000)
    }))
    .filter(v => v.sisaDetik > 0);

  const suspicious = Object.keys(suspiciousIPs).filter(ip => !blockedIPs[ip]);

  res.json({
    status: true,
    totalBlockedNow: blocked.length,
    totalSuspicious: suspicious.length,
    blockedIPs: blocked,
    suspiciousIPs: suspicious,
    rateLimit: RATE_LIMIT,
    blockDuration: '1 jam',
    logs: requestLogs.slice(0, 20)
  });
});

/* ===============================
   LIVE CONSOLE API
================================= */

app.get('/live-logs', (req, res) => {
  res.json({
    status: true,
    total_request: global.totalreq,
    logs: requestLogs,
    live: liveLogs.slice(0, 50),
    history: endpointHistory
  });
});

/* ===============================
   ENDPOINT LOADER
================================= */

let totalRoutes = 0;
let rawEndpoints = {};

const apiFolder = path.join(__dirname, 'api');

fs.readdirSync(apiFolder).forEach(file => {
  const fullPath = path.join(apiFolder, file);

  if (file.endsWith('.js')) {
    try {
      const routes = require(fullPath);
      const handlers = Array.isArray(routes) ? routes : [routes];

      handlers.forEach(route => {
        const { name, desc, category, path: routePath, run } = route;

        if (name && desc && category && routePath && typeof run === 'function') {
          const cleanPath = routePath.split('?')[0];
          app.get(cleanPath, run);

          if (!rawEndpoints[category]) rawEndpoints[category] = [];
          rawEndpoints[category].push({ name, desc, path: routePath });
          totalRoutes++;

          console.log(
            chalk.hex('#55efc4')(`✔ Loaded: `) +
            chalk.hex('#ffeaa7')(`${cleanPath} (${file})`)
          );
        } else {
          console.warn(chalk.bgRed.white(` ⚠ Skipped invalid route in ${file}`));
        }
      });

    } catch (err) {
      console.error(chalk.bgRed.white(` ❌ Error in ${file}: ${err.message}`));
    }
  }
});

/* ===============================
   SORT ENDPOINTS
================================= */

const endpoints = Object.keys(rawEndpoints)
  .sort((a, b) => a.localeCompare(b))
  .reduce((sorted, category) => {
    sorted[category] = rawEndpoints[category].sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, {});

/* ===============================
   ENDPOINTS API
================================= */

app.get('/endpoints', (req, res) => {
  res.json(endpoints);
});

/* ===============================
   HOME
================================= */

app.get('/', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'index.html'));
  } catch (err) {
    console.log(err);
  }
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log(chalk.bgGreen.black(` 🚀 Server running on port ${PORT} `));
  console.log(chalk.bgCyan.black(` 📦 Total Routes Loaded: ${totalRoutes} `));
  console.log(chalk.bgYellow.black(` 🛡️ Rate Limit: ${RATE_LIMIT} req/menit | Block: 1 jam `));

  addLiveLog('success', `🚀 Server started on port ${PORT}`);
  addLiveLog('success', `📦 ${totalRoutes} routes loaded`);
  addLiveLog('success', `🛡️ Anti-DDoS aktif — limit ${RATE_LIMIT} req/menit`);
});

/* ===============================
   EXPORT
================================= */

module.exports = app;
