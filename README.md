# ShitRotoscope

A web app for making deliberately terrible rotoscopes: import a video or image,
scribble over it frame by frame, export the result as a looping GIF.

## Run it

```sh
npm install
npm run dev
```

Then open http://localhost:5173.

## How to use

1. **Open** a video (MP4/H.264 or WebM work best) or an image, or drag & drop it
   anywhere. For videos you pick the frames-per-second to extract (default 12 —
   low fps is the shitrotoscope way).
2. Draw over each frame with the **Pen**. Fix mistakes with the **Eraser** or
   **Undo** (⌘Z / Ctrl+Z). Use the **Previous Frame** toggle for onion-skin
   tracing, and **Face Detection** to show a face box + landmarks to trace
   against.
3. Click thumbnails on the left to jump between frames; ← / → arrows also work.
4. **Save** exports a looping GIF. Pick the background: the original video
   frames, white, or black. Single-image projects export a PNG instead.

## Notes

- Frames are downscaled to at most 720px on the long edge; imports cap at 600
  frames.
- Face overlay: MediaPipe BlazeFace full-range finds every face (including small
  or distant ones, up to 5), then the Face Landmarker draws a dense ~478-point
  mesh over each. Both models and the WASM runtime are
  bundled in `public/models/`, so everything runs locally offline.
- GIF encoding happens in the browser via `gifenc`.

## Development

```sh
npm run build      # type-check + production build
node scripts/e2e.mjs   # headless end-to-end test (needs Chrome + dev server + /tmp/srt fixtures)
```

The e2e script expects `/tmp/srt/test.mp4` (2.5s clip), `/tmp/srt/face.jpg` (one
face) and `/tmp/srt/two-1036641.jpg` (three faces); regenerate the mp4 with:

```sh
ffmpeg -f lavfi -i "testsrc=duration=2.5:size=640x480:rate=24" -pix_fmt yuv420p /tmp/srt/test.mp4
```
