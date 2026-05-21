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
      headers: { 'DNT': 1, 'Upgrade-Insecure-Request': 1 },
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
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
   TELEGRAM BOT NOTIFIER
   Isi BOT_TOKEN dan CHAT_ID di file .env:
   TG_TOKEN=xxxxxx:xxxxxxxxxxxxxxx
   TG_CHAT_ID=123456789
================================= */

const TG_TOKEN = process.env.TG_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

// Cooldown per event agar tidak spam notif Telegram
const tgCooldown = {};

async function sendTelegram(message, cooldownKey = null, cooldownMs = 60000) {
  if (!TG_TOKEN || !TG_CHAT_ID) return; // Skip kalau belum dikonfigurasi

  // Cek cooldown — hindari spam notif yang sama
  if (cooldownKey) {
    const last = tgCooldown[cooldownKey] || 0;
    if (Date.now() - last < cooldownMs) return;
    tgCooldown[cooldownKey] = Date.now();
  }

  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    // Gagal kirim Telegram, diam saja agar tidak ganggu server
  }
}

/* ===============================
   SECURITY SYSTEM
================================= */

const serverStart = Date.now();

const requestLogs = [];
const endpointHistory = [];
const liveLogs = [];

const ipRequests = {};
const blockedIPs = {};
const suspiciousIPs = {};

const RATE_LIMIT_API = 300;
const RATE_LIMIT_INTERNAL = 1200;
const BLOCK_DURATION = 60 * 60 * 1000; // 1 jam

const INTERNAL_PATHS = [
  '/runtime', '/security-stats', '/live-logs',
  '/set', '/endpoints', '/'
];

const BAD_AGENTS = [
  'python-requests', 'curl', 'wget', 'scrapy',
  'nikto', 'sqlmap', 'nmap', 'masscan',
  'zgrab', 'go-http-client', 'libwww',
  'dirbuster', 'hydra', 'metasploit',
  'nuclei', 'gobuster', 'wfuzz'
];

const SUSPICIOUS_PATHS = [
  '/admin', '/wp-admin', '/phpmyadmin', '/.env',
  '/config', '/shell', '/backdoor', '/eval',
  '/../', '/etc/passwd', '/proc/', '/cmd'
];

function formatRuntime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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
   MIDDLEWARE ANTI-DDOS
================================= */

