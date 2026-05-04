# Reference Board

A lightweight local image reference board for Blender and art workflows. It runs a small Node.js server and opens in your browser at `http://localhost:<port>`.

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
- Save/load board JSON
- Local/pasted images are stored in the local `assets` folder by the server

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

Then open:

```text
http://localhost:5177
```

To use a different port:

```powershell
$env:PORT=3000
npm start
```

## Linux Setup

Open a terminal:

```bash
cd /path/to/ReferenceBoard
npm install
npm start
```

Then open:

```text
http://localhost:5177
```

To use a different port:

```bash
PORT=3000 npm start
```

## Controls

- Pan: hold the middle mouse button and drag
- Zoom: mouse wheel
- Add images: click **Add Image**, drag files onto the canvas, or paste with `Ctrl+V`
- Resize images or frames: select one and drag a blue transform handle
- Create frames: click **New Frame**
- Delete selected image/frame: `Delete` or `Backspace`
- Save: **Save JSON** downloads a JSON file and also writes `data/last-board.json`
- Load: **Load JSON** imports a JSON file
- Load Last: loads `data/last-board.json`

## Project Structure

```text
ReferenceBoard/
  assets/          Local image assets saved by the server
  data/            Last server-saved board JSON
  public/
    index.html
    styles.css
    app.js
  package.json
  server.js
  README.md
```

## Notes

Remote image drag/import depends on browser and source-site behavior. The server tries to download the remote image into `assets`; if that fails, the app falls back to using the original URL.
