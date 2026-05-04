const stageHost = document.getElementById("stage");
const imageInput = document.getElementById("imageInput");
const boardInput = document.getElementById("boardInput");
const statusEl = document.getElementById("status");
const saveStateEl = document.getElementById("saveState");
const themeBtn = document.getElementById("themeBtn");
const contextMenu = document.getElementById("contextMenu");
const renameEditor = document.getElementById("renameEditor");
const renameInput = document.getElementById("renameInput");
const boardTitleBtn = document.getElementById("boardTitleBtn");
const boardRenameEditor = document.getElementById("boardRenameEditor");
const boardRenameInput = document.getElementById("boardRenameInput");
const openDialog = document.getElementById("openDialog");
const boardList = document.getElementById("boardList");
const appMenus = Array.from(document.querySelectorAll(".app-menu"));
const fileAutoSaveInput = document.getElementById("fileAutoSaveInput");
const windowMinimizeBtn = document.getElementById("windowMinimizeBtn");
const windowMaximizeBtn = document.getElementById("windowMaximizeBtn");
const windowCloseBtn = document.getElementById("windowCloseBtn");
const storage = window.RefBoardStorage;

const state = {
  images: [],
  frames: [],
  viewport: { x: 0, y: 0, scale: 1 }
};

const nodes = {
  images: new Map(),
  frames: new Map()
};

let idCounter = 0;
let selected = null;
let isPanning = false;
let panLast = null;
let activeFrameDrag = null;
let pendingImagePosition = null;
let contextWorldPosition = null;
let renameTarget = null;
let ignoreNextDocumentClick = false;
let autoSaveTimer = null;
let isLoadingBoard = false;
let isSavingBoard = false;
let autoSaveEnabled = true;
let currentBoard = {
  id: null,
  name: "Board.001",
  createdAt: null,
  updatedAt: null,
  lastOpenedAt: null,
  thumbnail: null,
  dirty: false,
  importedUnsaved: true,
  saveState: "unsaved"
};

const stage = new Konva.Stage({
  container: "stage",
  width: stageHost.clientWidth,
  height: stageHost.clientHeight
});

const contentLayer = new Konva.Layer();
const overlayLayer = new Konva.Layer();
stage.add(contentLayer);
stage.add(overlayLayer);

const transformer = new Konva.Transformer({
  rotateEnabled: false,
  keepRatio: false,
  anchorSize: 9,
  borderStroke: "#75a7ff",
  anchorFill: "#1f2022",
  anchorStroke: "#75a7ff"
});
overlayLayer.add(transformer);

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyCanvasTheme() {
  const accent = cssVar("--accent");
  transformer.borderStroke(accent);
  transformer.anchorFill(cssVar("--bg"));
  transformer.anchorStroke(accent);
  nodes.frames.forEach(({ rect, label }) => {
    rect.fill(cssVar("--frame-fill"));
    rect.stroke(cssVar("--frame-stroke"));
    label.fill(cssVar("--frame-title"));
  });
  contentLayer.batchDraw();
  overlayLayer.batchDraw();
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("reference-board-theme", nextTheme);
  themeBtn.setAttribute("aria-pressed", String(nextTheme === "light"));
  themeBtn.title = nextTheme === "light" ? "Switch to dark theme" : "Switch to light theme";
  themeBtn.setAttribute("aria-label", themeBtn.title);
  applyCanvasTheme();
}

function setStatus(message) {
  statusEl.textContent = message || "";
  if (message) {
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      statusEl.textContent = "";
    }, 3500);
  }
}

function makeBoardId() {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeBoardName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function updateBoardChrome() {
  boardTitleBtn.textContent = currentBoard.name || "Untitled Board";
  boardTitleBtn.title = `${currentBoard.name || "Untitled Board"} - double-click to rename`;
  saveStateEl.textContent = currentBoard.saveState;
  saveStateEl.dataset.state = currentBoard.saveState === "save failed" ? "failed" : currentBoard.saveState;
}

function setSaveState(saveState) {
  currentBoard.saveState = saveState;
  updateBoardChrome();
}

function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  if (!autoSaveEnabled) return;
  autoSaveTimer = window.setTimeout(() => {
    saveBoard({ silent: true, fromAutoSave: true });
  }, 10000);
}

function markDirty(message) {
  if (isLoadingBoard) return;
  currentBoard.dirty = true;
  setSaveState("unsaved");
  scheduleAutoSave();
  if (message) setStatus(message);
}

async function nextBoardName() {
  const boards = await storage.listBoards();
  const used = new Set(boards.map((board) => board.name));
  let index = 1;
  while (used.has(`Board.${String(index).padStart(3, "0")}`)) index += 1;
  return `Board.${String(index).padStart(3, "0")}`;
}

function hideRenameEditor({ commit = false } = {}) {
  if (!renameTarget) {
    renameEditor.hidden = true;
    return;
  }

  const target = renameTarget;
  renameTarget = null;
  renameEditor.hidden = true;

  if (!commit) {
    if (target.type === "frame") {
      const frame = findFrame(target.id);
      if (frame) frame.name = target.originalName;
      const entry = nodes.frames.get(target.id);
      if (entry) entry.label.text(target.originalName);
      contentLayer.batchDraw();
    }
    if (target.type === "image") {
      const image = findImage(target.id);
      if (image) image.name = target.originalName;
    }
    return;
  }

  const value = renameInput.value.trim();
  if (target.type === "frame") {
    const frame = findFrame(target.id);
    if (!frame) return;
    frame.name = value || "Frame";
    const entry = nodes.frames.get(target.id);
    if (entry) entry.label.text(frame.name);
    contentLayer.batchDraw();
    markDirty("Frame renamed");
  }
  if (target.type === "image") {
    const image = findImage(target.id);
    if (!image) return;
    image.name = value || "Image";
    markDirty("Image renamed");
  }
}

