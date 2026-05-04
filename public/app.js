const stageHost = document.getElementById("stage");
const imageInput = document.getElementById("imageInput");
const boardInput = document.getElementById("boardInput");
const statusEl = document.getElementById("status");
const themeBtn = document.getElementById("themeBtn");
const contextMenu = document.getElementById("contextMenu");
const renameEditor = document.getElementById("renameEditor");
const renameInput = document.getElementById("renameInput");

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
    setStatus("Frame renamed");
  }
  if (target.type === "image") {
    const image = findImage(target.id);
    if (!image) return;
    image.name = value || "Image";
    setStatus("Image renamed");
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
  try {
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl })
    });
    if (!response.ok) throw new Error("Asset save failed.");
    const payload = await response.json();
    return payload.url;
  } catch (_error) {
    return dataUrl;
  }
}

async function importRemoteUrl(url) {
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
    setStatus("Image added");
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
  });

  node.on("transformend", () => {
    image.x = Math.round(node.x());
    image.y = Math.round(node.y());
    image.width = Math.max(16, Math.round(node.width() * node.scaleX()));
    image.height = Math.max(16, Math.round(node.height() * node.scaleY()));
    node.scale({ x: 1, y: 1 });
    node.size({ width: image.width, height: image.height });
    attachByPosition(image);
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
  });

  rect.on("transformend", () => {
    frame.width = Math.max(80, Math.round(rect.width() * rect.scaleX()));
    frame.height = Math.max(80, Math.round(rect.height() * rect.scaleY()));
    rect.scale({ x: 1, y: 1 });
    rect.size({ width: frame.width, height: frame.height });
    state.images.forEach(attachByPosition);
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
  setStatus("Frame created");
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
  clearBoard();
  state.viewport = board.viewport || { x: 0, y: 0, scale: 1 };
  stage.position({ x: state.viewport.x || 0, y: state.viewport.y || 0 });
  stage.scale({ x: state.viewport.scale || 1, y: state.viewport.scale || 1 });

  state.frames = Array.isArray(board.frames) ? board.frames : [];
  state.images = Array.isArray(board.images) ? board.images : [];
  idCounter = state.frames.length + state.images.length;

  state.frames.forEach(createFrameNode);
  for (const image of state.images) {
    try {
      const element = await loadImageElement(image.src);
      createImageNode(image, element);
    } catch (_error) {
      image.missing = true;
    }
  }
  setStatus("Board loaded");
}

function serializedBoard() {
  state.viewport = {
    x: Math.round(stage.x()),
    y: Math.round(stage.y()),
    scale: Number(stage.scaleX().toFixed(4))
  };
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    viewport: state.viewport,
    frames: state.frames,
    images: state.images
  };
}

async function saveBoard() {
  const board = serializedBoard();
  const json = JSON.stringify(board, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.href = url;
  link.download = `reference-board-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);

  try {
    await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json
    });
    setStatus("Board saved");
  } catch (_error) {
    setStatus("JSON downloaded");
  }
}

async function loadServerBoard() {
  try {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("No saved board found");
    const board = await response.json();
    await loadBoard(board);
    setStatus("Last save loaded");
  } catch (error) {
    setStatus(error.message);
  }
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
  const src = await importRemoteUrl(url.trim());
  await addImage(src, position);
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
    setStatus("PNG saved");
  } catch (_error) {
    setStatus("PNG export failed for a remote image");
  }
}

function hideContextMenu() {
  contextMenu.hidden = true;
}

function showContextMenu(clientX, clientY, position) {
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
  isPanning = false;
  panLast = null;
  stageHost.classList.remove("panning");
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
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selected) event.preventDefault();
    deleteSelection();
  }
});

document.getElementById("addImageBtn").addEventListener("click", () => imageInput.click());
document.getElementById("addFrameBtn").addEventListener("click", () => createFrame());
document.getElementById("saveBtn").addEventListener("click", saveBoard);
document.getElementById("savePngBtn").addEventListener("click", savePng);
document.getElementById("loadBtn").addEventListener("click", () => boardInput.click());
document.getElementById("loadServerBtn").addEventListener("click", loadServerBoard);
themeBtn.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
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
  if (action === "save-png") savePng();
});

document.addEventListener("click", (event) => {
  if (ignoreNextDocumentClick) return;
  if (!renameEditor.hidden && !renameEditor.contains(event.target)) hideRenameEditor({ commit: true });
  if (!contextMenu.hidden && !contextMenu.contains(event.target)) hideContextMenu();
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
  try {
    const text = await file.text();
    await loadBoard(JSON.parse(text));
    boardInput.value = "";
  } catch (error) {
    setStatus(error.message);
  }
});

resizeStage();
setTheme(localStorage.getItem("reference-board-theme") || "dark");
setStatus("Middle mouse pans. Mouse wheel zooms. Drop, paste, or add images.");
