const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const winston = require('winston');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

/* ===============================
   WINSTON LOGGER (PERSISTENT)
================================= */

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5242880, maxFiles: 5 }),
    new winston.transports.File({ filename: 'logs/combined.log', maxsize: 5242880, maxFiles: 10 }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

if (!fs.existsSync('logs')) fs.mkdirSync('logs');

/* ===============================
   HELMET — SECURITY HEADERS
================================= */

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  xssFilter: true,
  noSniff: true,
  hidePoweredBy: true,
  frameguard: { action: 'deny' }
}));

/* ===============================
   CORS — STRICT ORIGIN
================================= */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin (mobile apps, Postman dev) or whitelisted
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Origin not allowed'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: false,
  maxAge: 86400
}));

/* ===============================
   BODY PARSER — SIZE LIMIT
================================= */

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/* ===============================
   HTTP PARAMETER POLLUTION GUARD
================================= */

app.use(hpp());

/* ===============================
   MONGO/NOSQL INJECTION SANITIZE
================================= */

app.use(mongoSanitize({ replaceWith: '_' }));

/* ===============================
   EXPRESS RATE LIMIT (per IP)
================================= */

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
  handler: (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    addLiveLog('blocked', `🚫 Rate Limit: ${ip}`);
    logger.warn(`Rate limit hit: ${ip} → ${req.path}`);
    sendTelegram(`🚫 *Rate Limit*\n\`${ip}\` → \`${req.path}\``, `rl-${ip}`, 300000);
    return res.status(429).json({
      status: false, code: 429,
      message: 'Terlalu banyak request. Coba lagi dalam 1 menit.'
    });
  }
});

// Slow down repeated requests before hard block
const speedLimiter = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 150,
  delayMs: (hits) => (hits - 150) * 100,
  maxDelayMs: 5000,
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
});

// Stricter limiter for API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
  handler: (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    addLiveLog('blocked', `🚫 API Rate Limit: ${ip}`);
    return res.status(429).json({
      status: false, code: 429,
      message: 'API rate limit tercapai.'
    });
  }
});

app.enable("trust proxy");
app.set("json spaces", 2);

/* ===============================
   STATIC FILES
================================= */

app.use('/', express.static(path.join(__dirname, 'ui')));
app.use('/api', express.static(path.join(__dirname, 'api')));

/* ===============================
   GLOBAL FUNCTIONS
================================= */

global.getBuffer = async (url, options = {}) => {
  try {
    const res = await axios({
      method: 'get', url,
      headers: { 'DNT': 1, 'Upgrade-Insecure-Request': 1 },
      ...options,
      responseType: 'arraybuffer',
      timeout: 10000
    });
    return res.data;
  } catch (err) { return err; }
};

global.fetchJson = async (url, options = {}) => {
  try {
    const res = await axios({
      method: 'GET', url,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      ...options,
      timeout: 10000
    });
    return res.data;
  } catch (err) { return err; }
};

global.apikey = process.env.APIKEY || null;
global.totalreq = 0;
global.broadcastMessage = null;
global.broadcastTime = null;

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
   SERVER STATE
================================= */

let maintenanceMode = false;
let maintenanceMessage = "Server sedang dalam maintenance. Mohon coba beberapa saat lagi.";
let serverStopped = false;
let stopMessage = "Server sedang dihentikan sementara oleh admin.";

const healthHistory = [];

/* ===============================
   TELEGRAM BOT SETUP
================================= */

const TG_TOKEN = process.env.TG_TOKEN || '8281901823:AAFDIM_zu-OQY3H5FsnaE6hcu_446fmjwiY';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6772957208';

const tgCooldown = {};
const userState = {};

async function sendTelegram(message, cooldownKey = null, cooldownMs = 60000) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  if (cooldownKey) {
    const last = tgCooldown[cooldownKey] || 0;
    if (Date.now() - last < cooldownMs) return;
    tgCooldown[cooldownKey] = Date.now();
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID, text: message, parse_mode: 'Markdown'
    });
  } catch {}
}

async function sendTo(chatId, text, keyboard = null) {
  try {
    const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, payload);
  } catch {}
}