function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function resizeStage() {
  stage.width(stageHost.clientWidth);
  stage.height(stageHost.clientHeight);
}

function screenToWorld(clientX, clientY) {
  const rect = stageHost.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const scale = stage.scaleX();
  return {
    x: (x - stage.x()) / scale,
    y: (y - stage.y()) / scale
  };
}

function worldToScreen(x, y) {
  const rect = stageHost.getBoundingClientRect();
  const scale = stage.scaleX();
  return {
    x: rect.left + stage.x() + x * scale,
    y: rect.top + stage.y() + y * scale
  };
}

function showRenameEditor(type, id, screenPosition) {
  const item = type === "frame" ? findFrame(id) : findImage(id);
  if (!item) return;
  hideContextMenu();
  hideRenameEditor();
  const fallbackName = type === "frame" ? "Frame" : "Image";
  renameTarget = { type, id, originalName: item.name || fallbackName };
  renameInput.value = item.name || fallbackName;
  renameEditor.hidden = false;
  ignoreNextDocumentClick = true;
  window.setTimeout(() => {
    ignoreNextDocumentClick = false;
  }, 0);

  const { width, height } = renameEditor.getBoundingClientRect();
  const x = Math.min(screenPosition.x, window.innerWidth - width - 8);
  const y = Math.min(screenPosition.y, window.innerHeight - height - 8);
  renameEditor.style.left = `${Math.max(8, x)}px`;
  renameEditor.style.top = `${Math.max(8, y)}px`;
  renameInput.focus();
  renameInput.select();
}

function viewportCenter() {
  const rect = stageHost.getBoundingClientRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function findImage(id) {
  return state.images.find((image) => image.id === id);
}

function findFrame(id) {
  return state.frames.find((frame) => frame.id === id);
}

function frameIdFromNode(node) {
  let current = node;
  while (current && current !== stage) {
    if (nodes.frames.has(current.id())) return current.id();
    current = current.getParent();
  }
  return null;
}

function frameAtPoint(point) {
  for (let index = state.frames.length - 1; index >= 0; index -= 1) {
    const frame = state.frames[index];
    if (
      point.x >= frame.x &&
      point.x <= frame.x + frame.width &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.height
    ) {
      return frame;
    }
  }
  return null;
}

function attachByPosition(image) {
  const center = {
    x: image.x + image.width / 2,
    y: image.y + image.height / 2
  };
  const frame = frameAtPoint(center);
  image.frameId = frame ? frame.id : null;
}

function selectNode(type, id) {
  selected = { type, id };
  if (type === "image") {
    transformer.nodes([nodes.images.get(id)]);
  } else if (type === "frame") {
    transformer.nodes([nodes.frames.get(id).rect]);
  } else {
    selected = null;
    transformer.nodes([]);
  }
  overlayLayer.batchDraw();
}

function imageSizeFromNatural(imageElement) {
  const maxSide = 420;
  const naturalWidth = imageElement.naturalWidth || 320;
  const naturalHeight = imageElement.naturalHeight || 240;
  const ratio = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  return {
    width: Math.max(40, Math.round(naturalWidth * ratio)),
    height: Math.max(40, Math.round(naturalHeight * ratio))
  };
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const imageElement = new Image();
    imageElement.crossOrigin = "anonymous";
    imageElement.onload = () => resolve(imageElement);
    imageElement.onerror = () => reject(new Error("Could not load image."));
    imageElement.src = src;
  });
}

async function persistDataUrl(dataUrl) {
  return downscaleImageDataUrl(dataUrl);
}

