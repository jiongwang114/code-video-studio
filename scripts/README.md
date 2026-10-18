# Portable HTML video renderer

This optional execution backend renders locally authored HTML at explicit times. It is not a video generation model or a full animation framework. Other backends can follow the same production and acceptance workflow without using this renderer.

## Requirements and installation

- Node.js 22 or newer.
- FFmpeg and FFprobe on `PATH`, including the `libx264` and `aac` encoders.
- Playwright and a compatible Chromium browser.
- No Python dependency.

From the installed skill's root directory, the following explicit setup commands install the pinned browser library and its browser. These are installation steps; `video.mjs` never performs them automatically.

```sh
npm --prefix assets/runtime ci --ignore-scripts
node assets/runtime/node_modules/playwright/cli.js install chromium
node scripts/video.mjs doctor
```

The browser download may require network access. On Linux, the Playwright browser can also require system libraries; consult the Playwright installation documentation and choose the appropriate setup for that system. Do not automatically invoke privileged installers.

Dependency resolution first tries `assets/runtime/node_modules` relative to this script, then the project's own installed `playwright`, then Node's configured module search paths. The working directory does not determine where the skill's own dependency is found. `doctor PROJECT` checks project-local dependencies when applicable.

Optional environment variables:

| Variable | Meaning |
| --- | --- |
| `FFMPEG_PATH` | FFmpeg executable or executable path; default `ffmpeg` |
| `FFPROBE_PATH` | FFprobe executable or executable path; default `ffprobe` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Explicit existing Chromium executable; otherwise use Playwright's installed browser |
| `PLAYWRIGHT_BROWSERS_PATH` | Standard Playwright browser cache location override |
| `NODE_PATH` | Standard Node module search directories, if deliberately configured |

Environment paths belong to the executing user's machine. Do not embed them in a shared project or skill. A custom Chromium version must be compatible with the installed Playwright version.

## Project and HTML protocol

`PROJECT` is a directory containing `index.html`. Put all referenced fonts, scripts, images, videos, and other assets inside that directory. The renderer serves it on a temporary loopback HTTP port and blocks requests to other origins. Prepare required external assets before rendering.

```text
my-video/
  index.html
  assets/
    font.woff2
    image.png
    final-audio.wav
  outputs/
```

The page must expose these interfaces:

```js
// May also be a Promise that resolves to exactly true after asset setup.
window.READY = true;

window.renderAt = async function (timeInSeconds) {
  // Set the ENTIRE scene from this absolute time.
  // Await asynchronous media seeks and asset updates before returning.
};
```

`window.render(t)` or `window.seek(t)` can substitute for `renderAt(t)`. `renderAt` has priority. Do not expose conflicting interfaces. Page loading, readiness, fonts, and each per-frame render have timeouts. The renderer waits for the render promise, font readiness, and two browser animation frames before taking the viewport PNG. Browser exceptions, failed asset requests, and HTTP errors fail the render.

The author must make the page deterministic:

- Derive every visual property from absolute time, rather than incrementing the previous frame's state. Test seeking backward and visiting the same time twice.
- Use seeded or precomputed randomness. Freeze simulations and evaluate them from a known state.
- Avoid wall-clock timers, autoplay, animated GIFs, continuously running CSS animations, and unpaused timelines. For GSAP, pause the timeline and seek it directly.
- Set canvas backing dimensions and camera framing to the actual output viewport. Avoid responsive layout changes during the shot.
- Bundle fonts and assets. For image/video/canvas/WebGL content, finish all asynchronous decoding or seeking inside readiness/render promises. Browser audio is not recorded.
- Mix narration, music, and effects into one final local audio file, and pass it with `--audio`.

This renderer cannot prove that authored animation obeys these rules, that the design meets its selected style, or that content is correct. Frame comparisons and human visual/audio review remain part of project acceptance. Identical pixels across different browser versions, operating systems, GPUs, or fonts are not promised; record the runtime versions with each delivery.

