#!/usr/bin/env node
/** Portable deterministic HTML -> PNG -> H.264 renderer. Node 22+, no shell commands. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptRoot, '../assets/runtime');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const TIMEOUT = 30000;
const MAX_LOG = 256 * 1024;
const activeChildren = new Set();
const HELP = `Usage: node scripts/video.mjs COMMAND ...
  doctor [PROJECT]
  still PROJECT --time SECONDS --out outputs/frame.png --width 1280 --height 720
  render PROJECT --out outputs/video.mp4 --width 1280 --height 720 --fps 30 --duration 10 [--audio audio.wav]
  probe FILE
  verify FILE [--width N --height N --fps N --duration N --frames N --audio required|forbidden|optional]
PROJECT is a local directory containing index.html. Outputs must be new files inside PROJECT.
render requires all five output/time options. duration * fps must be an integer.
still requires time, out, width, height. No command installs packages or browsers.
Environment: FFMPEG_PATH, FFPROBE_PATH, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, NODE_PATH.
`;

function fail(message) { throw new Error(message); }
function log(message) { process.stderr.write(`${message}\n`); }
function number(value, label, min, max, integer = false) {
  if (value === undefined || value === '' || !Number.isFinite(Number(value))) fail(`${label} must be a finite number.`);
  const n = Number(value);
  if (n < min || n > max || (integer && !Number.isInteger(n))) fail(`${label} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  return n;
}
function parse(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const key = arg.slice(2);
      if (!key || key in options || !argv[i + 1] || argv[i + 1].startsWith('--')) fail(`Invalid, duplicate, or valueless option ${arg}.`);
      options[key] = argv[++i];
    }
  }
  return { positional, options };
}
function allowed(options, keys) {
  for (const key of Object.keys(options)) if (!keys.includes(key)) fail(`Unknown option --${key}.`);
}
function inside(root, file) { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
async function projectDirectory(input) {
  if (!input) fail('PROJECT is required.');
  const root = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(root)).isDirectory()) fail('PROJECT must be a directory.');
  const entry = await fs.realpath(path.join(root, 'index.html'));
  if (!inside(root, entry) || !(await fs.stat(entry)).isFile()) fail('PROJECT/index.html must be a file inside PROJECT.');
  return root;
}
async function outputPath(root, input, extension) {
  if (!input) fail('--out is required.');
  const out = path.resolve(root, input);
  if (!inside(root, out) || path.extname(out).toLowerCase() !== extension) fail(`--out must be a ${extension} path inside PROJECT.`);
  const parts = path.relative(root, path.dirname(out)).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { await fs.mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (!inside(root, await fs.realpath(current)) || !(await fs.stat(current)).isDirectory()) fail('Output directory escapes PROJECT or is not a directory.');
  }
  try { await fs.lstat(out); fail(`Refusing to overwrite existing output: ${out}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return out;
}
function dimensions(options) {
  const width = number(options.width, '--width', 2, 8192, true);
  const height = number(options.height, '--height', 2, 8192, true);
  if (width % 2 || height % 2) fail('Width and height must be even for yuv420p video output.');
  return { width, height };
}
async function deadline(promise, label, milliseconds = TIMEOUT) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms.`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function run(binary, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    let stdout = '', stderr = '', spawnError;
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-MAX_LOG); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-MAX_LOG); });
    child.on('error', error => { spawnError = error; });
    const timer = setTimeout(() => { child.kill(); spawnError = new Error(`${binary} timed out.`); }, timeout);
    child.on('close', code => {
      clearTimeout(timer); activeChildren.delete(child);
      if (spawnError) reject(spawnError);
      else if (code !== 0) reject(new Error(`${binary} exited with ${code}: ${stderr.trim()}`));
      else resolve({ stdout, stderr });
    });
  });
}
function playwrightFor(root) {
  const bases = [path.join(runtimeRoot, 'package.json'), path.join(root, 'package.json'), import.meta.url];
  for (const base of bases) {
    try { return createRequire(base)('playwright'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  fail('Playwright is unavailable. Install the pinned assets/runtime/package.json dependency or provide project-local playwright. See scripts/README.md.');
}
async function launchBrowser(root) {
  const { chromium } = playwrightFor(root);
  return await chromium.launch({ headless: true, timeout: TIMEOUT, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
async function localServer(root) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const candidate = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!inside(root, candidate)) { res.writeHead(403).end(); return; }
      const file = await fs.realpath(candidate);
      if (!inside(root, file)) { res.writeHead(403).end(); return; }
      const stat = await fs.stat(file);
      if (!stat.isFile()) { res.writeHead(404).end(); return; }
      const data = req.method === 'HEAD' ? null : await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': stat.size });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function session(root, size) {
  const { server, origin } = await localServer(root);
  let browser;
  try {
    browser = await launchBrowser(root);
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin === origin || ['data:', 'blob:'].includes(target.protocol)) await route.continue();
      else { errors.push(`External request blocked: ${target.origin}${target.pathname}`); await route.abort(); }
    });
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`); });
    page.on('requestfailed', request => { if (!request.url().endsWith('/favicon.ico')) errors.push(`Request failed: ${new URL(request.url()).pathname}`); });
    await page.goto(`${origin}/index.html`, { waitUntil: 'load', timeout: TIMEOUT });
    await page.waitForFunction(() => window.READY !== undefined, undefined, { timeout: TIMEOUT });
    await deadline(page.evaluate(async () => {
      if ((await window.READY) !== true) throw new Error('window.READY must resolve to true.');
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, async img => { if (!img.complete) await img.decode(); if (!img.naturalWidth) throw new Error(`Image failed: ${img.getAttribute('src')}`); }));
      if (![window.renderAt, window.render, window.seek].some(fn => typeof fn === 'function')) throw new Error('Define window.renderAt(t), render(t), or seek(t).');
    }), 'HTML readiness');
    const check = () => { if (errors.length) fail(`Browser errors: ${errors.slice(0, 8).join('; ')}`); };
    check();
    return {
      async frame(time) {
        await deadline(page.evaluate(async t => {
          await (window.renderAt || window.render || window.seek)(t);
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, time), `renderAt(${time})`);
        check();
        const data = await page.screenshot({ type: 'png', fullPage: false, animations: 'allow', timeout: TIMEOUT });
        check();
        return data;
      },
      async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); }
    };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    throw e;
  }
}
async function still(root, options) {
  const size = dimensions(options);
  const time = number(options.time, '--time', 0, 86400);
  const out = await outputPath(root, options.out, '.png');
  const view = await session(root, size);
  try { await fs.writeFile(out, await view.frame(time), { flag: 'wx' }); }
  finally { await view.close(); }
  return { output: out, time, ...size };
}
async function render(root, options) {
  const size = dimensions(options);
  const fps = number(options.fps, '--fps', 1, 120);
  const duration = number(options.duration, '--duration', 1 / fps, 14400);
  const frames = Math.round(duration * fps);
  if (Math.abs(duration * fps - frames) > 1e-6 || frames > 1000000) fail('--duration * --fps must be an integer frame count, at most 1,000,000.');
  const out = await outputPath(root, options.out, '.mp4');
  const audio = options.audio ? await fs.realpath(path.resolve(root, options.audio)) : null;
  if (audio) {
    const media = await probe(audio, false);
    if (!media.streams?.some(s => s.codec_type === 'audio')) fail('--audio has no audio stream.');
  }
  const temporary = path.join(path.dirname(out), `.render-${randomUUID()}.partial.mp4`);
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-n', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0'];
  if (audio) args.push('-i', audio);
  args.push('-map', '0:v:0');
  if (audio) args.push('-map', '1:a:0', '-af', `apad=whole_dur=${duration},atrim=duration=${duration}`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-frames:v', String(frames), '-t', String(duration), '-r', String(fps), '-movflags', '+faststart', temporary);
  const view = await session(root, size);
  let child, finished, stderr = '', encoderError;
  try {
    child = spawn(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    activeChildren.add(child);
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-MAX_LOG); });
    child.stdin.on('error', e => { encoderError ||= e; });
    // Always consume stderr and observe completion immediately, including while stdin is backpressured.
    finished = new Promise(resolve => {
      child.once('error', e => { encoderError ||= e; });
      child.once('close', code => { activeChildren.delete(child); resolve({ code }); });
    });
    for (let frame = 0; frame < frames; frame++) {
      if (encoderError || child.exitCode !== null) fail(`Encoder closed before frame ${frame}: ${encoderError?.message || stderr}`);
      const png = await view.frame(frame / fps);
      await deadline(new Promise((resolve, reject) => {
        if (encoderError || child.exitCode !== null) { reject(encoderError || new Error(stderr)); return; }
        // The callback waits until this chunk is flushed; errors and close cannot deadlock a drain wait.
        child.stdin.write(png, error => error ? reject(error) : resolve());
      }), `Encoder write for frame ${frame}`, 60000);
      if (frame === 0 || (frame + 1) % Math.max(1, Math.round(fps)) === 0 || frame + 1 === frames) log(`Rendered ${frame + 1}/${frames} frames.`);
    }
    child.stdin.end();
    const result = await deadline(finished, 'Encoder finalization', 120000);
    if (encoderError || result.code !== 0) fail(`Encoding failed: ${encoderError?.message || stderr || `exit ${result.code}`}`);
    const verification = await verify(temporary, { ...size, fps, duration, frames, audio: audio ? 'required' : 'forbidden' });
    await fs.copyFile(temporary, out, constants.COPYFILE_EXCL);
    return { output: out, frames, duration, fps, ...size, audio: Boolean(audio), verification };
  } finally {
    if (child && child.exitCode === null) { child.stdin.destroy(); child.kill(); }
    if (finished) await deadline(finished, 'Encoder shutdown', 10000).catch(() => {});
    await view.close();
    await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') log(`Temporary cleanup failed: ${e.message}`); });
  }
}
async function probe(file, countFrames = false) {
  const args = ['-v', 'error', ...(countFrames ? ['-count_frames'] : []), '-show_streams', '-show_format', '-of', 'json', path.resolve(file)];
  const result = await run(ffprobe, args, { timeout: countFrames ? 600000 : 120000 });
  return JSON.parse(result.stdout);
}
function ratio(value) { const [a, b = 1] = String(value).split('/').map(Number); return a / b; }
async function verify(file, options) {
  const info = await probe(file, true);
  const videos = info.streams.filter(s => s.codec_type === 'video');
  const audios = info.streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1) fail('Verification requires exactly one video stream.');
  const v = videos[0], fps = ratio(v.avg_frame_rate), frames = Number(v.nb_read_frames), duration = Number(v.duration ?? info.format.duration);
  if (!v.width || !v.height || !Number.isFinite(fps) || fps <= 0 || !frames || !Number.isFinite(duration) || duration <= 0) fail('Invalid video dimensions, rate, frame count, or duration.');
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p') fail('Expected H.264 video in yuv420p format.');
  if (!String(info.format.format_name).includes('mp4')) fail('Expected an MP4 container.');
  const issues = [];
  for (const key of ['width', 'height']) if (options[key] !== undefined && v[key] !== Number(options[key])) issues.push(`${key}: expected ${options[key]}, found ${v[key]}`);
  if (options.fps !== undefined && Math.abs(fps - Number(options.fps)) > 0.001) issues.push(`fps: expected ${options.fps}, found ${fps}`);
  if (options.frames !== undefined && frames !== Number(options.frames)) issues.push(`frames: expected ${options.frames}, found ${frames}`);
  if (options.duration !== undefined && Math.abs(duration - Number(options.duration)) > Math.max(0.002, 0.1 / fps)) issues.push(`duration: expected ${options.duration}, found ${duration}`);
  const audioMode = options.audio || 'optional';
  if (!['optional', 'required', 'forbidden'].includes(audioMode)) fail('--audio must be required, forbidden, or optional.');
  if (audioMode === 'required' && audios.length === 0) issues.push('Required audio stream is missing.');
  if (audioMode === 'forbidden' && audios.length) issues.push('Unexpected audio stream.');
  if (audios.length > 1) issues.push('Expected at most one audio stream.');
  const a = audios[0];
  if (a && (!(Number(a.sample_rate) > 0) || !(a.channels > 0) || !(Number(a.duration) > 0))) issues.push('Invalid audio rate, channels, or duration.');
  if (a && Math.abs(Number(a.duration) - duration) > Math.max(0.1, 2 / fps)) issues.push('Audio and video durations differ beyond tolerance.');
  if (issues.length) fail(`Verification failed: ${issues.join('; ')}`);
  const decode = await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', a ? 'info' : 'error', '-xerror', '-i', path.resolve(file), '-map', '0:v:0', ...(a ? ['-map', '0:a:0', '-af', 'volumedetect'] : []), '-f', 'null', '-'], { timeout: 600000 });
  const peak = a ? decode.stderr.match(/max_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/)?.[1] : undefined;
  if (a && peak === undefined) fail('Audio decoded, but volume measurement was unavailable.');
  if (audioMode === 'required' && peak === '-inf') fail('Required audio is completely silent.');
  return { ok: true, width: v.width, height: v.height, fps, frames, duration, codec: v.codec_name, pixelFormat: v.pix_fmt, audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels, duration: Number(a.duration), peakDb: peak === '-inf' ? '-inf' : Number(peak) } : null, decoded: true };
}
async function doctor(root) {
  const result = { node: { version: process.versions.node, ok: Number(process.versions.node.split('.')[0]) >= 22 }, pythonRequired: false };
  for (const [key, binary] of [['ffmpeg', ffmpeg], ['ffprobe', ffprobe]]) {
    try {
      const r = await run(binary, ['-version'], { timeout: 15000 });
      result[key] = { ok: true, version: r.stdout.split(/\r?\n/)[0] };
      if (key === 'ffmpeg') {
        const encoders = await run(binary, ['-hide_banner', '-encoders'], { timeout: 15000 });
        result[key].h264Encoder = /\blibx264\b/.test(encoders.stdout);
        result[key].aacEncoder = /\baac\b/.test(encoders.stdout);
        result[key].ok = result[key].h264Encoder && result[key].aacEncoder;
      }
    }
    catch (e) { result[key] = { ok: false, error: e.message }; }
  }
  let browser;
  try { browser = await launchBrowser(root); result.browser = { ok: true, version: browser.version() }; }
  catch (e) { result.browser = { ok: false, error: e.message }; }
  finally { if (browser) await browser.close(); }
  result.ok = ['node', 'ffmpeg', 'ffprobe', 'browser'].every(key => result[key].ok);
  return result;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const child of activeChildren) child.kill(); process.exit(signal === 'SIGINT' ? 130 : 143); });
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return; }
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node.js 22 or newer is required.');
  const { positional, options } = parse(args);
  if (positional.length > 1) fail('Expected at most one PROJECT or FILE argument. Quote paths containing spaces.');
  let result;
  if (command === 'doctor') { allowed(options, []); result = await doctor(path.resolve(positional[0] || '.')); if (!result.ok) process.exitCode = 1; }
  else if (command === 'still' || command === 'render') {
    allowed(options, command === 'still' ? ['time', 'out', 'width', 'height'] : ['out', 'width', 'height', 'fps', 'duration', 'audio']);
    const root = await projectDirectory(positional[0]);
    result = command === 'still' ? await still(root, options) : await render(root, options);
  } else if (command === 'probe' || command === 'verify') {
    if (!positional[0]) fail('FILE is required.');
    allowed(options, command === 'probe' ? [] : ['width', 'height', 'fps', 'duration', 'frames', 'audio']);
    for (const key of ['width', 'height', 'fps', 'duration', 'frames']) if (options[key] !== undefined) number(options[key], `--${key}`, Number.EPSILON, 1000000, ['width', 'height', 'frames'].includes(key));
    result = command === 'probe' ? await probe(positional[0]) : await verify(positional[0], options);
  } else fail(`Unknown command: ${command}. Use help.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch(e => { log(`ERROR: ${e.message}`); process.exitCode = 1; });