async function importRemoteUrl(url) {
  if (window.referenceBoard?.importImageFromUrl) {
    try {
      const payload = await window.referenceBoard.importImageFromUrl(url);
      if (payload?.dataUrl) return payload.dataUrl;
    } catch (_error) {
      return url;
    }
  }

  try {
    const response = await fetch("/api/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    if (!response.ok) throw new Error("Remote import failed.");
    const payload = await response.json();
    return payload.url;
  } catch (_error) {
    return url;
  }
}

async function addImage(src, position) {
  try {
    const imageElement = await loadImageElement(src);
    const size = imageSizeFromNatural(imageElement);
    const image = {
      id: makeId("image"),
      name: "Image",
      src,
      blobId: makeId("blob"),
      mime: mimeFromDataUrl(src),
      x: Math.round(position.x - size.width / 2),
      y: Math.round(position.y - size.height / 2),
      width: size.width,
      height: size.height,
      frameId: null
    };
    attachByPosition(image);
    state.images.push(image);
    createImageNode(image, imageElement);
    selectNode("image", image.id);
    markDirty("Image added");
  } catch (error) {
    setStatus(error.message);
  }
}

function createImageNode(image, imageElement) {
  const node = new Konva.Image({
    id: image.id,
    image: imageElement,
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    draggable: true
  });

  node.on("mousedown touchstart", (event) => {
    event.cancelBubble = true;
    selectNode("image", image.id);
  });

  node.on("dragmove", () => {
    image.x = Math.round(node.x());
    image.y = Math.round(node.y());
  });

  node.on("dragend", () => {
    image.x = Math.round(node.x());
    image.y = Math.round(node.y());
    attachByPosition(image);
    markDirty();
  });

  node.on("transformend", () => {
    image.x = Math.round(node.x());
    image.y = Math.round(node.y());
    image.width = Math.max(16, Math.round(node.width() * node.scaleX()));
    image.height = Math.max(16, Math.round(node.height() * node.scaleY()));
    node.scale({ x: 1, y: 1 });
    node.size({ width: image.width, height: image.height });
    attachByPosition(image);
    markDirty();
  });

  nodes.images.set(image.id, node);
  contentLayer.add(node);
  node.moveToTop();
  contentLayer.batchDraw();
}

function createFrameNode(frame) {
  if (!frame.name) frame.name = "Frame";
  const group = new Konva.Group({
    id: frame.id,
    x: frame.x,
    y: frame.y,
    draggable: true
  });

  const label = new Konva.Text({
    x: 0,
    y: -34,
    text: frame.name,
    fontSize: 22,
    fontFamily: "Segoe UI, Arial, sans-serif",
    fill: cssVar("--frame-title"),
    fontStyle: "bold",
    padding: 0
  });

  const rect = new Konva.Rect({
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
    fill: cssVar("--frame-fill"),
    stroke: cssVar("--frame-stroke"),
    strokeWidth: 2,
    dash: []
  });

  group.add(rect);
  group.add(label);

  group.on("mousedown touchstart", (event) => {
    event.cancelBubble = true;
    selectNode("frame", frame.id);
  });

  label.on("dblclick dbltap", (event) => {
    event.cancelBubble = true;
    showRenameEditor("frame", frame.id, worldToScreen(frame.x, frame.y - 40));
  });

  group.on("dragstart", () => {
    activeFrameDrag = { id: frame.id, x: group.x(), y: group.y() };
  });

  group.on("dragmove", () => {
    const dx = group.x() - activeFrameDrag.x;
    const dy = group.y() - activeFrameDrag.y;
    frame.x = Math.round(group.x());
    frame.y = Math.round(group.y());
    activeFrameDrag.x = group.x();
    activeFrameDrag.y = group.y();

    state.images
      .filter((image) => image.frameId === frame.id)
      .forEach((image) => {
        image.x = Math.round(image.x + dx);
        image.y = Math.round(image.y + dy);
        const imageNode = nodes.images.get(image.id);
        if (imageNode) imageNode.position({ x: image.x, y: image.y });
      });
  });

  group.on("dragend", () => {
    frame.x = Math.round(group.x());
    frame.y = Math.round(group.y());
    activeFrameDrag = null;
    markDirty();
  });

  rect.on("transformend", () => {
    frame.width = Math.max(80, Math.round(rect.width() * rect.scaleX()));
    frame.height = Math.max(80, Math.round(rect.height() * rect.scaleY()));
    rect.scale({ x: 1, y: 1 });
    rect.size({ width: frame.width, height: frame.height });
    state.images.forEach(attachByPosition);
    markDirty();
  });

  nodes.frames.set(frame.id, { group, rect, label });
  contentLayer.add(group);
  group.moveToBottom();
  contentLayer.batchDraw();
}

function nextFrameName() {
  return `Frame ${state.frames.length + 1}`;
}

function createFrame(position = viewportCenter()) {
  const frame = {
    id: makeId("frame"),
    name: nextFrameName(),
    x: Math.round(position.x - 450),
    y: Math.round(position.y - 450),
    width: 900,
    height: 900
  };
  state.frames.push(frame);
  createFrameNode(frame);
  selectNode("frame", frame.id);
  markDirty("Frame created");
}

function renameFrame(id) {
  const frame = findFrame(id);
  if (!frame) return;
  showRenameEditor("frame", id, worldToScreen(frame.x, frame.y - 40));
}

function renameImage(id) {
  const image = findImage(id);
  if (!image) return;
  showRenameEditor("image", id, worldToScreen(image.x + image.width / 2, image.y + image.height / 2));
}

function renameSelection() {
  if (!selected) return;
  if (selected.type === "frame") renameFrame(selected.id);
  if (selected.type === "image") renameImage(selected.id);
}

function clearBoard() {
  state.images = [];
  state.frames = [];
  nodes.images.clear();
  nodes.frames.clear();
  contentLayer.destroyChildren();
  transformer.nodes([]);
  selected = null;
  contentLayer.batchDraw();
  overlayLayer.batchDraw();
}

async function loadBoard(board) {
  isLoadingBoard = true;
  clearBoard();
  state.viewport = board.viewport || { x: 0, y: 0, scale: 1 };
  stage.position({ x: state.viewport.x || 0, y: state.viewport.y || 0 });
  stage.scale({ x: state.viewport.scale || 1, y: state.viewport.scale || 1 });

  state.frames = Array.isArray(board.frames) ? board.frames.map((frame) => ({ ...frame })) : [];
  state.images = Array.isArray(board.images) ? board.images.map((image) => ({ ...image })) : [];
  idCounter = state.frames.length + state.images.length;

  state.frames.forEach(createFrameNode);
  for (const image of state.images) {
    try {
      if (!image.src && image.blobId) {
        const blob = await storage.getImage(image.blobId);
        image.src = blob?.dataUrl || "";
        image.mime = image.mime || blob?.mime;
      }
      const element = await loadImageElement(image.src);
      createImageNode(image, element);
    } catch (_error) {
      image.missing = true;
    }
  }
  isLoadingBoard = false;
  setStatus("Board loaded");
}

function serializedBoard() {
  state.viewport = {
    x: Math.round(stage.x()),
    y: Math.round(stage.y()),
    scale: Number(stage.scaleX().toFixed(4))
  };
  return {
    id: currentBoard.id,
    name: currentBoard.name,
    createdAt: currentBoard.createdAt,
    updatedAt: currentBoard.updatedAt,
    lastOpenedAt: currentBoard.lastOpenedAt,
    thumbnail: currentBoard.thumbnail,
    version: 2,
    viewport: state.viewport,
    frames: state.frames.map((frame) => ({ ...frame })),
    images: state.images.map((image) => ({ ...image }))
  };
}

async function dataUrlFromRenderableSource(src) {
  if (!src) throw new Error("Image source is missing.");
  if (/^data:image\//i.test(src)) return persistDataUrl(src);

  const imageElement = await loadImageElement(src);
  const canvas = document.createElement("canvas");
  canvas.width = imageElement.naturalWidth || imageElement.width;
  canvas.height = imageElement.naturalHeight || imageElement.height;
  const context = canvas.getContext("2d");
  context.drawImage(imageElement, 0, 0);
  return persistDataUrl(canvas.toDataURL("image/png"));
}

async function persistBoardImages() {
  const now = new Date().toISOString();
  const savedImages = [];

  for (const image of state.images) {
    const saved = { ...image };
    try {
      const dataUrl = await dataUrlFromRenderableSource(image.src);
      saved.blobId = saved.blobId || makeId("blob");
      saved.mime = mimeFromDataUrl(dataUrl);
      saved.src = dataUrl;
      image.blobId = saved.blobId;
      image.mime = saved.mime;
      await storage.putImage({
        id: saved.blobId,
        boardId: currentBoard.id,
        dataUrl,
        mime: saved.mime,
        name: saved.name || "Image",
        createdAt: now,
        updatedAt: now
      });
      delete saved.missing;
    } catch (_error) {
      saved.storageMissing = true;
    }
    if (!saved.storageMissing) delete saved.src;
    savedImages.push(saved);
  }

  return savedImages;
}

function generateThumbnail() {
  const rect = boardContentBounds();
  if (!rect) return null;

  try {
    const padding = 24;
    return contentLayer.toDataURL({
      x: Math.floor(rect.x - padding),
      y: Math.floor(rect.y - padding),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2),
      pixelRatio: 0.35,
      mimeType: "image/jpeg",
      quality: 0.82
    });
  } catch (_error) {
    return null;
  }
}

async function saveBoard(options = {}) {
  if (isSavingBoard) return false;
  const { silent = false, fromAutoSave = false } = options;
  const name = sanitizeBoardName(currentBoard.name);
  if (!name) {
    setStatus("Board name is required");
    setSaveState("save failed");
    return false;
  }

  const conflict = await storage.findNameConflict(name, currentBoard.id);
  if (conflict) {
    setStatus(`A board named "${name}" already exists`);
    setSaveState("save failed");
    return false;
  }

  if (!fromAutoSave && currentBoard.id) {
    setStatus(`Overwriting "${name}"`);
  }

  isSavingBoard = true;
  setSaveState("saving");
  window.clearTimeout(autoSaveTimer);

  try {
    const now = new Date().toISOString();
    currentBoard.id = currentBoard.id || makeBoardId();
    currentBoard.name = name;
    currentBoard.createdAt = currentBoard.createdAt || now;
    currentBoard.updatedAt = now;
    currentBoard.lastOpenedAt = now;
    currentBoard.thumbnail = generateThumbnail();

    const base = serializedBoard();
    const board = {
      ...base,
      images: await persistBoardImages(),
      updatedAt: now,
      lastOpenedAt: now,
      thumbnail: currentBoard.thumbnail
    };

    await storage.cleanupImagesForBoard(board);
    await storage.putBoard(board);
    await storage.setPref("lastBoardId", currentBoard.id);
    currentBoard.dirty = false;
    currentBoard.importedUnsaved = false;
    setSaveState("saved");
    if (!silent) setStatus(`Saved "${currentBoard.name}"`);
    return true;
  } catch (error) {
    currentBoard.dirty = true;
    setSaveState("save failed");
    setStatus(error.name === "QuotaExceededError" ? "Save failed: browser storage quota exceeded" : "Save failed");
    return false;
  } finally {
    isSavingBoard = false;
  }
}

async function exportRefboard() {
  const board = serializedBoard();
  const exportImages = [];
  for (const image of state.images) {
    const exported = { ...image };
    try {
      exported.imageData = await dataUrlFromRenderableSource(image.src);
      exported.mime = mimeFromDataUrl(exported.imageData);
    } catch (_error) {
      if (image.blobId) {
        const blob = await storage.getImage(image.blobId);
        exported.imageData = blob?.dataUrl || "";
      }
    }
    if (exported.imageData) delete exported.src;
    exportImages.push(exported);
  }

  const payload = {
    format: "refboard",
    version: 2,
    exportedAt: new Date().toISOString(),
    board: {
      ...board,
      images: exportImages
    }
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const fileSafeName = (currentBoard.name || "reference-board").replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "");
  link.href = url;
  link.download = `${fileSafeName || "reference-board"}.refboard`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("RefBoard exported");
}

async function availableNameFrom(baseName) {
  const fallback = sanitizeBoardName(baseName) || (await nextBoardName());
  const boards = await storage.listBoards();
  const used = new Set(boards.map((board) => board.name));
  if (!used.has(fallback)) return fallback;

  let index = 2;
  while (used.has(`${fallback} ${index}`)) index += 1;
  return `${fallback} ${index}`;
}

async function ensureCurrentBoardSaved() {
  if (!currentBoard.dirty) return true;
  const shouldSave = window.confirm("Save current board before opening another board?");
  if (!shouldSave) return false;
  return saveBoard();
}

async function openSavedBoard(id) {
  if (!(await ensureCurrentBoardSaved())) return;
  const board = await storage.getBoard(id);
  if (!board) {
    setStatus("Board not found");
    return;
  }

  const now = new Date().toISOString();
  currentBoard = {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    lastOpenedAt: now,
    thumbnail: board.thumbnail,
    dirty: false,
    importedUnsaved: false,
    saveState: "saved"
  };
  updateBoardChrome();
  await loadBoard(board);
  await storage.putBoard({ ...board, lastOpenedAt: now });
  await storage.setPref("lastBoardId", board.id);
  openDialog.close();
  setSaveState("saved");
}

function boardTimeLabel(board) {
  const value = board.updatedAt || board.createdAt || "";
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function renderOpenPicker() {
  const boards = await storage.listBoards();
  boardList.innerHTML = "";

  if (!boards.length) {
    const empty = document.createElement("div");
    empty.className = "empty-thumb";
    empty.textContent = "No saved boards";
    boardList.append(empty);
    return;
  }

  boards.forEach((board) => {
    const card = document.createElement("article");
    card.className = "board-card";
    card.dataset.boardId = board.id;

    if (board.thumbnail) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = board.thumbnail;
      card.append(img);
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-thumb";
      empty.textContent = "No preview";
      card.append(empty);
    }

    const title = document.createElement("div");
    title.className = "board-card-title";
    title.textContent = board.name;
    card.append(title);

    const time = document.createElement("div");
    time.className = "board-card-time";
    time.textContent = boardTimeLabel(board);
    card.append(time);

    const actions = document.createElement("div");
    actions.className = "board-card-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.dataset.action = "open";
    openButton.textContent = "Open";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete";
    actions.append(openButton, deleteButton);
    card.append(actions);
    boardList.append(card);
  });
}

async function showOpenPicker() {
  await renderOpenPicker();
  openDialog.showModal();
}

function normalizeImportedBoard(raw, fallbackName) {
  const source = raw?.format === "refboard" && raw.board ? raw.board : raw;
  const images = Array.isArray(source.images)
    ? source.images.map((image) => {
        const imported = { ...image };
        imported.id = imported.id || makeId("image");
        imported.blobId = makeId("blob");
        imported.src = imported.imageData || imported.src || "";
        imported.mime = imported.mime || mimeFromDataUrl(imported.src);
        delete imported.imageData;
        return imported;
      })
    : [];

  return {
    version: 2,
    name: source.name || fallbackName,
    viewport: source.viewport || { x: 0, y: 0, scale: 1 },
    frames: Array.isArray(source.frames) ? source.frames : [],
    images
  };
}

async function importBoardFile(file) {
  if (!(await ensureCurrentBoardSaved())) {
    boardInput.value = "";
    return;
  }

  try {
    const text = await file.text();
    const imported = normalizeImportedBoard(JSON.parse(text), file.name.replace(/\.(refboard|json)$/i, ""));
    const name = await availableNameFrom(imported.name || file.name.replace(/\.(refboard|json)$/i, ""));
    currentBoard = {
      id: null,
      name,
      createdAt: null,
      updatedAt: null,
      lastOpenedAt: null,
      thumbnail: null,
      dirty: true,
      importedUnsaved: true,
      saveState: "unsaved"
    };
    updateBoardChrome();
    await loadBoard(imported);
    markDirty("Imported as unsaved copy");
  } catch (error) {
    setStatus(error.message || "Import failed");
  } finally {
    boardInput.value = "";
  }
}

function showBoardRenameEditor() {
  boardRenameInput.value = currentBoard.name || "";
  boardRenameEditor.hidden = false;
  boardRenameInput.focus();
  boardRenameInput.select();
}

async function hideBoardRenameEditor({ commit = false } = {}) {
  if (boardRenameEditor.hidden) return;
  boardRenameEditor.hidden = true;
  if (!commit) return;

  const name = sanitizeBoardName(boardRenameInput.value);
  if (!name || name === currentBoard.name) return;

  const conflict = await storage.findNameConflict(name, currentBoard.id);
  if (conflict) {
    setStatus(`A board named "${name}" already exists`);
    return;
  }

  currentBoard.name = name;
  updateBoardChrome();
  markDirty("Board renamed");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function mimeFromDataUrl(dataUrl) {
  return /^data:([^;,]+)/i.exec(dataUrl || "")?.[1] || "image/png";
}

async function downscaleImageDataUrl(dataUrl) {
  const mime = mimeFromDataUrl(dataUrl);
  if (mime === "image/gif" || mime === "image/svg+xml") return dataUrl;

  const imageElement = await loadImageElement(dataUrl);
  const maxSide = 2400;
  const naturalWidth = imageElement.naturalWidth || imageElement.width;
  const naturalHeight = imageElement.naturalHeight || imageElement.height;
  const ratio = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  if (ratio >= 1 && dataUrl.length < 12_000_000) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
  const context = canvas.getContext("2d");
  context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
  const outputMime = mime === "image/jpeg" ? "image/jpeg" : "image/webp";
  return canvas.toDataURL(outputMime, 0.9);
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

async function addFiles(files, position) {
  const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
  for (let index = 0; index < images.length; index += 1) {
    const dataUrl = await fileToDataUrl(images[index]);
    const src = await persistDataUrl(dataUrl);
    await addImage(src, {
      x: position.x + index * 28,
      y: position.y + index * 28
    });
  }
}

async function pasteClipboardImage(position) {
  if (!navigator.clipboard?.read) {
    setStatus("Clipboard image paste is not supported here");
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (imageType) {
        const blob = await item.getType(imageType);
        const dataUrl = await blobToDataUrl(blob);
        const src = await persistDataUrl(dataUrl);
        await addImage(src, position);
        setStatus("Image pasted");
        return;
      }

      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        const url = imageUrlFromHtml(html);
        if (url) {
          await addUrl(url, position);
          setStatus("Image pasted");
          return;
        }
      }

      const textType = item.types.find((type) => type === "text/plain" || type === "text/uri-list");
      if (textType) {
        const text = (await (await item.getType(textType)).text()).trim();
        if (/^data:image\//i.test(text)) {
          const src = await persistDataUrl(text);
          await addImage(src, position);
          setStatus("Image pasted");
          return;
        }
        if (/^https?:\/\//i.test(text)) {
          await addUrl(text, position);
          setStatus("Image pasted");
          return;
        }
      }
    }

    if (navigator.clipboard.readText) {
      const text = (await navigator.clipboard.readText()).trim();
      if (/^data:image\//i.test(text)) {
        const src = await persistDataUrl(text);
        await addImage(src, position);
        setStatus("Image pasted");
        return;
      }
      if (/^https?:\/\//i.test(text)) {
        await addUrl(text, position);
        setStatus("Image pasted");
        return;
      }
    }

    setStatus("No pasteable image in clipboard");
  } catch (error) {
    setStatus(error.message || "Could not read clipboard");
  }
}

function imageUrlFromHtml(html) {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html || "");
  return match ? match[1] : "";
}

