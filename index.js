const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.enable("trust proxy");
app.set("json spaces", 2);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

app.use('/', express.static(path.join(__dirname, '/')));
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

const ipRequests = {};
const blockedIPs = {};

const RATE_LIMIT = 60;
const BLOCK_DURATION = 10 * 60 * 1000;

function formatRuntime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ===============================
   LOGGER + DDOS PROTECT
================================= */

app.use((req, res, next) => {

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown';

  const now = Date.now();

  /* BLOCK CHECK */

  if (blockedIPs[ip]) {

    if (now < blockedIPs[ip]) {

      return res.status(429).json({
        status: false,
        code: 429,
        message: 'IP blocked sementara karena spam request.'
      });

    } else {
      delete blockedIPs[ip];
    }
  }

  /* RATE LIMIT */

  if (!ipRequests[ip]) ipRequests[ip] = [];

  ipRequests[ip] = ipRequests[ip].filter(
    t => now - t < 60000
  );

  ipRequests[ip].push(now);

  if (ipRequests[ip].length > RATE_LIMIT) {

    blockedIPs[ip] = now + BLOCK_DURATION;

    console.log(
      chalk.bgRed.white(` BLOCKED `),
      chalk.red(ip),
      chalk.yellow(`spam detected`)
    );

    return res.status(429).json({
      status: false,
      code: 429,
      message: 'Terlalu banyak request.'
    });
  }

  /* TOTAL REQUEST */

  global.totalreq += 1;

  /* LOG */

  const logData = {
    ip,
    method: req.method,
    path: req.path,
    time: new Date().toLocaleString('id-ID')
  };

  requestLogs.unshift(logData);

  if (requestLogs.length > 100) {
    requestLogs.pop();
  }

  endpointHistory.unshift(logData);

  if (endpointHistory.length > 200) {
    endpointHistory.pop();
  }

  console.log(
    chalk.hex('#00cec9')(`[ ${logData.time} ]`),
    chalk.green(req.method),
    chalk.yellow(req.path),
    chalk.white(ip)
  );

  /* AUTO CREATOR JSON */

  const originalJson = res.json;

  res.json = function (data) {

    if (
      typeof data === 'object' &&
      req.path !== '/endpoints' &&
      req.path !== '/set'
    ) {

      return originalJson.call(this, {
        creator: settings.creatorName || "Created Using SkyWings",
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

  const uptimeSeconds =
    Math.floor((Date.now() - serverStart) / 1000);

  res.json({
    status: true,
    uptime_seconds: uptimeSeconds,
    uptime_formatted: formatRuntime(uptimeSeconds),
    started_at: new Date(serverStart).toISOString(),
    total_request: global.totalreq
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
      sisaDetik: Math.max(
        0,
        Math.floor((expire - now) / 1000)
      )
    }))
    .filter(v => v.sisaDetik > 0);

  res.json({
    status: true,
    totalBlockedNow: blocked.length,
    blockedIPs: blocked,
    rateLimit: RATE_LIMIT,
    logs: requestLogs.slice(0, 20)
  });

});

/* ===============================
   LIVE CONSOLE API
================================= */

app.get('/live-logs', (req, res) => {
  res.json({
    logs: liveLogs.slice(0, 50)
    total_request: global.totalreq,
    logs: requestLogs,
    history: endpointHistory
  });

});

liveLogs.unshift({
  type: 'request',
  time: new Date().toLocaleTimeString('id-ID'),
  message: `${req.ip} accessed ${req.path}`
});

liveLogs.unshift({
  type: 'blocked',
  time: new Date().toLocaleTimeString('id-ID'),
  message: `${req.ip} blocked for spam requests`
});

setInterval(fetchSecurityStats, 5000);
fetchLiveLogs();
setInterval(fetchLiveLogs, 2000);
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

      const handlers =
        Array.isArray(routes)
          ? routes
          : [routes];

      handlers.forEach(route => {

        const {
          name,
          desc,
          category,
          path: routePath,
          run
        } = route;

        if (
          name &&
          desc &&
          category &&
          routePath &&
          typeof run === 'function'
        ) {

          const cleanPath =
            routePath.split('?')[0];

          app.get(cleanPath, run);

          if (!rawEndpoints[category]) {
            rawEndpoints[category] = [];
          }

          rawEndpoints[category].push({
            name,
            desc,
            path: routePath
          });

          totalRoutes++;

          console.log(
            chalk.hex('#55efc4')(`✔ Loaded: `) +
            chalk.hex('#ffeaa7')(
              `${cleanPath} (${file})`
            )
          );

        } else {

          console.warn(
            chalk.bgRed.white(
              ` ⚠ Skipped invalid route in ${file}`
            )
          );
        }

      });

    } catch (err) {

      console.error(
        chalk.bgRed.white(
          ` ❌ Error in ${file}: ${err.message}`
        )
      );
    }
  }
});

/* ===============================
   SORT ENDPOINTS
================================= */

const endpoints = Object.keys(rawEndpoints)
  .sort((a, b) => a.localeCompare(b))
  .reduce((sorted, category) => {

    sorted[category] =
      rawEndpoints[category]
        .sort((a, b) =>
          a.name.localeCompare(b.name)
        );

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

    res.sendFile(
      path.join(__dirname, 'index.html')
    );

  } catch (err) {

    console.log(err);

  }
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {

  console.log(
    chalk.bgGreen.black(
      ` 🚀 Server running on port ${PORT} `
    )
  );

  console.log(
    chalk.bgCyan.black(
      ` 📦 Total Routes Loaded: ${totalRoutes} `
    )
  );

});

/* ===============================
   EXPORT
================================= */

module.exports = app;
