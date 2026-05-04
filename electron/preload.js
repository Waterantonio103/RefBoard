const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("referenceBoard", {
  importImageFromUrl: async (url) => {
    if (typeof url !== "string") {
      throw new Error("Image URL must be a string.");
    }
    return ipcRenderer.invoke("reference-board:import-image-url", url);
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
  }
});