async function addUrl(url, position) {
  if (!url) return;
  const importedUrl = await importRemoteUrl(url.trim());
  try {
    const response = await fetch(importedUrl);
    if (!response.ok) throw new Error("Image request failed.");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("The URL did not return an image.");
    const dataUrl = await blobToDataUrl(blob);
    await addImage(await persistDataUrl(dataUrl), position);
  } catch (_error) {
    await addImage(importedUrl, position);
  }
}

function deleteSelection() {
  if (!selected) return;
  if (selected.type === "image") {
    const index = state.images.findIndex((image) => image.id === selected.id);
    if (index >= 0) state.images.splice(index, 1);
    nodes.images.get(selected.id)?.destroy();
    nodes.images.delete(selected.id);
  }
  if (selected.type === "frame") {
    const index = state.frames.findIndex((frame) => frame.id === selected.id);
    if (index >= 0) state.frames.splice(index, 1);
    state.images.forEach((image) => {
      if (image.frameId === selected.id) image.frameId = null;
    });
    nodes.frames.get(selected.id)?.group.destroy();
    nodes.frames.delete(selected.id);
  }
  selectNode(null, null);
  contentLayer.batchDraw();
  markDirty("Deleted");
}

function boardContentBounds() {
  if (!state.frames.length && !state.images.length) return null;
  const rect = contentLayer.getClientRect({
    skipShadow: true,
    skipStroke: false,
    relativeTo: contentLayer
  });
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return rect;
}

