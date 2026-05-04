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