`assets/runtime/demo/index.html` is a small code-only protocol example. Copy it to a project directory before using it as a starting point. It is a renderer test scene, not a production style template.

## CLI

All examples assume execution from the installed skill's root. The same script can be called by its quoted absolute path from any directory; resolve the actual skill location rather than copying a machine-specific path into instructions. Quote project and file paths that contain spaces.

### Environment check

```sh
node scripts/video.mjs doctor
node scripts/video.mjs doctor ./my-video
```

Reports Node, FFmpeg encoders, FFprobe, and an actual headless browser launch as JSON. Exit `0` means all checks passed; exit `1` means a requirement is missing or unusable. The check does not install anything.

### A single frame

```sh
node scripts/video.mjs still ./my-video --time 1.5 --out outputs/frame-1.5.png --width 1280 --height 720
```

`--time`, `--out`, `--width`, and `--height` are required. Time is in seconds. Width/height must be even integers between 2 and 8192.

### Video rendering

```sh
node scripts/video.mjs render ./my-video --out outputs/video.mp4 --width 1280 --height 720 --fps 30 --duration 10
node scripts/video.mjs render ./my-video --out outputs/video-audio.mp4 --width 1280 --height 720 --fps 30 --duration 10 --audio assets/final-audio.wav
```

`--out`, `--width`, `--height`, `--fps`, and `--duration` are required. Rate may be a finite number from 1 to 120. Duration is at most 14,400 seconds. `duration * fps` must be an integer, at most 1,000,000 frames. For `N` frames, times are exactly `0/fps, 1/fps, ..., (N-1)/fps`; the end time itself is excluded.

Relative `--out` and `--audio` paths resolve against `PROJECT`. Audio may also be an explicitly supplied absolute file path. Outputs must remain inside `PROJECT`, including after symlink resolution. Existing output files are rejected. Choose a new filename for each revision.

Frames are sent as PNGs to FFmpeg through a pipe, with each write awaited and encoder stderr continuously drained. The result uses MP4/H.264, CRF 18, `yuv420p`, and fast-start metadata. Sound is encoded as 48 kHz AAC. A short audio track is padded with silence to the requested duration; a long audio track is trimmed. The renderer never uses `-shortest`, so audio length cannot truncate the video.

Rendering writes a randomly named temporary MP4 in the output directory, verifies it, then copies it exclusively to the requested new filename. A normal failure removes the temporary file and leaves the requested final path unpublished. Abrupt process or machine termination may leave a `.render-*.partial.mp4` file that can be removed after confirming that render has stopped.

The renderer automatically verifies dimensions, exact frame count, frame rate, duration, video format, expected audio presence, and full video/audio decoding. Required audio also receives a volume measurement; completely silent audio fails. A non-silent track can still contain wrong words or poor mixing, so listen to the final file.

### Inspection and acceptance

```sh
node scripts/video.mjs probe ./my-video/outputs/video-audio.mp4
node scripts/video.mjs verify ./my-video/outputs/video-audio.mp4 --width 1280 --height 720 --fps 30 --duration 10 --frames 300 --audio required
```

`probe` returns FFprobe stream/container JSON. `verify` counts decoded frames, validates MP4/H.264/`yuv420p`, decodes the entire file with FFmpeg, checks the supplied expected parameters, and reports audio sample rate, channels, duration, and peak volume when present. It rejects invalid parameters and returns a nonzero exit status on failure.

`--audio` accepts `required`, `forbidden`, or `optional` for `verify` (default `optional`). This verification setting differs from `render --audio FILE`. Audio/video duration agreement allows a tolerance of the larger of 0.1 seconds or two video frames, covering common encoding and muxing boundaries. Expected video duration tolerance is the larger of 0.002 seconds or one tenth of a frame.

Progress and errors go to stderr; successful machine-readable results go to stdout as JSON. No command executes a shell string, downloads remote resources, silently overwrites an output, or records the screen.