function savePng() {
  const rect = boardContentBounds();
  if (!rect) {
    setStatus("Nothing to export");
    return;
  }

  const padding = 16;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try {
    const dataUrl = contentLayer.toDataURL({
      x: Math.floor(rect.x - padding),
      y: Math.floor(rect.y - padding),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2),
      pixelRatio: 2,
      mimeType: "image/png"
    });
    downloadDataUrl(dataUrl, `reference-board-${stamp}.png`);
    setStatus("PNG exported");
  } catch (_error) {
    setStatus("PNG export failed for a remote image");
  }
}

function hideContextMenu() {
  contextMenu.hidden = true;
}

function hideFileMenu() {
  appMenus.forEach((menu) => {
    menu.querySelector(".app-menu-dropdown").hidden = true;
    menu.querySelector(".app-menu-button").setAttribute("aria-expanded", "false");
  });
}

function toggleTopMenu(menu) {
  const dropdown = menu.querySelector(".app-menu-dropdown");
  const button = menu.querySelector(".app-menu-button");
  const willOpen = dropdown.hidden;
  hideContextMenu();
  hideFileMenu();
  dropdown.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function showContextMenu(clientX, clientY, position) {
  hideFileMenu();
  contextWorldPosition = position;
  const hasSelection = Boolean(selected);
  contextMenu.querySelector('[data-action="rename"]').disabled = !hasSelection;
  contextMenu.querySelector('[data-action="delete"]').disabled = !hasSelection;
  contextMenu.querySelector('[data-action="paste-image"]').disabled = !navigator.clipboard?.read;
  contextMenu.querySelector('[data-action="save-png"]').disabled = !state.frames.length && !state.images.length;
  contextMenu.hidden = false;

  const { width, height } = contextMenu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - width - 8);
  const y = Math.min(clientY, window.innerHeight - height - 8);
  contextMenu.style.left = `${Math.max(8, x)}px`;
  contextMenu.style.top = `${Math.max(8, y)}px`;
}

