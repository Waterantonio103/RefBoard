const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("referenceBoard", {
  importImageFromUrl: async (url) => {
    if (typeof url !== "string") {
      throw new Error("Image URL must be a string.");
    }
    return ipcRenderer.invoke("reference-board:import-image-url", url);
  },
  searchImages: async (request) => {
    const payload = await ipcRenderer.invoke("reference-board:image-search", request || {});
    if (payload?.error) {
      const error = new Error(payload.error);
      error.code = payload.code;
      error.status = payload.status;
      throw error;
    }
    return payload;
  },
  onMenuAction: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("reference-board:menu-action", listener);
    return () => ipcRenderer.removeListener("reference-board:menu-action", listener);
  },
  windowControl: (action) => {
    if (!["minimize", "maximize", "close"].includes(action)) return;
    ipcRenderer.send("reference-board:window-control", action);
  },
  nativeAction: (action) => {
    const allowedActions = [
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "select-all",
      "reset-zoom",
      "zoom-in",
      "zoom-out",
      "toggle-fullscreen",
      "minimize",
      "maximize",
      "close"
    ];
    if (!allowedActions.includes(action)) return;
    ipcRenderer.send("reference-board:native-action", action);
  }
});
