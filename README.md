# Reference Board

A lightweight local image reference board for Blender and art workflows. It runs a small Node.js server for static files and remote image import, then stores your boards in your browser with IndexedDB.

## Features

- Dark grey infinite canvas
- Middle mouse button panning
- Mouse wheel zoom
- Drag, move, and resize images
- Add images by file picker, drag and drop, clipboard paste, or remote image drag when the site/browser allows it
- Named frames with draggable/resizable bounds
- Images attach to frames when their center is inside a frame
- Moving a frame moves attached images with it
- Dragging an image out of a frame detaches it
- Browser-local board library with thumbnails
- Auto Save to IndexedDB
- Import `.refboard` files and older RefBoard `.json` files
- Export portable `.refboard` files with embedded image data
- Export the board as PNG
- Local/pasted images are stored in browser IndexedDB

## Requirements

- Node.js 18 or newer
- Windows or Linux

## Windows Setup

Open PowerShell:

```powershell
cd C:\VSCODE\ReferenceBoard
npm install
npm start
```

`npm start` launches the Electron desktop app. To run the legacy browser/server version instead:

```powershell
npm run start:web
```

Then open the browser version:

```text
http://localhost:5177
```

To use a different port:

```powershell
$env:PORT=3000
npm run start:web
```

## Linux Setup

Open a terminal:

```bash
cd /path/to/ReferenceBoard
npm install
npm start
```

Then open the browser version:

```text
http://localhost:5177
```

To use a different port:

```bash
PORT=3000 npm run start:web
```

## Controls

- Pan: hold the middle mouse button and drag
- Zoom: mouse wheel
- Add images: click **Add Image**, drag files onto the canvas, or paste with `Ctrl+V`
- Resize images or frames: select one and drag a blue transform handle
- Create frames: click **New Frame**
- Delete selected image/frame: `Delete` or `Backspace`
- Save: **Save Board** writes the current board to browser IndexedDB
- Open: shows saved local boards with thumbnails and timestamps
- Import: loads `.refboard` or older RefBoard `.json` files as unsaved copies
- Export: **Export .refboard** downloads a self-contained portable board file
- Export PNG: downloads a flattened PNG of the board contents
- Auto: toggles delayed Auto Save, which runs about 10 seconds after edits
- Rename board: double-click the board title in the top-left corner

## Project Structure

```text
ReferenceBoard/
  assets/          Backward-compatible remote image cache
  data/            Backward-compatible server save folder
  electron/        Electron main process and preload bridge
  public/
    index.html
    styles.css
    app.js
    storage.js
  package.json
  server.js
  README.md
```

## Notes

## Storage

Boards, thumbnails, preferences, and image data are stored in Chromium IndexedDB for this app/site. Auto Save is on by default and the most recently opened board is restored on startup. Large added images are downscaled to roughly a 2400px maximum side before storage when the browser can decode them.

The Electron app uses a private `app://reference-board` origin and a narrow preload API. Remote image imports are fetched by the Electron main process and cached under the user's app data directory before the renderer stores the imported image in IndexedDB. Existing browser boards from `localhost:5177` are not migrated automatically; export `.refboard` files from the browser version and import them into the desktop app.

`.refboard` exports are JSON files that embed image data so they can be imported on another machine or browser profile. Older RefBoard `.json` files can still be imported, but they open as unsaved copies.

Remote image drag/import depends on browser and source-site behavior. The server still attempts to fetch remote images so the browser can store them locally in IndexedDB; if that fails, the app falls back to the original URL where possible.

## Desktop Builds

```powershell
npm run build:win
```

Creates a Windows NSIS installer in `dist/`, plus an unpacked app folder for smoke testing.

```bash
npm run build:linux
```

Creates a Linux AppImage when run in a Linux environment. Windows builds of AppImage may require symlink privileges or Developer Mode.