function runDesktopMenuAction(action) {
  const position = viewportCenter();
  if (action === "add-images") {
    pendingImagePosition = position;
    imageInput.click();
  }
  if (action === "new-frame") createFrame(position);
  if (action === "save-board") saveBoard();
  if (action === "open-board") showOpenPicker();
  if (action === "import-board") boardInput.click();
  if (action === "export-board") exportRefboard();
  if (action === "export-png") savePng();
  if (action === "toggle-auto-save") {
    setAutoSaveEnabled(!autoSaveEnabled);
  }
  if (action === "delete-selected") deleteSelection();
  if (action === "rename-selected") {
    if (selected?.type === "frame") {
      const frame = state.frames.find((item) => item.id === selected.id);
      if (frame) showRenameEditor("frame", frame.id, worldToScreen(frame.x, frame.y - 40));
    }
    if (selected?.type === "image") {
      const image = state.images.find((item) => item.id === selected.id);
      if (image) showRenameEditor("image", image.id, worldToScreen(image.x + image.width / 2, image.y + image.height / 2));
    }
  }
}

async function setAutoSaveEnabled(enabled) {
  autoSaveEnabled = Boolean(enabled);
  fileAutoSaveInput.checked = autoSaveEnabled;
  await storage.setPref("autoSave", autoSaveEnabled);
  setStatus(autoSaveEnabled ? "Auto Save on" : "Auto Save off");
  if (autoSaveEnabled && currentBoard.dirty) scheduleAutoSave();
}