async function editMsg(chatId, msgId, text, keyboard = null) {
  try {
    const payload = { chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown' };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, payload);
  } catch {}
}

async function answerCb(id, text = '') {
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/answerCallbackQuery`, {
      callback_query_id: id, text, show_alert: !!text
    });
  } catch {}
}

/* ===============================
   MENU KEYBOARDS
================================= */

const MAIN_MENU = () => [
  [
    { text: '📊 Stats', callback_data: 'stats' },
    { text: '🔒 Security', callback_data: 'security' },
    { text: '📡 Live Logs', callback_data: 'live_logs' }
  ],
  [
    { text: maintenanceMode ? '✅ OFF Maintenance' : '🔧 ON Maintenance', callback_data: 'toggle_maintenance' },
    { text: serverStopped ? '▶️ Start Server' : '⏹️ Stop Server', callback_data: 'toggle_stop' }
  ],
  [
    { text: '🔄 Restart Server', callback_data: 'restart_server' },
    { text: '💊 Health Check', callback_data: 'health_check' }
  ],
  [
    { text: '🚫 Blocked IPs', callback_data: 'blocked_list' },
    { text: '🔓 Unblock IP', callback_data: 'unblock_prompt' },
    { text: '🧹 Clear Blocks', callback_data: 'clear_blocks' }
  ],
  [
    { text: '📋 Endpoints', callback_data: 'endpoints' },
    { text: '📢 Broadcast', callback_data: 'broadcast_prompt' }
  ],
  [
    { text: '📈 Request Stats', callback_data: 'req_stats' },
    { text: '🧠 Memory Detail', callback_data: 'memory_detail' }
  ],
  [
    { text: '🛡️ Firewall Rules', callback_data: 'firewall_rules' },
    { text: '⚙️ Config Info', callback_data: 'update_config' }
  ]
];

const BACK_BTN = [[{ text: '« Kembali ke Menu', callback_data: 'main_menu' }]];

/* ===============================
   SECURITY SYSTEM
================================= */

const serverStart = Date.now();

const requestLogs = [];
const endpointHistory = [];
const liveLogs = [];
const attackLog = [];

const ipRequests = {};
const blockedIPs = {};
const suspiciousIPs = {};
const ipBlacklistPermanent = new Set();
const ipWhitelist = new Set();
const blockCount = {};

// Per-endpoint abuse tracking
const endpointAbuse = {};

const RATE_LIMIT_API = 300;
const RATE_LIMIT_INTERNAL = 1200;
const BLOCK_DURATION = 60 * 60 * 1000;
const PERM_BAN_THRESHOLD = 3;

const INTERNAL_PATHS = [
  '/runtime', '/security-stats', '/live-logs', '/set', '/endpoints', '/'
];

const BAD_AGENTS = [
  'python-requests', 'curl', 'wget', 'scrapy', 'nikto', 'sqlmap', 'nmap',
  'masscan', 'zgrab', 'go-http-client', 'libwww', 'dirbuster', 'hydra',
  'metasploit', 'nuclei', 'gobuster', 'wfuzz', 'burpsuite', 'acunetix',
  'nessus', 'openvas', 'w3af', 'appscan', 'havij', 'pangolin', 'zgrab2',
  'httpx', 'ffuf', 'feroxbuster', 'whatweb', 'wappalyzer', 'shodan'
];

const SUSPICIOUS_PATHS = [
  '/admin', '/wp-admin', '/phpmyadmin', '/.env', '/config', '/shell',
  '/backdoor', '/eval', '/../', '/etc/passwd', '/proc/', '/cmd',
  '/xmlrpc', '/wp-login', '/.git', '/server-status', '/actuator',
  '/api/v1/pods', '/cgi-bin', '/setup.php', '/.htaccess', '/web.config',
  '/dump', '/db', '/database', '/backup', '/bak', '/old', '/test',
  '/debug', '/trace', '/console', '/manager', '/system', '/root',
  '/passwd', '/shadow', '/boot', '/var/', '/tmp/', '/proc/self'
];

const ATTACK_PATTERNS = [
  /<script/i, /union.*select/i, /select.*from/i, /drop.*table/i,
  /insert.*into/i, /exec(\s|\+)+\(/i, /javascript:/i, /vbscript:/i,
  /onload\s*=/i, /onerror\s*=/i, /alert\s*\(/i, /document\.cookie/i,
  /\.\.\//,
  // Additional patterns
  /base64_decode/i, /eval\s*\(/i, /system\s*\(/i, /passthru/i,
  /shell_exec/i, /phpinfo/i, /<iframe/i, /<object/i, /data:text\/html/i,
  /fromcharcode/i, /chr\s*\(\s*\d/i, /0x[0-9a-f]{2}/i,
  /\bOR\b.*\b1\s*=\s*1/i, /\bAND\b.*\b1\s*=\s*1/i,
  /\bWAITFOR\b.*\bDELAY\b/i, /\bSLEEP\s*\(/i, /\bBENCHMARK\s*\(/i
];

// Body attack patterns (check POST/PUT body content)
const BODY_ATTACK_PATTERNS = [
  /<script/i, /union.*select/i, /drop.*table/i,
  /exec(\s|\+)+\(/i, /javascript:/i, /base64_decode/i,
  /eval\s*\(/i, /system\s*\(/i, /shell_exec/i
];

function formatRuntime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function addLiveLog(type, message) {
  const entry = { type, time: new Date().toLocaleTimeString('id-ID'), message };
  liveLogs.unshift(entry);
  if (liveLogs.length > 100) liveLogs.pop();
  // Also persist to winston
  if (type === 'blocked') logger.warn(message);
  else if (type === 'warn') logger.warn(message);
  else logger.info(message);
}

function addAttackLog(ip, type, detail) {
  attackLog.unshift({ ip, type, detail, time: new Date().toLocaleString('id-ID') });
  if (attackLog.length > 50) attackLog.pop();
  logger.warn(`ATTACK [${type}] IP: ${ip} | Detail: ${detail}`);
}

function makeBar(pct) {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const color = pct > 80 ? '🔴' : pct > 60 ? '🟡' : '🟢';
  return `[${color.repeat(filled)}${'⬜'.repeat(empty)}]`;
}

/* ===============================
   API KEY VALIDATOR MIDDLEWARE
================================= */

function validateApiKey(req, res, next) {
  if (!global.apikey) return next(); // No key configured = open
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (!key || key !== global.apikey) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    addLiveLog('blocked', `🔑 Invalid API Key: ${ip} → ${req.path}`);
    logger.warn(`Invalid API Key attempt: ${ip} → ${req.path}`);
    return res.status(401).json({
      status: false, code: 401,
      message: 'API key tidak valid atau tidak disertakan.'
    });
  }
  next();
}

/* ===============================
   AUTO HEALTH MONITOR
================================= */

async function runHealthCheck() {
  const mem = process.memoryUsage();
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const cpuPct = Math.min(100, Math.round((loadAvg[0] / (cpus.length || 1)) * 100));
  const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
  const uptimeSec = Math.floor((Date.now() - serverStart) / 1000);
  const problems = [];

  if (cpuPct > 85) problems.push(`⚙️ CPU tinggi: *${cpuPct}%*`);
  if (heapPct > 80) problems.push(`💾 Heap memory tinggi: *${heapPct}%*`);
  if (parseFloat(rssMb) > 512) problems.push(`🧠 RSS Memory besar: *${rssMb} MB*`);
  if (Object.keys(blockedIPs).length > 20) problems.push(`🚫 IP Blocked banyak: *${Object.keys(blockedIPs).length} IP*`);
  if (attackLog.length > 0) {
    const lastAttackTime = new Date(attackLog[0].time).getTime();
    if (!isNaN(lastAttackTime) && (Date.now() - lastAttackTime) < 60000) {
      problems.push(`⚠️ Ada serangan dalam 1 menit terakhir`);
    }
  }

  const healthData = {
    time: new Date().toLocaleString('id-ID'),
    cpu: cpuPct, heap: heapPct, rss: rssMb,
    uptime: formatRuntime(uptimeSec),
    blocked: Object.keys(blockedIPs).length,
    problems
  };
  healthHistory.unshift(healthData);
  if (healthHistory.length > 30) healthHistory.pop();

  if (problems.length > 0) {
    const alertKey = 'health-' + problems.length + '-' + cpuPct;
    await sendTelegram(
      `🚨 *HEALTH ALERT — ${settings.apiTitle}*\n\n` +
      `Ada *${problems.length} masalah* terdeteksi:\n\n` +
      problems.map((p, i) => `${i + 1}. ${p}`).join('\n') +
      `\n\n🕐 ${new Date().toLocaleString('id-ID')}`,
      alertKey, 300000
    );
  }

  return healthData;
}

setInterval(runHealthCheck, 60 * 1000);

/* ===============================
   CLEANUP STALE BLOCKED IPS
================================= */

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const ip of Object.keys(blockedIPs)) {
    if (now >= blockedIPs[ip]) {
      delete blockedIPs[ip];
      delete suspiciousIPs[ip];
      cleaned++;
    }
  }
  // Cleanup old ipRequests entries
  for (const ip of Object.keys(ipRequests)) {
    ipRequests[ip] = ipRequests[ip].filter(t => now - t < 60000);
    if (ipRequests[ip].length === 0) delete ipRequests[ip];
  }
  if (cleaned > 0) addLiveLog('success', `🧹 Auto cleanup: ${cleaned} IP unblocked`);
}, 5 * 60 * 1000);

/* ===============================
   APPLY GLOBAL RATE LIMITERS
================================= */

app.use(globalLimiter);
app.use(speedLimiter);

/* ===============================
   MAIN SECURITY MIDDLEWARE
================================= */

app.use((req, res, next) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress || req.ip || 'unknown';

  const ua = req.headers['user-agent'] || '';
  const now = Date.now();
  const isInternal = INTERNAL_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'));
  const isStatic = req.path.match(/\.(js|css|png|jpg|ico|html|map|woff|svg)$/);

  // STOP MODE
  if (serverStopped && !isInternal && !isStatic) {
    return res.status(503).json({
      status: false, code: 503, stopped: true,
      message: stopMessage, creator: settings.creatorName
    });
  }

  // MAINTENANCE MODE
  if (maintenanceMode && !isInternal && !isStatic) {
    addLiveLog('warn', `🔧 Maintenance block: ${ip} → ${req.path}`);
    return res.status(503).json({
      status: false, code: 503, maintenance: true,
      message: maintenanceMessage, creator: settings.creatorName,
      broadcast: global.broadcastMessage || null
    });
  }

  // WHITELIST
  if (ipWhitelist.has(ip)) return next();

  // PERMANENT BAN
  if (ipBlacklistPermanent.has(ip)) {
    addLiveLog('blocked', `☠️ Perm-Banned: ${ip}`);
    logger.warn(`Perm-banned IP attempt: ${ip} → ${req.path}`);
    return res.status(403).json({ status: false, code: 403, message: 'Access denied.' });
  }

  // No User-Agent
  if (!ua && !isInternal) {
    addLiveLog('blocked', `🚫 No UA: ${ip}`);
    addAttackLog(ip, 'No-UA', req.path);
    sendTelegram(`🚫 *No UA Blocked*\n\`${ip}\` → \`${req.path}\``, `no-ua-${ip}`, 300000);
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // Bad User-Agent
  const isBadAgent = BAD_AGENTS.some(b => ua.toLowerCase().includes(b));
  if (isBadAgent) {
    addLiveLog('blocked', `🚫 Bad Agent: ${ip}`);
    addAttackLog(ip, 'Bad-UA', ua.slice(0, 60));
    sendTelegram(`🤖 *Bad UA Blocked*\n\`${ip}\`\nUA: \`${ua.slice(0,50)}\``, `bad-ua-${ip}`, 300000);
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // Path Scan
  const isSuspPath = SUSPICIOUS_PATHS.some(p => req.path.toLowerCase().includes(p));
  if (isSuspPath) {
    autoBlock(ip, 'Path-Scan', req.path, now);
    sendTelegram(
      `🔍 *Path Scan Blocked*\n\`${ip}\`\nPath: \`${req.path}\``,
      `scan-${ip}`, 300000
    );
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // XSS / SQLi in URL
  const fullUrl = req.path + '?' + JSON.stringify(req.query);
  if (ATTACK_PATTERNS.some(p => p.test(fullUrl))) {
    autoBlock(ip, 'XSS/SQLi-URL', fullUrl.slice(0, 80), now);
    sendTelegram(
      `💉 *XSS/SQLi URL Detected*\n\`${ip}\`\nPath: \`${req.path}\``,
      `attack-${ip}`, 180000
    );
    return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
  }

  // XSS / SQLi in REQUEST BODY (NEW)
  if (req.body && typeof req.body === 'object') {
    const bodyStr = JSON.stringify(req.body);
    if (BODY_ATTACK_PATTERNS.some(p => p.test(bodyStr))) {
      autoBlock(ip, 'XSS/SQLi-BODY', bodyStr.slice(0, 80), now);
      sendTelegram(
        `💉 *XSS/SQLi BODY Detected*\n\`${ip}\`\nPath: \`${req.path}\``,
        `attack-body-${ip}`, 180000
      );
      return res.status(403).json({ status: false, code: 403, message: 'Forbidden.' });
    }
  }

  // Cek IP terblokir
  if (blockedIPs[ip]) {
    if (now < blockedIPs[ip]) {
      const sisa = Math.ceil((blockedIPs[ip] - now) / 60000);
      addLiveLog('blocked', `🔒 Still Blocked: ${ip} — sisa ${sisa}m`);
      return res.status(429).json({
        status: false, code: 429,
        message: `IP kamu diblokir. Coba lagi dalam ${sisa} menit.`
      });
    } else {
      addLiveLog('success', `✅ Auto Unblocked: ${ip}`);
      delete blockedIPs[ip]; delete suspiciousIPs[ip];
    }
  }

  // Per-IP rate tracking (in-memory backup layer)
  const rateLimit2 = isInternal ? RATE_LIMIT_INTERNAL : RATE_LIMIT_API;
  if (!ipRequests[ip]) ipRequests[ip] = [];
  ipRequests[ip] = ipRequests[ip].filter(t => now - t < 60000);
  ipRequests[ip].push(now);
  const reqCount = ipRequests[ip].length;

  if (reqCount > rateLimit2 * 0.7 && reqCount <= rateLimit2 && !suspiciousIPs[ip]) {
    suspiciousIPs[ip] = true;
    addLiveLog('warn', `⚠️ Suspicious: ${ip} — ${reqCount}/${rateLimit2}`);
    sendTelegram(`⚠️ *IP Suspicious*\n\`${ip}\`\n${reqCount}/${rateLimit2} req/mnt`, `susp-${ip}`, 120000);
  }

  if (reqCount > rateLimit2) {
    autoBlock(ip, 'Rate-Limit', `${reqCount} req/mnt`, now);
    sendTelegram(
      `🚫 *Rate Limit — IP Diblokir*\n\`${ip}\`\n${reqCount}/${rateLimit2} req/mnt`,
      `rl-${ip}`, 300000
    );
    return res.status(429).json({
      status: false, code: 429,
      message: 'Terlalu banyak request. IP kamu diblokir 1 jam.'
    });
  }

  // Request log
  global.totalreq += 1;
  const logData = { ip, method: req.method, path: req.path, time: new Date().toLocaleString('id-ID') };
  requestLogs.unshift(logData);
  if (requestLogs.length > 100) requestLogs.pop();
  if (!isInternal) {
    endpointHistory.unshift(logData);
    if (endpointHistory.length > 200) endpointHistory.pop();
  }
  if (!isStatic) addLiveLog('request', `📡 ${req.method} ${req.path} — ${ip}`);

  console.log(
    chalk.hex('#00cec9')(`[ ${logData.time} ]`),
    chalk.green(req.method), chalk.yellow(req.path), chalk.white(ip)
  );

  // Inject creator + broadcast
  const originalJson = res.json;
  res.json = function (data) {
    if (data && typeof data === 'object' && !Array.isArray(data) &&
      req.path !== '/endpoints' && req.path !== '/set') {
      const extra = {};
      if (global.broadcastMessage) {
        extra.broadcast = global.broadcastMessage;
        extra.broadcast_time = global.broadcastTime;
      }
      return originalJson.call(this, { creator: settings.creatorName, ...extra, ...data });
    }
    return originalJson.call(this, data);
  };

  next();
});

function autoBlock(ip, reason, detail, now) {
  blockedIPs[ip] = now + BLOCK_DURATION;
  blockCount[ip] = (blockCount[ip] || 0) + 1;
  addLiveLog('blocked', `🚫 Blocked [${reason}]: ${ip}`);
  addAttackLog(ip, reason, detail);
  console.log(chalk.bgRed.white(` ${reason} `), chalk.red(ip));

  if (blockCount[ip] >= PERM_BAN_THRESHOLD) {
    ipBlacklistPermanent.add(ip);
    delete blockedIPs[ip];
    addLiveLog('blocked', `☠️ AUTO PERM-BAN: ${ip} (${blockCount[ip]}x block)`);
    logger.error(`AUTO PERM-BAN: ${ip} — ${blockCount[ip]}x blocked, last: ${reason}`);
    sendTelegram(
      `☠️ *AUTO PERMANENT BAN*\n\`IP: ${ip}\`\nSudah *${blockCount[ip]}x* kena block\nTerakhir: ${reason}\nWaktu: ${new Date().toLocaleString('id-ID')}`,
      null, 0
    );
  }
}

/* ===============================
   TELEGRAM BOT HANDLER
================================= */

async function handleUpdate(update) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id.toString();
    const text = (msg.text || '').trim();

    if (chatId !== TG_CHAT_ID) {
      return sendTo(chatId, '⛔ Kamu tidak memiliki akses ke bot ini.');
    }

    if (userState[chatId]) {
      return handleState(chatId, text, userState[chatId]);
    }

    const cmd = text.split(' ')[0];

    switch (cmd) {
      case '/start':
      case '/menu':
        return sendHomeMenu(chatId);
      case '/stats':
        return handleCb(chatId, null, 'stats');
      case '/health':
        return handleCb(chatId, null, 'health_check');
      case '/security':
        return handleCb(chatId, null, 'security');
      case '/maintenance_on':
        maintenanceMode = true;
        addLiveLog('warn', '🔧 Maintenance ON via command');
        return sendTo(chatId, '🔧 *Maintenance mode diaktifkan!*', BACK_BTN);
      case '/maintenance_off':
        maintenanceMode = false;
        addLiveLog('success', '✅ Maintenance OFF via command');
        return sendTo(chatId, '✅ *Maintenance mode dinonaktifkan!*', BACK_BTN);
      case '/stop':
        serverStopped = true;
        addLiveLog('warn', '⏹️ Server dihentikan via command');
        return sendTo(chatId, '⏹️ *Server dihentikan!*', BACK_BTN);
      case '/start_server':
        serverStopped = false;
        addLiveLog('success', '▶️ Server aktif kembali via command');
        return sendTo(chatId, '▶️ *Server aktif kembali!*', BACK_BTN);
      case '/restart':
        return handleCb(chatId, null, 'restart_server');
      case '/unblock': {
        const ip = text.split(' ')[1];
        if (!ip) return sendTo(chatId, '⚠️ Format: `/unblock <ip>`', BACK_BTN);
        return unblockIP(chatId, ip);
      }
      case '/block': {
        const ip = text.split(' ')[1];
        if (!ip) return sendTo(chatId, '⚠️ Format: `/block <ip>`', BACK_BTN);
        blockedIPs[ip] = Date.now() + BLOCK_DURATION;
        addLiveLog('blocked', `🔒 Manual block: ${ip}`);
        return sendTo(chatId, `🚫 IP \`${ip}\` diblokir 1 jam!`, BACK_BTN);
      }
      case '/permban': {
        const ip = text.split(' ')[1];
        if (!ip) return sendTo(chatId, '⚠️ Format: `/permban <ip>`', BACK_BTN);
        ipBlacklistPermanent.add(ip);
        delete blockedIPs[ip];
        addLiveLog('blocked', `☠️ Perm-ban: ${ip}`);
        return sendTo(chatId, `☠️ IP \`${ip}\` di-*permanent ban*!`, BACK_BTN);
      }
      case '/clearblocks':
        return handleCb(chatId, null, 'clear_blocks');
      case '/whitelist': {
        const ip = text.split(' ')[1];
        if (!ip) return sendTo(chatId, '⚠️ Format: `/whitelist <ip>`', BACK_BTN);
        ipWhitelist.add(ip);
        return sendTo(chatId, `✅ IP \`${ip}\` di-whitelist!`, BACK_BTN);
      }
      case '/broadcast': {
        const bcast = text.replace('/broadcast', '').trim();
        if (!bcast) {
          userState[chatId] = 'waiting_broadcast';
          return sendTo(chatId, '📢 Kirimkan pesan broadcast:', [[{ text: '❌ Batal', callback_data: 'main_menu' }]]);
        }
        global.broadcastMessage = bcast;
        global.broadcastTime = new Date().toLocaleString('id-ID');
        return sendTo(chatId, `📢 Broadcast aktif:\n_${bcast}_`, BACK_BTN);
      }
      case '/clearbroadcast':
        global.broadcastMessage = null;
        global.broadcastTime = null;
        return sendTo(chatId, '🗑️ *Broadcast dihapus!*', BACK_BTN);
      case '/help':
        return sendTo(chatId,
          `📖 *Daftar Lengkap Command*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🏠 \`/start\` — Menu utama\n` +
          `📊 \`/stats\` — Statistik server\n` +
          `💊 \`/health\` — Health check\n` +
          `🔒 \`/security\` — Info keamanan\n\n` +
          `*Server Control:*\n` +
          `⏹️ \`/stop\` — Hentikan server\n` +
          `▶️ \`/start_server\` — Hidupkan kembali\n` +
          `🔄 \`/restart\` — Restart via PM2\n\n` +
          `*Maintenance:*\n` +
          `🔧 \`/maintenance_on\` — Aktifkan\n` +
          `🔧 \`/maintenance_off\` — Nonaktifkan\n\n` +
          `*IP Management:*\n` +
          `🚫 \`/block <ip>\` — Block 1 jam\n` +
          `🔓 \`/unblock <ip>\` — Unblock\n` +
          `☠️ \`/permban <ip>\` — Permanent ban\n` +
          `✅ \`/whitelist <ip>\` — Whitelist\n` +
          `🧹 \`/clearblocks\` — Hapus semua blokir\n\n` +
          `*Broadcast:*\n` +
          `📢 \`/broadcast <msg>\` — Set broadcast\n` +
          `🗑️ \`/clearbroadcast\` — Hapus broadcast`,
          BACK_BTN
        );
      default:
        return sendHomeMenu(chatId);
    }
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id.toString();
    const msgId = cb.message.message_id;
    await answerCb(cb.id);
    return handleCb(chatId, msgId, cb.data);
  }
}

