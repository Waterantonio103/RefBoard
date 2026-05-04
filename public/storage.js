(function () {
  const DB_NAME = "refboard";
  const DB_VERSION = 1;
  const BOARD_STORE = "boards";
  const IMAGE_STORE = "images";
  const PREF_STORE = "prefs";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(BOARD_STORE)) {
          const boards = db.createObjectStore(BOARD_STORE, { keyPath: "id" });
          boards.createIndex("name", "name", { unique: true });
          boards.createIndex("updatedAt", "updatedAt", { unique: false });
          boards.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(PREF_STORE)) {
          db.createObjectStore(PREF_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function transaction(storeNames, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores = Array.isArray(storeNames)
        ? storeNames.map((name) => tx.objectStore(name))
        : tx.objectStore(storeNames);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted."));

      let result;
      try {
        result = callback(stores, tx);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function listBoards() {
    const db = await openDb();
    const tx = db.transaction(BOARD_STORE, "readonly");
    const store = tx.objectStore(BOARD_STORE);
    const records = await requestToPromise(store.getAll());
    return records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async function getBoard(id) {
    if (!id) return null;
    const db = await openDb();
    return requestToPromise(db.transaction(BOARD_STORE, "readonly").objectStore(BOARD_STORE).get(id));
  }

  async function putBoard(board) {
    await transaction(BOARD_STORE, "readwrite", (store) => {
      store.put(board);
    });
    return board;
  }

  async function deleteBoard(id) {
    const board = await getBoard(id);
    await transaction([BOARD_STORE, IMAGE_STORE], "readwrite", ([boards, images]) => {
      boards.delete(id);
      (board?.images || []).forEach((image) => {
        if (image.blobId) images.delete(image.blobId);
      });
    });
  }

  async function getImage(id) {
    if (!id) return null;
    const db = await openDb();
    return requestToPromise(db.transaction(IMAGE_STORE, "readonly").objectStore(IMAGE_STORE).get(id));
  }

  async function putImage(image) {
    await transaction(IMAGE_STORE, "readwrite", (store) => {
      store.put(image);
    });
    return image;
  }

  async function cleanupImagesForBoard(board) {
    const liveIds = new Set((board.images || []).map((image) => image.blobId).filter(Boolean));
    const previous = await getBoard(board.id);
    const staleIds = (previous?.images || [])
      .map((image) => image.blobId)
      .filter((id) => id && !liveIds.has(id));

    if (!staleIds.length) return;
    await transaction(IMAGE_STORE, "readwrite", (store) => {
      staleIds.forEach((id) => store.delete(id));
    });
  }

  async function getPref(key, fallback = null) {
    const db = await openDb();
    const record = await requestToPromise(db.transaction(PREF_STORE, "readonly").objectStore(PREF_STORE).get(key));
    return record ? record.value : fallback;
  }

  async function setPref(key, value) {
    await transaction(PREF_STORE, "readwrite", (store) => {
      store.put({ key, value });
    });
  }

  async function findNameConflict(name, exceptId = null) {
    const boards = await listBoards();
    return boards.find((board) => board.name === name && board.id !== exceptId) || null;
  }

  window.RefBoardStorage = {
    listBoards,
    getBoard,
    putBoard,
    deleteBoard,
    getImage,
    putImage,
    cleanupImagesForBoard,
    getPref,
    setPref,
    findNameConflict
  };
})();