stage.on("mousedown", (event) => {
  hideContextMenu();
  if (!renameEditor.hidden && event.evt.button !== 2) hideRenameEditor({ commit: true });
  if (event.evt.button === 1) {
    isPanning = true;
    panLast = { x: event.evt.clientX, y: event.evt.clientY };
    stageHost.classList.add("panning");
    event.evt.preventDefault();
    return;
  }

  if (event.target === stage) {
    selectNode(null, null);
  }
});

stage.on("contextmenu", (event) => {
  event.evt.preventDefault();
  const position = screenToWorld(event.evt.clientX, event.evt.clientY);
  if (event.target === stage) {
    selectNode(null, null);
  } else if (nodes.images.has(event.target.id())) {
    selectNode("image", event.target.id());
  } else {
    const frameId = frameIdFromNode(event.target);
    if (frameId) selectNode("frame", frameId);
  }
  showContextMenu(event.evt.clientX, event.evt.clientY, position);
});

stage.on("mousemove", (event) => {
  if (!isPanning || !panLast) return;
  const dx = event.evt.clientX - panLast.x;
  const dy = event.evt.clientY - panLast.y;
  stage.position({ x: stage.x() + dx, y: stage.y() + dy });
  panLast = { x: event.evt.clientX, y: event.evt.clientY };
});

window.addEventListener("mouseup", () => {
  const wasPanning = isPanning;
  isPanning = false;
  panLast = null;
  stageHost.classList.remove("panning");
  if (wasPanning) markDirty();
});

stageHost.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

stage.on("wheel", (event) => {
  event.evt.preventDefault();
  const oldScale = stage.scaleX();
  const pointer = stage.getPointerPosition();
  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale
  };
  const scaleBy = 1.08;
  const direction = event.evt.deltaY > 0 ? -1 : 1;
  const newScale = Math.min(6, Math.max(0.08, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy));
  stage.scale({ x: newScale, y: newScale });
  stage.position({
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale
  });
  markDirty();
});

window.addEventListener("resize", () => {
  resizeStage();
  hideRenameEditor({ commit: true });
});
window.addEventListener("scroll", () => {
  hideContextMenu();
  hideRenameEditor({ commit: true });
});
window.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});

stageHost.addEventListener("dragover", (event) => {
  event.preventDefault();
});

stageHost.addEventListener("drop", async (event) => {
  event.preventDefault();
  const position = screenToWorld(event.clientX, event.clientY);
  if (event.dataTransfer.files?.length) {
    await addFiles(event.dataTransfer.files, position);
    return;
  }

  const url =
    event.dataTransfer.getData("text/uri-list") ||
    imageUrlFromHtml(event.dataTransfer.getData("text/html")) ||
    event.dataTransfer.getData("text/plain");
  await addUrl(url, position);
});

window.addEventListener("paste", async (event) => {
  const position = viewportCenter();
  const imageFiles = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length) {
    await addFiles(imageFiles, position);
    return;
  }

  const url =
    imageUrlFromHtml(event.clipboardData?.getData("text/html")) ||
    event.clipboardData?.getData("text/plain");
  if (url && /^https?:\/\//i.test(url.trim())) {
    await addUrl(url, position);
  }
});

window.addEventListener("keydown", (event) => {
  if (!renameEditor.hidden) return;
  hideContextMenu();
  if (event.key === "Escape") hideFileMenu();
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selected) event.preventDefault();
    deleteSelection();
  }
});

document.getElementById("addImageBtn").addEventListener("click", () => imageInput.click());
document.getElementById("addFrameBtn").addEventListener("click", () => createFrame());
document.getElementById("saveBtn").addEventListener("click", saveBoard);
document.getElementById("openBtn").addEventListener("click", showOpenPicker);
document.getElementById("importBtn").addEventListener("click", () => boardInput.click());
document.getElementById("exportBoardBtn").addEventListener("click", exportRefboard);
document.getElementById("savePngBtn").addEventListener("click", savePng);
window.referenceBoard?.onMenuAction?.(runDesktopMenuAction);
appMenus.forEach((menu) => {
  const menuButton = menu.querySelector(".app-menu-button");
  const dropdown = menu.querySelector(".app-menu-dropdown");
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTopMenu(menu);
  });
  dropdown.addEventListener("click", (event) => {
    event.stopPropagation();
    const menuAction = event.target.closest("button[data-menu-action]");
    const nativeAction = event.target.closest("button[data-native-action]");
    if (menuAction) {
      hideFileMenu();
      runDesktopMenuAction(menuAction.dataset.menuAction);
    }
    if (nativeAction) {
      hideFileMenu();
      window.referenceBoard?.nativeAction?.(nativeAction.dataset.nativeAction);
    }
  });
});
fileAutoSaveInput.addEventListener("change", () => {
  setAutoSaveEnabled(fileAutoSaveInput.checked);
});
windowMinimizeBtn?.addEventListener("click", () => window.referenceBoard?.windowControl?.("minimize"));
windowMaximizeBtn?.addEventListener("click", () => window.referenceBoard?.windowControl?.("maximize"));
windowCloseBtn?.addEventListener("click", () => window.referenceBoard?.windowControl?.("close"));
themeBtn.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