app.use((req, res, next) => {

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown';

  const ua = req.headers['user-agent'] || '';
  const now = Date.now();
  const isInternal = INTERNAL_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'));

  // ✅ BLOCK 1: Tidak ada User-Agent = bot/script mentah
  if (!ua && !isInternal) {
    addLiveLog('blocked', `🚫 Blocked [No UA]: ${ip}`);
    sendTelegram(
      `🚫 *Blocked — No User-Agent*\n\`IP: ${ip}\`\nPath: \`${req.path}\`\nWaktu: ${new Date().toLocaleString('id-ID')}`,
      `no-ua-${ip}`, 300000
    );
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // ✅ BLOCK 2: Bad User Agent
  const isBadAgent = BAD_AGENTS.some(b => ua.toLowerCase().includes(b));
  if (isBadAgent) {
    addLiveLog('blocked', `🚫 Blocked [Bad Agent]: ${ip} — ${ua.slice(0, 40)}`);
    console.log(chalk.bgRed.white(` BAD AGENT `), chalk.red(ip));
    sendTelegram(
      `🤖 *Blocked — Bad User-Agent*\n\`IP: ${ip}\`\nUA: \`${ua.slice(0, 60)}\`\nWaktu: ${new Date().toLocaleString('id-ID')}`,
      `bad-agent-${ip}`, 300000
    );
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // ✅ BLOCK 3: Path scanning
  const isSuspiciousPath = SUSPICIOUS_PATHS.some(p => req.path.toLowerCase().includes(p));
  if (isSuspiciousPath) {
    blockedIPs[ip] = now + BLOCK_DURATION;
    addLiveLog('blocked', `🚫 Blocked [Path Scan]: ${ip} — tried ${req.path}`);
    console.log(chalk.bgRed.white(` PATH SCAN `), chalk.red(ip), chalk.yellow(req.path));
    sendTelegram(
      `🔍 *Blocked — Path Scanning*\n\`IP: ${ip}\`\nPath: \`${req.path}\`\nStatus: Diblokir 1 jam\nWaktu: ${new Date().toLocaleString('id-ID')}`,
      `scan-${ip}`, 300000
    );
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // ✅ BLOCK 4: Cek IP yang sudah diblokir
  if (blockedIPs[ip]) {
    if (now < blockedIPs[ip]) {
      const sisaMenit = Math.ceil((blockedIPs[ip] - now) / 60000);
      addLiveLog('blocked', `🔒 Still Blocked: ${ip} — sisa ${sisaMenit} menit`);
      return res.status(429).json({
        status: false,
        code: 429,
        message: `IP kamu diblokir. Coba lagi dalam ${sisaMenit} menit.`
      });
    } else {
      addLiveLog('success', `✅ Auto Unblocked: ${ip}`);
      delete blockedIPs[ip];
      delete suspiciousIPs[ip];
    }
  }

  // ✅ BLOCK 5: Rate Limit
  const rateLimit = isInternal ? RATE_LIMIT_INTERNAL : RATE_LIMIT_API;

  if (!ipRequests[ip]) ipRequests[ip] = [];
  ipRequests[ip] = ipRequests[ip].filter(t => now - t < 60000);
  ipRequests[ip].push(now);

  const reqCount = ipRequests[ip].length;

  // Warning di 70% limit
  if (reqCount > rateLimit * 0.7 && reqCount <= rateLimit) {
    if (!suspiciousIPs[ip]) {
      suspiciousIPs[ip] = true;
      addLiveLog('warn', `⚠️ Suspicious: ${ip} — ${reqCount}/${rateLimit} req/menit`);
      sendTelegram(
        `⚠️ *IP Suspicious*\n\`IP: ${ip}\`\nRequest: \`${reqCount}/${rateLimit} per menit\`\nWaktu: ${new Date().toLocaleString('id-ID')}`,
        `suspicious-${ip}`, 120000
      );
    }
  }

  if (reqCount > rateLimit) {
    blockedIPs[ip] = now + BLOCK_DURATION;
    addLiveLog('blocked', `🚫 Blocked [Rate Limit]: ${ip} — ${reqCount} req/menit`);
    console.log(chalk.bgRed.white(` BLOCKED `), chalk.red(ip), chalk.yellow(`${reqCount} req/menit`));
    sendTelegram(
      `🚫 *IP Diblokir — Rate Limit*\n\`IP: ${ip}\`\nRequest: \`${reqCount} per menit\`\nLimit: \`${rateLimit}/menit\`\nDurasi: *1 jam*\nWaktu: ${new Date().toLocaleString('id-ID')}`,
      `blocked-${ip}`, 300000
    );
    return res.status(429).json({
      status: false,
      code: 429,
      message: 'Terlalu banyak request. IP kamu diblokir 1 jam.'
    });
  }

  // ✅ Log request normal
  global.totalreq += 1;

  const logData = {
    ip,
    method: req.method,
    path: req.path,
    time: new Date().toLocaleString('id-ID')
  };

  requestLogs.unshift(logData);
  if (requestLogs.length > 100) requestLogs.pop();

  if (!isInternal) {
    endpointHistory.unshift(logData);
    if (endpointHistory.length > 200) endpointHistory.pop();
  }

  if (!req.path.match(/\.(js|css|png|jpg|ico|html|map)$/)) {
    addLiveLog('request', `📡 ${req.method} ${req.path} — ${ip}`);
  }

  console.log(
    chalk.hex('#00cec9')(`[ ${logData.time} ]`),
    chalk.green(req.method),
    chalk.yellow(req.path),
    chalk.white(ip)
  );

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
   RUNTIME API
================================= */

app.get('/runtime', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - serverStart) / 1000);
  const mem = process.memoryUsage();
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
   SECURITY STATS API
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
    rateLimit: RATE_LIMIT_API,
    blockDuration: '1 jam',
    logs: requestLogs.slice(0, 20)
  });
});

/* ===============================
   LIVE LOGS API
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
   404 HANDLER
================================= */

app.use((req, res) => {
  addLiveLog('warn', `⚠️ 404: ${req.method} ${req.path}`);
  res.status(404).json({
    status: false,
    code: 404,
    message: 'Endpoint tidak ditemukan.'
  });
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log(chalk.bgGreen.black(` 🚀 Server running on port ${PORT} `));
  console.log(chalk.bgCyan.black(` 📦 Total Routes Loaded: ${totalRoutes} `));
  console.log(chalk.bgYellow.black(` 🛡️ Anti-DDoS: API ${RATE_LIMIT_API}/mnt | Internal ${RATE_LIMIT_INTERNAL}/mnt `));

  addLiveLog('success', `🚀 Server started on port ${PORT}`);
  addLiveLog('success', `📦 ${totalRoutes} routes loaded`);
  addLiveLog('success', `🛡️ Anti-DDoS aktif — API: ${RATE_LIMIT_API}/mnt | Dashboard: ${RATE_LIMIT_INTERNAL}/mnt`);

  // Notif Telegram saat server start
  sendTelegram(
    `🚀 *${settings.apiTitle} — Server Started*\n\nPort: \`${PORT}\`\nRoutes: \`${totalRoutes} endpoints\`\nAnti-DDoS: \`Aktif\`\nWaktu: ${new Date().toLocaleString('id-ID')}`
  );
});

module.exports = app;
