const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const APP_ORIGIN = "app://reference-board";
const GOOGLE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const isMac = process.platform === "darwin";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
]);

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

function assertImageUrl(sourceUrl) {
  const parsed = new URL(String(sourceUrl || ""));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https image URLs can be imported.");
  }
  return parsed;
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

async function searchGoogleImages(_event, request = {}) {
  const query = String(request.query || "").trim();
  if (!query) throw imageSearchError("QUERY_REQUIRED", "Search text is required.");

  const apiKey = credentialValue(process.env.GOOGLE_SEARCH_API_KEY, request.credentials?.apiKey);
  const searchEngineId = credentialValue(process.env.GOOGLE_SEARCH_ENGINE_ID, request.credentials?.searchEngineId);
  if (!apiKey.value || !searchEngineId.value) {
    throw imageSearchError("SETUP_REQUIRED", "Google Image Search setup is required.");
  }

  const params = new URLSearchParams({
    key: apiKey.value,
    cx: searchEngineId.value,
    q: query,
    searchType: "image",
    safe: normalizeSafeSearch(request.safeSearch),
    start: String(normalizeSearchStart(request.start)),
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
    safeSearch: normalizeSafeSearch(request.safeSearch),
    start: normalizeSearchStart(request.start),
    nextStart: payload?.queries?.nextPage?.[0]?.startIndex || null,
    credentialSource: apiKey.source === "environment" && searchEngineId.source === "environment" ? "environment" : "fallback",
    results
  };
}

async function importImageFromUrl(_event, sourceUrl) {
  const parsed = assertImageUrl(sourceUrl);
  const response = await fetch(parsed);
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}.`);
  }

  const mime = response.headers.get("content-type")?.split(";")[0] || "";
  if (!mime.startsWith("image/")) {
    throw new Error("The URL did not return an image.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Image is larger than the import limit.");
  }

  const buffer = Buffer.from(arrayBuffer);
  const assetsDir = path.join(app.getPath("userData"), "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, safeAssetName(extensionForMime(mime))), buffer);

  return {
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`
  };
}

function sendMenuAction(action) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send("reference-board:menu-action", action);
}

function buildApplicationMenu() {
  const fileMenu = {
    label: "File",
    submenu: [
      { label: "Add Images...", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("add-images") },
      { label: "Image Search...", click: () => sendMenuAction("image-search") },
      { label: "New Frame", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-frame") },
      { type: "separator" },
      { label: "Save Board", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save-board") },
      { label: "Open Board...", accelerator: "CmdOrCtrl+Shift+O", click: () => sendMenuAction("open-board") },
      { label: "Import Board...", click: () => sendMenuAction("import-board") },
      { type: "separator" },
      { label: "Export .refboard...", accelerator: "CmdOrCtrl+E", click: () => sendMenuAction("export-board") },
      { label: "Export PNG...", accelerator: "CmdOrCtrl+Shift+E", click: () => sendMenuAction("export-png") },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit", label: "Exit" }
    ]
  };

  const template = [
    fileMenu,
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => sendMenuAction("undo") },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", click: () => sendMenuAction("select-all") },
        { type: "separator" },
        { label: "Delete Selected", accelerator: "Delete", click: () => sendMenuAction("delete-selected") },
        { label: "Rename Selected", accelerator: "F2", click: () => sendMenuAction("rename-selected") }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Reset Zoom", accelerator: "CmdOrCtrl+0", click: () => sendMenuAction("reset-zoom") },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => sendMenuAction("zoom-in") },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => sendMenuAction("zoom-out") },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ];

  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveAppAsset(url) {
  const parsed = new URL(url);
  if (parsed.host !== "reference-board") {
    throw new Error("Unknown app host.");
  }

  const publicDir = path.join(__dirname, "..", "public");
  const pathname = decodeURIComponent(!parsed.pathname || parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  if (pathname === "/vendor/konva.min.js") {
    return path.join(__dirname, "..", "node_modules", "konva", "konva.min.js");
  }

  const requestedPath = path.normalize(path.join(publicDir, pathname));
  const relative = path.relative(publicDir, requestedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("App asset path is outside the public directory.");
  }
  return requestedPath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1f1f1f",
    icon: path.join(__dirname, "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const currentUrl = win.webContents.getURL();
    if (url !== currentUrl) {
      event.preventDefault();
    }
  });

  win.loadURL(`${APP_ORIGIN}/index.html`);
}

function runNativeAction(event, action) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const contents = win.webContents;

  const boardActions = new Set(["undo", "select-all", "reset-zoom", "zoom-in", "zoom-out"]);
  if (boardActions.has(action)) {
    contents.send("reference-board:menu-action", action);
    return;
  }

  const editActions = {
    redo: () => contents.redo(),
    cut: () => contents.cut(),
    copy: () => contents.copy(),
    paste: () => contents.paste()
  };

  if (editActions[action]) {
    editActions[action]();
    return;
  }

  if (action === "toggle-fullscreen") win.setFullScreen(!win.isFullScreen());
  if (action === "minimize") win.minimize();
  if (action === "maximize") {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
  if (action === "close") win.close();
}

app.whenReady().then(() => {
  buildApplicationMenu();

  protocol.handle("app", (request) => {
    try {
      return net.fetch(pathToFileURL(resolveAppAsset(request.url)).toString());
    } catch (error) {
      return new Response(error.message, { status: 404 });
    }
  });

  ipcMain.handle("reference-board:import-image-url", importImageFromUrl);
  ipcMain.handle("reference-board:image-search", async (event, request) => {
    try {
      return await searchGoogleImages(event, request);
    } catch (error) {
      return {
        error: error.message || "Image search failed.",
        code: error.code || "IMAGE_SEARCH_FAILED",
        status: error.status || 500
      };
    }
  });
  ipcMain.on("reference-board:window-control", (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === "minimize") win.minimize();
    if (action === "maximize") {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    if (action === "close") win.close();
  });
  ipcMain.on("reference-board:native-action", runNativeAction);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