boardTitleBtn.addEventListener("dblclick", showBoardRenameEditor);

boardRenameEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  hideBoardRenameEditor({ commit: true });
});

boardRenameEditor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    hideBoardRenameEditor();
  }
});

boardRenameEditor.addEventListener("click", (event) => {
  event.stopPropagation();
});

boardList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".board-card");
  if (!button || !card) return;

  const boardId = card.dataset.boardId;
  if (button.dataset.action === "open") {
    await openSavedBoard(boardId);
  }
  if (button.dataset.action === "delete") {
    const board = await storage.getBoard(boardId);
    if (board && window.confirm(`Delete "${board.name}"?`)) {
      await storage.deleteBoard(boardId);
      if (currentBoard.id === boardId) {
        currentBoard.id = null;
        currentBoard.dirty = true;
        currentBoard.importedUnsaved = true;
        setSaveState("unsaved");
      }
      await renderOpenPicker();
      setStatus("Board deleted");
    }
  }
});

contextMenu.addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const position = contextWorldPosition || viewportCenter();
  hideContextMenu();
  if (action === "add-image") {
    pendingImagePosition = position;
    imageInput.click();
  }
  if (action === "paste-image") pasteClipboardImage(position);
  if (action === "add-frame") createFrame(position);
  if (action === "rename") renameSelection();
  if (action === "delete") deleteSelection();
  if (action === "save") saveBoard();
  if (action === "export-board") exportRefboard();
  if (action === "save-png") savePng();
});

document.addEventListener("click", (event) => {
  if (ignoreNextDocumentClick) return;
  if (!renameEditor.hidden && !renameEditor.contains(event.target)) hideRenameEditor({ commit: true });
  if (!boardRenameEditor.hidden && !boardRenameEditor.contains(event.target) && event.target !== boardTitleBtn) {
    hideBoardRenameEditor({ commit: true });
  }
  if (!contextMenu.hidden && !contextMenu.contains(event.target)) hideContextMenu();
  if (!event.target.closest(".app-menu")) hideFileMenu();
});

renameEditor.addEventListener("click", (event) => {
  event.stopPropagation();
});

renameInput.addEventListener("input", () => {
  if (!renameTarget) return;
  const value = renameInput.value || (renameTarget.type === "frame" ? "Frame" : "Image");
  if (renameTarget.type === "frame") {
    const frame = findFrame(renameTarget.id);
    if (frame) frame.name = value;
    const entry = nodes.frames.get(renameTarget.id);
    if (entry) entry.label.text(value);
    contentLayer.batchDraw();
  }
  if (renameTarget.type === "image") {
    const image = findImage(renameTarget.id);
    if (image) image.name = value;
  }
});

renameEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  hideRenameEditor({ commit: true });
});

renameEditor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    hideRenameEditor();
  }
});

imageInput.addEventListener("change", async () => {
  if (imageInput.files.length) {
    await addFiles(imageInput.files, pendingImagePosition || viewportCenter());
    pendingImagePosition = null;
    imageInput.value = "";
  }
});

boardInput.addEventListener("change", async () => {
  const file = boardInput.files[0];
  if (!file) return;
  await importBoardFile(file);
});

async function createBlankBoard() {
  const name = await nextBoardName();
  currentBoard = {
    id: null,
    name,
    createdAt: null,
    updatedAt: null,
    lastOpenedAt: null,
    thumbnail: null,
    dirty: false,
    importedUnsaved: true,
    saveState: "unsaved"
  };
  await loadBoard({ viewport: { x: 0, y: 0, scale: 1 }, frames: [], images: [] });
  updateBoardChrome();
}

async function restoreStartupBoard() {
  autoSaveEnabled = await storage.getPref("autoSave", true);
  fileAutoSaveInput.checked = autoSaveEnabled;

  const lastBoardId = await storage.getPref("lastBoardId", null);
  const boards = await storage.listBoards();
  const mostRecentlyOpened = [...boards].sort((a, b) =>
    String(b.lastOpenedAt || b.updatedAt || "").localeCompare(String(a.lastOpenedAt || a.updatedAt || ""))
  )[0];
  const lastBoard = (lastBoardId && boards.find((board) => board.id === lastBoardId)) || mostRecentlyOpened;

  if (!lastBoard) {
    await createBlankBoard();
    setStatus("New board ready");
    return;
  }

  currentBoard = {
    id: lastBoard.id,
    name: lastBoard.name,
    createdAt: lastBoard.createdAt,
    updatedAt: lastBoard.updatedAt,
    lastOpenedAt: lastBoard.lastOpenedAt,
    thumbnail: lastBoard.thumbnail,
    dirty: false,
    importedUnsaved: false,
    saveState: "saved"
  };
  updateBoardChrome();
  await loadBoard(lastBoard);
  setSaveState("saved");
}

resizeStage();
setTheme(localStorage.getItem("reference-board-theme") || "dark");
restoreStartupBoard().catch((error) => {
  setStatus(error.message || "Storage failed");
});
