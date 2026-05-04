const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const APP_ORIGIN = "app://reference-board";
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
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Delete Selected", accelerator: "Delete", click: () => sendMenuAction("delete-selected") },
        { label: "Rename Selected", accelerator: "F2", click: () => sendMenuAction("rename-selected") }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
