const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = "127.0.0.1";
const CACHE_FILE = path.join(__dirname, "cache", "presentation-cache.json");
const INDEX_FILE = path.join(__dirname, "index.html");
const MAX_CACHE_ENTRIES = 40;

function ensureCacheFile() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, "{}\n", "utf8");
  }
}

function normalizePrompt(prompt) {
  return String(prompt || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readCache() {
  ensureCacheFile();
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch (_err) {
    return {};
  }
}

function writeCache(cache) {
  ensureCacheFile();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function isValidDeck(deck) {
  return Array.isArray(deck) && deck.length === 5;
}

function trimCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE_ENTRIES) {
    return cache;
  }

  const byOldest = keys
    .map((key) => ({
      key,
      lastAccessAt: cache[key]?.lastAccessAt || 0,
    }))
    .sort((a, b) => a.lastAccessAt - b.lastAccessAt);

  const removeCount = keys.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    delete cache[byOldest[i].key];
  }

  return cache;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function handleCacheGet(req, res) {
  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  const prompt = requestUrl.searchParams.get("prompt") || "";
  const key = normalizePrompt(prompt);

  if (!key) {
    sendJson(res, 200, { hit: false });
    return;
  }

  const cache = readCache();
  const entry = cache[key];

  if (!entry || !isValidDeck(entry.deck)) {
    if (entry) {
      delete cache[key];
      writeCache(cache);
    }
    sendJson(res, 200, { hit: false });
    return;
  }

  entry.lastAccessAt = Date.now();
  cache[key] = entry;
  writeCache(cache);

  sendJson(res, 200, {
    hit: true,
    deck: entry.deck,
  });
}

function handleCacheView(_req, res) {
  const cache = readCache();
  sendJson(res, 200, {
    ok: true,
    filePath: "cache/presentation-cache.json",
    entryCount: Object.keys(cache).length,
    cache,
  });
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 3 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleCachePost(req, res) {
  try {
    const payload = await parseRequestBody(req);
    const prompt = payload?.prompt || "";
    const deck = payload?.deck;
    const key = normalizePrompt(prompt);

    if (!key || !isValidDeck(deck)) {
      sendJson(res, 400, { ok: false, error: "Invalid prompt or deck" });
      return;
    }

    const now = Date.now();
    const cache = readCache();
    cache[key] = {
      originalPrompt: prompt,
      deck,
      createdAt: cache[key]?.createdAt || now,
      lastAccessAt: now,
    };

    trimCache(cache);
    writeCache(cache);

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Bad request" });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/cache") {
    handleCacheGet(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/cache/view") {
    handleCacheView(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/cache") {
    await handleCachePost(req, res);
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    sendFile(res, INDEX_FILE, "text/html; charset=utf-8");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

ensureCacheFile();
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Cache file: ${CACHE_FILE}`);
});