async function handleState(chatId, text, state) {
  delete userState[chatId];
  if (state === 'waiting_unblock_ip') return unblockIP(chatId, text);
  if (state === 'waiting_broadcast') {
    global.broadcastMessage = text;
    global.broadcastTime = new Date().toLocaleString('id-ID');
    addLiveLog('warn', `📢 Broadcast: ${text.slice(0,40)}`);
    return sendTo(chatId, `📢 *Broadcast Aktif!*\n\nPesan: _${text}_`, BACK_BTN);
  }
  if (state === 'waiting_maintenance_msg') {
    maintenanceMessage = text;
    maintenanceMode = true;
    addLiveLog('warn', '🔧 Maintenance ON (custom)');
    return sendTo(chatId, `🔧 *Maintenance Aktif!*\nPesan: _${text}_`, BACK_BTN);
  }
  if (state === 'waiting_stop_msg') {
    stopMessage = text;
    serverStopped = true;
    addLiveLog('warn', '⏹️ Server dihentikan (custom msg)');
    return sendTo(chatId, `⏹️ *Server Dihentikan!*\nPesan: _${text}_`, BACK_BTN);
  }
}

async function sendHomeMenu(chatId) {
  const uptimeSec = Math.floor((Date.now() - serverStart) / 1000);
  const status = serverStopped ? '⏹️ STOPPED' : maintenanceMode ? '🔧 MAINTENANCE' : '🟢 ONLINE';
  const blocked = Object.keys(blockedIPs).length;
  const perm = ipBlacklistPermanent.size;
  await sendTo(chatId,
    `╔══════════════════════╗\n` +
    `      🔥 *PHOENIX VISION*\n` +
    `╚══════════════════════╝\n\n` +
    `👤 Creator: *${settings.creatorName}*\n` +
    `📶 Status: ${status}\n` +
    `⏱️ Uptime: \`${formatRuntime(uptimeSec)}\`\n` +
    `📦 Routes: \`${totalRoutes}\`\n` +
    `📡 Total Request: \`${global.totalreq}\`\n` +
    `🚫 Blocked: \`${blocked}\` | ☠️ Perm: \`${perm}\`\n` +
    (global.broadcastMessage ? `📢 Broadcast: _aktif_\n` : ``) +
    `\n🕐 _${new Date().toLocaleString('id-ID')}_\n\n` +
    `_Pilih menu di bawah ini:_`,
    MAIN_MENU()
  );
}

