const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 5177);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(ROOT, "assets");
const DATA_DIR = path.join(ROOT, "data");
const BOARD_FILE = path.join(DATA_DIR, "last-board.json");
const GOOGLE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

app.use(express.json({ limit: "80mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/assets", express.static(ASSETS_DIR));
app.use("/vendor", express.static(path.join(ROOT, "node_modules", "konva")));

async function ensureDirs() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function extensionForMime(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp"
  };
  return map[mime] || "img";
}

function safeAssetName(ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 10);
  return `${stamp}-${random}.${ext}`;
}

function normalizeSafeSearch(value) {
  return value === "off" ? "off" : "active";
}

function normalizeSearchStart(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 1;
  return Math.min(91, Math.max(1, number));
}

function sourceDomain(sourcePageUrl, fallback) {
  try {
    return new URL(sourcePageUrl).hostname.replace(/^www\./i, "");
  } catch (_error) {
    return fallback || "";
  }
}

function credentialValue(runtimeValue, fallbackValue) {
  const runtime = String(runtimeValue || "").trim();
  if (runtime) return { value: runtime, source: "environment" };
  return { value: String(fallbackValue || "").trim(), source: "fallback" };
}

function imageSearchError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function mapGoogleError(status, payload) {
  const message = String(payload?.error?.message || "");
  const reasons = Array.isArray(payload?.error?.errors)
    ? payload.error.errors.map((entry) => String(entry.reason || ""))
    : [];
  const lowerMessage = message.toLowerCase();
  if (status === 403 && reasons.some((reason) => /quota|dailylimit|ratelimit/i.test(reason))) {
    return imageSearchError("QUOTA_EXCEEDED", "Google Image Search quota exceeded.", 429);
  }
  if (status === 400 || status === 403 || /api key|key|cx|credential/i.test(lowerMessage)) {
    return imageSearchError("INVALID_CREDENTIALS", "Google Image Search credentials were rejected.", 401);
  }
  return imageSearchError("GOOGLE_ERROR", message || "Google Image Search request failed.", status >= 500 ? 502 : status);
}

function normalizeGoogleResults(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((item) => {
    const sourcePageUrl = item?.image?.contextLink || item?.link || "";
    return {
      title: String(item?.title || "Untitled image"),
      sourcePageUrl,
      imageUrl: String(item?.link || ""),
      thumbnailUrl: String(item?.image?.thumbnailLink || item?.link || ""),
      sourceDomain: sourceDomain(sourcePageUrl, item?.displayLink),
      width: Number(item?.image?.width) || null,
      height: Number(item?.image?.height) || null
    };
  }).filter((item) => item.imageUrl);
}

async function searchGoogleImages(options) {
  const query = String(options.query || "").trim();
  if (!query) throw imageSearchError("QUERY_REQUIRED", "Search text is required.");

  const apiKey = credentialValue(process.env.GOOGLE_SEARCH_API_KEY, options.apiKey);
  const searchEngineId = credentialValue(process.env.GOOGLE_SEARCH_ENGINE_ID, options.searchEngineId);
  if (!apiKey.value || !searchEngineId.value) {
    throw imageSearchError("SETUP_REQUIRED", "Google Image Search setup is required.", 400);
  }

  const params = new URLSearchParams({
    key: apiKey.value,
    cx: searchEngineId.value,
    q: query,
    searchType: "image",
    safe: normalizeSafeSearch(options.safeSearch),
    start: String(normalizeSearchStart(options.start)),
    num: "10"
  });

  let response;
  try {
    response = await fetch(`${GOOGLE_SEARCH_ENDPOINT}?${params.toString()}`);
  } catch (_error) {
    throw imageSearchError("NETWORK_FAILURE", "Could not reach Google Image Search.", 502);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) throw mapGoogleError(response.status, payload);

  const results = normalizeGoogleResults(payload);
  if (!results.length) throw imageSearchError("NO_RESULTS", "No image results found.", 404);

  return {
    query,
    safeSearch: normalizeSafeSearch(options.safeSearch),
    start: normalizeSearchStart(options.start),
    nextStart: payload?.queries?.nextPage?.[0]?.startIndex || null,
    credentialSource: apiKey.source === "environment" && searchEngineId.source === "environment" ? "environment" : "fallback",
    results
  };
}

app.post("/api/assets", async (req, res) => {
  try {
    const { dataUrl } = req.body;
    const match = /^data:(image\/[-+.\w]+);base64,(.+)$/u.exec(dataUrl || "");
    if (!match) {
      return res.status(400).json({ error: "Expected an image data URL." });
    }

    const mime = match[1];
    const ext = extensionForMime(mime);
    const fileName = safeAssetName(ext);
    const filePath = path.join(ASSETS_DIR, fileName);
    await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
    res.json({ url: `/assets/${fileName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/import-url", async (req, res) => {
  try {
    const sourceUrl = String(req.body.url || "");
    const parsed = new URL(sourceUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Only http and https image URLs can be imported." });
    }

    const response = await fetch(parsed);
    if (!response.ok) {
      return res.status(400).json({ error: `Image request failed with ${response.status}.` });
    }

    const mime = response.headers.get("content-type")?.split(";")[0] || "";
    if (!mime.startsWith("image/")) {
      return res.status(400).json({ error: "The URL did not return an image." });
    }

    const ext = extensionForMime(mime);
    const fileName = safeAssetName(ext);
    const filePath = path.join(ASSETS_DIR, fileName);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    res.json({ url: `/assets/${fileName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/image-search", async (req, res) => {
  try {
    const payload = await searchGoogleImages({
      query: req.body.query,
      safeSearch: req.body.safeSearch,
      start: req.body.start,
      apiKey: req.body.credentials?.apiKey,
      searchEngineId: req.body.credentials?.searchEngineId
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Image search failed.",
      code: error.code || "IMAGE_SEARCH_FAILED"
    });
  }
});

app.get("/api/board", async (_req, res) => {
  try {
    const json = await fs.readFile(BOARD_FILE, "utf8");
    res.type("json").send(json);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "No server-saved board exists yet." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/board", async (req, res) => {
  try {
    await fs.writeFile(BOARD_FILE, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ ok: true, path: BOARD_FILE });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

ensureDirs().then(() => {
  app.listen(PORT, () => {
    console.log(`Reference Board running at http://localhost:${PORT}`);
  });
});