async function handleCb(chatId, msgId, data) {
  const reply = async (text, kb = BACK_BTN) => {
    if (msgId) return editMsg(chatId, msgId, text, kb);
    return sendTo(chatId, text, kb);
  };

  switch (data) {
    case 'main_menu': {
      const uptimeSec = Math.floor((Date.now() - serverStart) / 1000);
      const status = serverStopped ? '⏹️ STOPPED' : maintenanceMode ? '🔧 MAINTENANCE' : '🟢 ONLINE';
      return editMsg(chatId, msgId,
        `╔══════════════════════╗\n` +
        `      🔥 *PHOENIX VISION*\n` +
        `╚══════════════════════╝\n\n` +
        `📶 Status: ${status}\n` +
        `⏱️ Uptime: \`${formatRuntime(uptimeSec)}\`\n` +
        `📡 Total Req: \`${global.totalreq}\`\n` +
        `🕐 _${new Date().toLocaleString('id-ID')}_`,
        MAIN_MENU()
      );
    }
    case 'stats': {
      const uptimeSec = Math.floor((Date.now() - serverStart) / 1000);
      const mem = process.memoryUsage();
      const cpus = os.cpus();
      const loadAvg = os.loadavg();
      const cpuPct = Math.min(100, Math.round((loadAvg[0] / (cpus.length || 1)) * 100));
      const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
      const status = serverStopped ? '⏹️ STOPPED' : maintenanceMode ? '🔧 MAINTENANCE' : '🟢 ONLINE';
      return reply(
        `📊 *Server Statistics*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📶 Status : ${status}\n` +
        `⏱️ Uptime : \`${formatRuntime(uptimeSec)}\`\n` +
        `📡 Total Req : \`${global.totalreq}\`\n` +
        `📦 Routes : \`${totalRoutes}\`\n\n` +
        `⚙️ *CPU*\n` +
        `${makeBar(cpuPct)} \`${cpuPct}%\`\n` +
        `Model: \`${(cpus[0]?.model || 'N/A').slice(0,35)}\`\n` +
        `Cores: \`${cpus.length}\` | Load: \`${loadAvg[0].toFixed(2)}\`\n\n` +
        `💾 *Memory*\n` +
        `Heap ${makeBar(heapPct)} \`${heapPct}%\`\n` +
        `Used: \`${(mem.heapUsed/1024/1024).toFixed(1)}MB\` / \`${(mem.heapTotal/1024/1024).toFixed(1)}MB\`\n` +
        `RSS: \`${(mem.rss/1024/1024).toFixed(1)}MB\`\n\n` +
        `🕐 _${new Date().toLocaleString('id-ID')}_`
      );
    }
    case 'health_check': {
      const h = await runHealthCheck();
      const status = h.problems.length === 0 ? '✅ Semua Sistem Normal' : `⚠️ ${h.problems.length} Masalah Terdeteksi`;
      return reply(
        `💊 *Health Check Report*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${status}\n\n` +
        `⚙️ CPU   ${makeBar(h.cpu)} \`${h.cpu}%\`\n` +
        `💾 Heap ${makeBar(h.heap)} \`${h.heap}%\`\n` +
        `🧠 RSS  : \`${h.rss} MB\`\n` +
        `⏱️ Uptime : \`${h.uptime}\`\n` +
        `🚫 Blocked : \`${h.blocked} IP\`\n\n` +
        (h.problems.length > 0
          ? `*⚠️ Masalah Ditemukan:*\n` + h.problems.map((p,i) => `${i+1}. ${p}`).join('\n') + `\n\n`
          : ``
        ) +
        `🕐 _${h.time}_`
      );
    }
    case 'security': {
      const now = Date.now();
      const active = Object.entries(blockedIPs).filter(([,e]) => now < e);
      const suspicious = Object.keys(suspiciousIPs).filter(ip => !blockedIPs[ip]);
      const recent = attackLog.slice(0,5);
      return reply(
        `🔒 *Security Overview*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🚫 Blocked aktif  : \`${active.length}\`\n` +
        `⚠️ Suspicious     : \`${suspicious.length}\`\n` +
        `☠️ Perm-ban       : \`${ipBlacklistPermanent.size}\`\n` +
        `✅ Whitelist      : \`${ipWhitelist.size}\`\n\n` +
        `📏 Rate Limit API : \`${RATE_LIMIT_API}/mnt\`\n` +
        `📏 Rate Dashboard : \`${RATE_LIMIT_INTERNAL}/mnt\`\n` +
        `⏳ Durasi Ban     : \`1 jam\`\n` +
        `🔁 Auto Perm-ban  : setelah \`${PERM_BAN_THRESHOLD}x\` block\n` +
        `🛡️ Helmet         : \`Aktif\`\n` +
        `🌐 CORS Strict    : \`Aktif\`\n` +
        `💉 Body Sanitize  : \`Aktif\`\n` +
        `🔑 API Key Guard  : \`${global.apikey ? 'Aktif' : 'Nonaktif'}\`\n\n` +
        (recent.length > 0
          ? `*🔴 Attack Log Terbaru:*\n` +
            recent.map(a => `• \`${a.ip}\` — ${a.type} (${a.time.split(',')[1]?.trim() || ''})`).join('\n')
          : `✅ Tidak ada serangan terbaru.`
        ),
        [
          [
            { text: '🚫 Blocked IPs', callback_data: 'blocked_list' },
            { text: '☠️ Perm-ban List', callback_data: 'permban_list' }
          ],
          BACK_BTN[0]
        ]
      );
    }
    case 'permban_list': {
      const perm = [...ipBlacklistPermanent];
      return reply(
        `☠️ *Permanent Ban List (${perm.length} IP)*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (perm.length > 0 ? perm.map((ip,i) => `${i+1}. \`${ip}\``).join('\n') : '✅ Tidak ada perm-ban.')
      );
    }
    case 'toggle_maintenance': {
      if (!maintenanceMode) {
        return reply(
          `🔧 *Aktifkan Maintenance Mode*\n\nPilih tipe pesan:`,
          [
            [
              { text: '🔧 Default', callback_data: 'maintenance_default' },
              { text: '✏️ Custom', callback_data: 'maintenance_custom' }
            ],
            BACK_BTN[0]
          ]
        );
      } else {
        maintenanceMode = false;
        addLiveLog('success', '✅ Maintenance OFF via bot');
        return reply(`✅ *Maintenance Mode NONAKTIF!*\nServer kembali normal.`, MAIN_MENU());
      }
    }
    case 'maintenance_default': {
      maintenanceMode = true;
      maintenanceMessage = "Server sedang dalam maintenance. Mohon coba beberapa saat lagi.";
      addLiveLog('warn', '🔧 Maintenance ON (default)');
      return reply(`🔧 *Maintenance Mode AKTIF!*\n\nPesan: _${maintenanceMessage}_`, MAIN_MENU());
    }
    case 'maintenance_custom': {
      userState[chatId] = 'waiting_maintenance_msg';
      return reply(`✏️ Kirimkan pesan maintenance custom:`, [[{ text: '❌ Batal', callback_data: 'main_menu' }]]);
    }
    case 'toggle_stop': {
      if (!serverStopped) {
        return reply(
          `⏹️ *Stop Server*\n\nPilih tipe pesan:`,
          [
            [
              { text: '⏹️ Default', callback_data: 'stop_default' },
              { text: '✏️ Custom', callback_data: 'stop_custom' }
            ],
            [{ text: '❌ Batal', callback_data: 'main_menu' }]
          ]
        );
      } else {
        serverStopped = false;
        addLiveLog('success', '▶️ Server aktif kembali via bot');
        return reply(`▶️ *Server Aktif Kembali!*\nRequest diterima normal.`, MAIN_MENU());
      }
    }
    case 'stop_default': {
      stopMessage = "Server sedang dihentikan sementara oleh admin.";
      serverStopped = true;
      addLiveLog('warn', '⏹️ Server dihentikan via bot');
      sendTelegram(`⏹️ *Server Dihentikan oleh Admin*\nWaktu: ${new Date().toLocaleString('id-ID')}`);
      return reply(
        `⏹️ *Server Dihentikan!*\n\nSemua request mendapat response 503.\nTekan *Start Server* untuk mengaktifkan kembali.`,
        MAIN_MENU()
      );
    }
    case 'stop_custom': {
      userState[chatId] = 'waiting_stop_msg';
      return reply(`✏️ Kirimkan pesan stop server:`, [[{ text: '❌ Batal', callback_data: 'main_menu' }]]);
    }
    case 'restart_server': {
      return reply(
        `🔄 *Restart Server*\n\nServer akan offline beberapa detik.\nYakin ingin restart?`,
        [
          [
            { text: '✅ Ya, Restart!', callback_data: 'confirm_restart' },
            { text: '❌ Batal', callback_data: 'main_menu' }
          ]
        ]
      );
    }
    case 'confirm_restart': {
      await reply(`🔄 *Mengirim perintah restart...*`);
      addLiveLog('warn', '🔄 Restart via Telegram bot');
      exec('pm2 restart all', async (err, stdout) => {
        if (err) {
          await sendTelegram(`🔄 *PM2 tidak tersedia, process restart...*\nWaktu: ${new Date().toLocaleString('id-ID')}`);
          setTimeout(() => process.exit(0), 1000);
        } else {
          await sendTelegram(`✅ *Restart PM2 Berhasil!*\n\`\`\`${stdout.slice(0,200)}\`\`\`\nWaktu: ${new Date().toLocaleString('id-ID')}`);
        }
      });
      break;
    }
    case 'live_logs': {
      const recent = liveLogs.slice(0, 15);
      return reply(
        `📡 *Live Logs (15 Terbaru)*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`\`\`\n` +
        (recent.length > 0 ? recent.map(l => `[${l.time}] ${l.message}`).join('\n') : 'Belum ada log.') +
        `\`\`\``
      );
    }
    case 'blocked_list': {
      const now = Date.now();
      const blocked = Object.entries(blockedIPs)
        .filter(([,e]) => now < e)
        .map(([ip, e]) => `• \`${ip}\` — sisa ${Math.ceil((e-now)/60000)}m`);
      return reply(
        `🚫 *IP Blocked (${blocked.length} aktif)*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (blocked.length > 0 ? blocked.join('\n') : '✅ Tidak ada IP yang diblokir.')
      );
    }
    case 'unblock_prompt': {
      userState[chatId] = 'waiting_unblock_ip';
      return reply(
        `🔓 *Unblock IP*\n\nKirim IP yang ingin di-unblock:\n_(contoh: 123.45.67.89)_`,
        [[{ text: '❌ Batal', callback_data: 'main_menu' }]]
      );
    }
    case 'clear_blocks': {
      const count = Object.keys(blockedIPs).length;
      for (const ip of Object.keys(blockedIPs)) { delete blockedIPs[ip]; delete suspiciousIPs[ip]; }
      addLiveLog('success', `🧹 ${count} IP di-unblock via bot`);
      return reply(`🧹 *Clear All Blocks*\n\nBerhasil hapus *${count}* IP dari daftar blokir!`);
    }
    case 'endpoints': {
      const cats = Object.keys(endpoints);
      const total = cats.reduce((s, c) => s + (endpoints[c]?.length || 0), 0);
      return reply(
        `📋 *Endpoint List*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Total: \`${total}\` endpoint | \`${cats.length}\` kategori\n\n` +
        cats.map(c => `📁 *${c}* — ${endpoints[c].length} ep`).join('\n')
      );
    }
    case 'broadcast_prompt': {
      if (global.broadcastMessage) {
        return reply(
          `📢 *Broadcast Aktif*\n\nPesan: _${global.broadcastMessage}_\nSet: ${global.broadcastTime}`,
          [
            [
              { text: '✏️ Ubah', callback_data: 'set_broadcast' },
              { text: '🗑️ Hapus', callback_data: 'clear_broadcast' }
            ],
            BACK_BTN[0]
          ]
        );
      }
      return handleCb(chatId, msgId, 'set_broadcast');
    }
    case 'set_broadcast': {
      userState[chatId] = 'waiting_broadcast';
      return reply(
        `📢 *Set Broadcast*\n\nKirim pesan broadcast:`,
        [[{ text: '❌ Batal', callback_data: 'main_menu' }]]
      );
    }
    case 'clear_broadcast': {
      global.broadcastMessage = null;
      global.broadcastTime = null;
      return reply(`🗑️ *Broadcast dihapus!*`);
    }
    case 'req_stats': {
      const topIPs = {};
      requestLogs.forEach(r => { topIPs[r.ip] = (topIPs[r.ip] || 0) + 1; });
      const topIPList = Object.entries(topIPs).sort((a,b) => b[1]-a[1]).slice(0,5)
        .map(([ip,c], i) => `${i+1}. \`${ip}\` — ${c}x`);
      const topPaths = {};
      requestLogs.forEach(r => { topPaths[r.path] = (topPaths[r.path] || 0) + 1; });
      const topPathList = Object.entries(topPaths).sort((a,b) => b[1]-a[1]).slice(0,5)
        .map(([p,c], i) => `${i+1}. \`${p}\` — ${c}x`);
      return reply(
        `📈 *Request Statistics*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📡 Total All-Time : \`${global.totalreq}\`\n` +
        `📋 Log tersimpan  : \`${requestLogs.length}\`\n\n` +
        `*🔝 Top 5 IP:*\n` + (topIPList.join('\n') || '_Belum ada_') +
        `\n\n*🔝 Top 5 Endpoint:*\n` + (topPathList.join('\n') || '_Belum ada_')
      );
    }
    case 'memory_detail': {
      const mem = process.memoryUsage();
      const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
      return reply(
        `🧠 *Memory Detail*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💾 Heap Used   : \`${(mem.heapUsed/1024/1024).toFixed(2)} MB\`\n` +
        `📦 Heap Total  : \`${(mem.heapTotal/1024/1024).toFixed(2)} MB\`\n` +
        `📊 Heap Usage  : ${makeBar(heapPct)} \`${heapPct}%\`\n\n` +
        `🧩 RSS         : \`${(mem.rss/1024/1024).toFixed(2)} MB\`\n` +
        `🔗 External    : \`${(mem.external/1024/1024).toFixed(2)} MB\`\n` +
        `🗃️ ArrayBuffers : \`${((mem.arrayBuffers||0)/1024/1024).toFixed(2)} MB\`\n\n` +
        `_Node.js ${process.version} on ${process.platform}_`
      );
    }
    case 'firewall_rules': {
      return reply(
        `🛡️ *Firewall Rules Aktif*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Helmet Headers:*\n` +
        `• CSP, HSTS, X-Frame-Deny\n` +
        `• XSS Filter, No-Sniff, Hide X-Powered-By\n\n` +
        `*Auto Block:*\n` +
        `• No User-Agent\n` +
        `• Bad UA (${BAD_AGENTS.length} pattern)\n` +
        `• Path Scan (${SUSPICIOUS_PATHS.length} path)\n` +
        `• XSS/SQLi URL & BODY Detection\n` +
        `• Rate Limit (${RATE_LIMIT_API} req/mnt)\n` +
        `• Slow-down setelah 150 req/mnt\n` +
        `• Body size limit (100kb)\n` +
        `• HPP (HTTP Param Pollution)\n` +
        `• NoSQL Injection sanitize\n\n` +
        `*Auto Perm-Ban:*\n` +
        `• IP ${PERM_BAN_THRESHOLD}x block → perm-ban otomatis\n\n` +
        `*CORS:*\n` +
        `• Origin whitelist aktif\n\n` +
        `*Monitor:*\n` +
        `• Health check tiap 1 menit\n` +
        `• Auto cleanup stale block tiap 5 menit\n` +
        `• Log persistent (Winston)`
      );
    }
    case 'update_config': {
      return reply(
        `⚙️ *Konfigurasi Server*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 API Title    : \`${settings.apiTitle}\`\n` +
        `👤 Creator      : \`${settings.creatorName}\`\n` +
        `🔧 Maintenance  : \`${maintenanceMode ? 'ON' : 'OFF'}\`\n` +
        `⏹️ Server Stop  : \`${serverStopped ? 'ON' : 'OFF'}\`\n` +
        `📢 Broadcast    : \`${global.broadcastMessage ? 'Aktif' : 'Tidak ada'}\`\n` +
        `🚫 Rate Limit   : \`${RATE_LIMIT_API}/mnt\`\n` +
        `☠️ Perm-ban at  : \`${PERM_BAN_THRESHOLD}x\` block\n` +
        `🛡️ Helmet       : \`Aktif\`\n` +
        `💾 Winston Log  : \`Aktif\`\n` +
        `🔑 API Key      : \`${global.apikey ? 'Terkonfigurasi' : 'Tidak diset'}\`\n\n` +
        `_Edit \`.env\` untuk ubah config tanpa restart._`
      );
    }
  }
}

async function unblockIP(chatId, ip) {
  if (blockedIPs[ip]) {
    delete blockedIPs[ip];
    delete suspiciousIPs[ip];
    addLiveLog('success', `✅ Unblocked: ${ip} via bot`);
    return sendTo(chatId, `✅ IP \`${ip}\` berhasil di-unblock!`, BACK_BTN);
  } else if (ipBlacklistPermanent.has(ip)) {
    ipBlacklistPermanent.delete(ip);
    addLiveLog('success', `✅ Perm-ban dicabut: ${ip} via bot`);
    return sendTo(chatId, `✅ Permanent ban \`${ip}\` dicabut!`, BACK_BTN);
  } else {
    return sendTo(chatId, `⚠️ IP \`${ip}\` tidak ada di daftar blokir.`, BACK_BTN);
  }
}

/* ===============================
   TELEGRAM POLLING
================================= */

let tgOffset = 0;

async function startPolling() {
  while (true) {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`, {
        params: { offset: tgOffset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
        timeout: 35000
      });
      for (const update of (res.data?.result || [])) {
        tgOffset = update.update_id + 1;
        handleUpdate(update).catch(err => console.error(chalk.red('[TG ERR]'), err.message));
      }
    } catch {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

/* ===============================
   INTERNAL API ROUTES
================================= */

app.get('/set', (req, res) => res.json(settings));

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
    maintenance: maintenanceMode,
    stopped: serverStopped,
    broadcast: global.broadcastMessage || null,
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
    cpu: cpuPct, cpu_cores: cpus.length,
    cpu_model: cpus[0]?.model || 'Unknown CPU', loadAvg
  });
});

app.get('/security-stats', (req, res) => {
  const now = Date.now();
  const blocked = Object.entries(blockedIPs)
    .map(([ip, expire]) => ({
      ip,
      sisaDetik: Math.max(0, Math.floor((expire - now) / 1000)),
      sisaMenit: Math.ceil(Math.max(0, (expire - now)) / 60000)
    }))
    .filter(v => v.sisaDetik > 0);
  res.json({
    status: true,
    totalBlockedNow: blocked.length,
    totalSuspicious: Object.keys(suspiciousIPs).filter(ip => !blockedIPs[ip]).length,
    totalPermBan: ipBlacklistPermanent.size,
    blockedIPs: blocked,
    rateLimit: RATE_LIMIT_API,
    blockDuration: '1 jam',
    logs: requestLogs.slice(0, 20)
  });
});

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
          // Apply per-endpoint rate limiter on API routes
          app.get(cleanPath, apiLimiter, run);
          if (!rawEndpoints[category]) rawEndpoints[category] = [];
          rawEndpoints[category].push({ name, desc, path: routePath });
          totalRoutes++;
          console.log(chalk.hex('#55efc4')(`✔ Loaded: `) + chalk.hex('#ffeaa7')(`${cleanPath} (${file})`));
        } else {
          console.warn(chalk.bgRed.white(` ⚠ Skipped: ${file}`));
        }
      });
    } catch (err) {
      console.error(chalk.bgRed.white(` ❌ Error in ${file}: ${err.message}`));
    }
  }
});

const endpoints = Object.keys(rawEndpoints).sort().reduce((sorted, cat) => {
  sorted[cat] = rawEndpoints[cat].sort((a,b) => a.name.localeCompare(b.name));
  return sorted;
}, {});

app.get('/endpoints', (req, res) => res.json(endpoints));

app.get('/', (req, res) => {
  try { res.sendFile(path.join(__dirname, 'index.html')); }
  catch (err) { console.log(err); }
});

/* ===============================
   404 HANDLER
================================= */

app.use((req, res) => {
  addLiveLog('warn', `⚠️ 404: ${req.method} ${req.path}`);
  res.status(404).json({ status: false, code: 404, message: 'Endpoint tidak ditemukan.' });
});

/* ===============================
   GLOBAL ERROR HANDLER
================================= */

app.use((err, req, res, next) => {
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ status: false, code: 403, message: 'CORS: Origin tidak diizinkan.' });
  }
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ status: false, code: 500, message: 'Internal server error.' });
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log(chalk.bgGreen.black(` 🚀 Server running on port ${PORT} `));
  console.log(chalk.bgCyan.black(` 📦 Total Routes: ${totalRoutes} `));
  console.log(chalk.bgYellow.black(` 🛡️ Helmet + Anti-DDoS + XSS/SQLi Guard Active `));
  console.log(chalk.bgMagenta.black(` 🤖 Telegram Bot: Polling Active `));
  console.log(chalk.bgBlue.black(` 📝 Winston Logger: Active → ./logs/ `));

  addLiveLog('success', `🚀 Server started port ${PORT}`);
  addLiveLog('success', `📦 ${totalRoutes} routes loaded`);
  addLiveLog('success', `🛡️ Helmet + Anti-DDoS + XSS/SQLi + HPP + Body-Check aktif`);
  addLiveLog('success', `🤖 Telegram Bot polling aktif`);
  addLiveLog('success', `📝 Winston log aktif → ./logs/`);

  startPolling().catch(err => console.error(chalk.red('[POLLING ERROR]'), err.message));

  sendTelegram(
    `🚀 *${settings.apiTitle} — Server Online!*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🟢 Status    : *ONLINE*\n` +
    `🔌 Port      : \`${PORT}\`\n` +
    `📦 Routes    : \`${totalRoutes}\`\n` +
    `🛡️ Helmet    : \`Aktif\`\n` +
    `🛡️ Anti-DDoS  : \`Aktif\`\n` +
    `💉 XSS/SQLi  : \`Aktif (URL+Body)\`\n` +
    `☠️ Auto Perm  : \`Aktif\`\n` +
    `📝 Logger    : \`Winston Persistent\`\n` +
    `🤖 Bot       : \`Polling\`\n\n` +
    `🕐 ${new Date().toLocaleString('id-ID')}\n\n` +
    `_Ketik /menu untuk panel kontrol._`
  );
});

module.exports = app;
