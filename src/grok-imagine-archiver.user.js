// ==UserScript==
// @name         Grok Imagine - Archive media (anti-virtualization) + JSON/CSV export + ZIP PNG + Parameters iTXt + prompt scrape fix
// @namespace    local.grok.archive
// @version      1.9.1
// @description  Capture image/video URLs from grok.com/imagine (including recycled DOM/virtualization) and export JSON/CSV. Includes default filter, rescan, go-to-top button, ZIP for captured images/videos, PNG Parameters iTXt, and auto short title from prompt.
// @match        https://grok.com/imagine*
// @match        https://grok.com/imagine/favorites*
// @run-at       document-idle
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(() => {
  'use strict';

  const ARCHIVE_ID = "grok-archive-panel";
  const LIST_ID = "grok-archive-list";
  const STATUS_ID = "grok-archive-status";
  const KEY = "grok_archive_items_v1";
  const POSITION_KEY = "grok_archive_panel_pos_v1";

  let captureEnabled = true;
  const DEFAULT_FILTER = "cdn-cgi";

  const dataImageCache = new Map();
  const videoCache = new Map();
  let dataImageCountLastUI = 0;

  const DEBUG_TEXTAREA_SCRAPE = true;

  function makeDataKeyFromDataUrl(dataUrl) {
    const head = dataUrl.slice(0, 64);
    const tail = dataUrl.slice(-64);
    return `${dataUrl.length}:${head}:${tail}`;
  }

  function normalizePromptText(txt) {
    return (txt || '').replace(/\s+/g, ' ').trim();
  }

  function slugifyTitleFromPrompt(promptText) {
    const raw = normalizePromptText(promptText)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
      .replace(/-+$/g, '');

    return raw || 'capture';
  }

  function buildZipFilename(titleText) {
    return `grok-${slugifyTitleFromPrompt(titleText)}-${tsStamp()}.zip`;
  }

  function buildParametersText(rawText) {
    const base = (rawText || "").trim();
    const now = new Date();
    const stamp = `Date: ${now.toISOString()} , Model:Grok`;
    return base ? `${base}\n${stamp}` : stamp;
  }

  function getPromptTextForMedia(mediaEl) {
    try {
      const section = mediaEl?.closest?.('div[id^="imagine-masonry-section-"]') ||
                      mediaEl?.closest?.('article, section, [data-testid], div');
      const sectionId = section?.id || '(no section id)';
      const src = mediaEl?.currentSrc || mediaEl?.src || '';
      const srcPreview = src ? `${src.slice(0, 72)}... len=${src.length}` : '(no src)';

      if (!section) {
        if (DEBUG_TEXTAREA_SCRAPE) {
          console.log('[grok.js][prompt] section not found for media:', { srcPreview });
        }
        return '';
      }

      const selectors = [
        '[data-testid*="prompt"]',
        'textarea[data-testid]',
        'textarea',
        'div.bg-surface-l1 span',
        'div[class*="bg-surface-l1"] span',
        'div.rounded-full span',
        'div.sticky span',
        '[aria-label*="prompt" i]',
        '[class*="prompt"]',
        'span'
      ];

      let raw = '';
      let chosenInfo = null;
      const candidates = [];
      const seen = new Set();

      for (const selector of selectors) {
        const nodes = [...section.querySelectorAll(selector)];
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (seen.has(node)) continue;
          seen.add(node);

          const text = normalizePromptText(node instanceof HTMLTextAreaElement ? (node.value || node.textContent) : node.textContent);
          const item = {
            selector,
            index: i,
            tag: node.tagName,
            testid: node.getAttribute?.('data-testid') || '',
            text,
            className: (node.className || '').toString().slice(0, 160)
          };
          candidates.push(item);

          if (!raw && text) {
            raw = text;
            chosenInfo = item;
          }
        }
        if (raw) break;
      }

      if (DEBUG_TEXTAREA_SCRAPE) {
        console.log('[grok.js][prompt] scrape result:', {
          sectionId,
          rawCapturedText: raw,
          chosenInfo,
          candidates,
          srcPreview,
          sectionPreview: (section.outerHTML || '').slice(0, 1200)
        });
      }

      return raw;
    } catch (err) {
      if (DEBUG_TEXTAREA_SCRAPE) {
        console.log('[grok.js][prompt] scrape error:', err);
      }
      return '';
    }
  }

  function getParametersForImg(imgEl) {
    return buildParametersText(getPromptTextForMedia(imgEl));
  }

  function getShortTitleFromCaches() {
    const mediaEntries = [
      ...videoCache.values(),
      ...dataImageCache.values(),
      ...items.values()
    ]
      .filter(entry => normalizePromptText(entry?.prompt || entry?.parameters || ''))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (!mediaEntries.length) return 'capture';

    const prompt = mediaEntries[0].prompt || mediaEntries[0].parameters || '';
    return slugifyTitleFromPrompt(prompt);
  }

  function isSupportedDataImageUrl(src) {
    return /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(src || "");
  }

  function addDataImageFromImg(imgEl) {
    if (!imgEl) return false;
    const src = imgEl.currentSrc || imgEl.src || "";
    if (!isSupportedDataImageUrl(src)) return false;

    const key = makeDataKeyFromDataUrl(src);
    const prompt = getPromptTextForMedia(imgEl);
    const params = buildParametersText(prompt);
    const mimeMatch = src.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,/i);
    const mime = (mimeMatch?.[1] || "image/png").toLowerCase();

    if (dataImageCache.has(key)) {
      const entry = dataImageCache.get(key);
      if (entry && (!entry.parameters || entry.parameters.trim().length === 0) && params) {
        entry.parameters = params;
      }
      if (entry && (!entry.prompt || entry.prompt.trim().length === 0) && prompt) {
        entry.prompt = prompt;
      }
      return false;
    }

    dataImageCache.set(key, { dataUrl: src, mime, ts: Date.now(), prompt, parameters: params });
    return true;
  }

  function isSupportedVideoUrl(src) {
    return /\.(?:mp4|webm|mov|m4v)(?:\?|$)/i.test(src || '') || /\/videos?\b/i.test(src || '');
  }

  function addVideoFromEl(videoEl) {
    if (!videoEl) return false;
    const src = videoEl.currentSrc || videoEl.src || videoEl.querySelector?.('source')?.src || '';
    if (!src || !isSupportedVideoUrl(src)) return false;

    const url = normalizeUrl(src);
    if (!url) return false;

    const prompt = getPromptTextForMedia(videoEl);

    if (videoCache.has(url)) {
      const entry = videoCache.get(url);
      if (entry && (!entry.prompt || entry.prompt.trim().length === 0) && prompt) {
        entry.prompt = prompt;
      }
      if (entry && !entry.videoEl && videoEl) {
        entry.videoEl = videoEl;
      }
      return false;
    }

    videoCache.set(url, { url, ts: Date.now(), prompt, type: 'video', videoEl });
    return true;
  }

  function collectDataImagesFromNode(node) {
    if (!captureEnabled) return 0;
    if (!node?.querySelectorAll) return 0;
    let added = 0;
    node.querySelectorAll("img").forEach(img => {
      if (addDataImageFromImg(img)) added++;
    });
    node.querySelectorAll("video").forEach(video => {
      if (addVideoFromEl(video)) added++;
    });
    if (node.matches?.("video") && addVideoFromEl(node)) added++;
    if (node.matches?.("img") && addDataImageFromImg(node)) added++;
    return added;
  }

  function updateZipButtonCounter(force = false) {
    const btn = document.getElementById("grok-arch-zip");
    if (!btn) return;

    const n = dataImageCache.size + videoCache.size;
    if (!force && n === dataImageCountLastUI) return;
    dataImageCountLastUI = n;

    if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.textContent.replace(/\s*\(\d+\)\s*$/, "");
    btn.textContent = `${btn.dataset.baseLabel} (${n})`;
  }

  function tsStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `grok-imagine-archive-${tsStamp()}.json`);
  }

  function csvEscape(v) {
    const s = (v ?? "").toString();
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportCSV(data) {
    const header = ["uuid","type","ts","prompt","url"];
    const lines = [header.join(",")];

    for (const it of data) {
      lines.push([
        csvEscape(it.uuid || ""),
        csvEscape(it.type || ""),
        csvEscape(it.ts || ""),
        csvEscape(it.prompt || ""),
        csvEscape(it.url || "")
      ].join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `grok-imagine-archive-${tsStamp()}.csv`);
  }

  function looksLikeMediaUrl(url) {
    return /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)(\?|$)/i.test(url) ||
           /\/(image|images|video|videos)\b/i.test(url);
  }

  function normalizeUrl(u) {
    try {
      return new URL(u, location.href).toString();
    } catch {
      return null;
    }
  }

  function inferType(url) {
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return "video";
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return "image";
    return "other";
  }

  function extractUuid(url) {
    const m = url.match(/\/images\/([0-9a-f-]{36})\./i);
    return m ? m[1] : "";
  }

  function extractUrlsFromNode(node) {
    const urls = new Set();
    if (!node) return [];

    node.querySelectorAll?.("img").forEach(img => {
      if (img.currentSrc) urls.add(img.currentSrc);
      if (img.src) urls.add(img.src);
      const srcset = img.getAttribute?.("srcset");
      if (srcset) srcset.split(",").map(s => s.trim().split(" ")[0]).forEach(x => x && urls.add(x));
    });

    node.querySelectorAll?.("video").forEach(v => {
      if (v.currentSrc) urls.add(v.currentSrc);
      if (v.src) urls.add(v.src);
      v.querySelectorAll("source").forEach(s => s.src && urls.add(s.src));
    });

    node.querySelectorAll?.("a[href]").forEach(a => urls.add(a.href));

    node.querySelectorAll?.("[data-src],[data-url],[data-href]").forEach(el => {
      ["data-src","data-url","data-href"].forEach(k => {
        const v = el.getAttribute(k);
        if (v) urls.add(v);
      });
    });

    return [...urls]
      .map(normalizeUrl)
      .filter(Boolean)
      .filter(looksLikeMediaUrl);
  }

  const stored = JSON.parse(localStorage.getItem(KEY) || "[]");
  const items = new Map();
  for (const it of stored) if (it?.url) items.set(it.url, it);

  function persist() {
    localStorage.setItem(KEY, JSON.stringify([...items.values()]));
    const st = document.getElementById(STATUS_ID);
    if (st) st.textContent = `${items.size} urls`;
  }

  function addUrl(url, contextEl = null) {
    if (!captureEnabled) return false;
    if (!url) return false;
    if (items.has(url)) return false;

    const item = {
      url,
      uuid: extractUuid(url) || undefined,
      type: inferType(url),
      ts: Date.now(),
      prompt: getPromptTextForMedia(contextEl) || undefined
    };

    items.set(url, item);
    persist();
    return true;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xEDB88320 & mask);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function uint32ToBytes(n) {
    return new Uint8Array([
      (n >>> 24) & 0xFF,
      (n >>> 16) & 0xFF,
      (n >>> 8) & 0xFF,
      n & 0xFF
    ]);
  }

  function concatUint8Arrays(arrays) {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
      out.set(arr, offset);
      offset += arr.length;
    }
    return out;
  }

  function makePngChunk(type, dataBytes) {
    const enc = new TextEncoder();
    const typeBytes = enc.encode(type);
    const lengthBytes = uint32ToBytes(dataBytes.length);
    const crcBytes = uint32ToBytes(crc32(concatUint8Arrays([typeBytes, dataBytes])));
    return concatUint8Arrays([lengthBytes, typeBytes, dataBytes, crcBytes]);
  }

  function makeITXtChunk(keyword, text) {
    const enc = new TextEncoder();
    const keywordBytes = enc.encode(keyword);
    const textBytes = enc.encode(text);
    const nul = new Uint8Array([0]);

    const payload = concatUint8Arrays([
      keywordBytes,
      nul,
      new Uint8Array([0]),
      new Uint8Array([0]),
      nul,
      nul,
      textBytes
    ]);

    return makePngChunk("iTXt", payload);
  }

  function injectITXtIntoPngBytes(pngBytes, keyword, text) {
    const pngSigLength = 8;
    const typeDecoder = new TextDecoder("latin1");
    let offset = pngSigLength;
    let insertAt = -1;
    let iendStart = -1;

    while (offset + 12 <= pngBytes.length) {
      const length =
        (pngBytes[offset] << 24) |
        (pngBytes[offset + 1] << 16) |
        (pngBytes[offset + 2] << 8) |
        pngBytes[offset + 3];

      const typeStart = offset + 4;
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const crcEnd = dataEnd + 4;
      if (crcEnd > pngBytes.length) throw new Error("Invalid PNG structure");

      const chunkType = typeDecoder.decode(pngBytes.slice(typeStart, typeStart + 4));

      if (chunkType === "IDAT" && insertAt === -1) insertAt = offset;
      if (chunkType === "IEND") {
        iendStart = offset;
        break;
      }

      offset = crcEnd;
    }

    if (iendStart === -1) throw new Error("IEND chunk not found");
    if (insertAt === -1) insertAt = iendStart;

    const before = pngBytes.slice(0, insertAt);
    const after = pngBytes.slice(insertAt);
    const metaChunk = makeITXtChunk(keyword, text);

    return concatUint8Arrays([before, metaChunk, after]);
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(res => res.blob());
  }

  function blobToUint8Array(blob) {
    return blob.arrayBuffer().then(buf => new Uint8Array(buf));
  }

  function uint8ArrayToBlob(bytes, mime = "image/png") {
    return new Blob([bytes], { type: mime });
  }

  async function renderDataUrlToPngBlob(dataUrl) {
    const srcBlob = await dataUrlToBlob(dataUrl);

    const bitmap = await createImageBitmap(srcBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("PNG conversion failed"));
      }, "image/png");
    });

    return pngBlob;
  }

  async function convertDataImageToPngWithParameters(dataUrl, parametersText) {
    const pngBlob = await renderDataUrlToPngBlob(dataUrl);
    const pngBytes = await blobToUint8Array(pngBlob);
    const outBytes = injectITXtIntoPngBytes(pngBytes, "Parameters", parametersText || "");
    return uint8ArrayToBlob(outBytes, "image/png");
  }

  function throttle(fn, waitMs) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const remaining = waitMs - (now - last);
      if (remaining <= 0) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...args);
        }, remaining);
      }
    };
  }

  function getFilterTokens(panel) {
    const raw = (panel.querySelector("#grok-arch-filter")?.value || "").trim().toLowerCase();
    if (!raw) return [];
    return raw.split(",").map(t => t.trim()).filter(Boolean);
  }

  function matchesFilter(url, tokens) {
    if (!tokens || tokens.length === 0) return true;
    const u = url.toLowerCase();
    return tokens.some(t => u.includes(t));
  }

  function isElementVisibleInViewport(el) {
    if (!el || el.nodeType !== 1) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect) return false;
    if (rect.width <= 1 && rect.height <= 1) return false;

    return rect.bottom >= 0 &&
           rect.right >= 0 &&
           rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
           rect.left <= (window.innerWidth || document.documentElement.clientWidth);
  }

  function captureVisibleMedia() {
    const els = document.querySelectorAll("img, video");
    for (const el of els) {
      const container = el.closest?.("article, section, div") || el;
      if (!isElementVisibleInViewport(container)) continue;

      const urls = extractUrlsFromNode(container);
      for (const u of urls) addUrl(u, container);

      collectDataImagesFromNode(container);
    }

    updateZipButtonCounter();
  }

  function renderList(panel) {
    const list = panel.querySelector(`#${LIST_ID}`);
    if (!list) return;

    const tokens = getFilterTokens(panel);
    const data = [...items.values()].filter(it => matchesFilter(it.url, tokens));

    list.innerHTML = "";

    data
      .slice()
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .forEach(it => {
        const url = it.url;

        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:8px;align-items:center;word-break:break-all;";

        const thumb = document.createElement("div");
        thumb.style.cssText = "flex:0 0 64px;height:40px;background:#222;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;";

        if (it.type === "video") {
          thumb.textContent = "🎬";
        } else if (it.type === "image") {
          const img = document.createElement("img");
          img.src = url;
          img.loading = "lazy";
          img.style.cssText = "width:100%;height:100%;object-fit:cover;";
          thumb.appendChild(img);
        } else {
          thumb.textContent = "🔗";
        }

        const link = document.createElement("a");
        link.href = url;
        link.textContent = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.style.cssText = "color:#9ecbff;text-decoration:none;flex:1;";

        const del = document.createElement("button");
        del.textContent = "x";
        del.style.cssText = "cursor:pointer;padding:4px 7px;border-radius:8px;";
        del.onclick = () => {
          items.delete(url);
          persist();
          renderList(panel);
        };

        row.appendChild(thumb);
        row.appendChild(link);
        row.appendChild(del);
        list.appendChild(row);
      });
  }

  async function fetchMediaBlob(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      mode: 'cors',
      cache: 'default',
      referrer: location.href,
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: {
        'Accept': 'video/*,application/octet-stream,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }

    return res.blob();
  }

  function fetchMediaBlobXHR(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.withCredentials = true;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          resolve(xhr.response);
        } else {
          reject(new Error(`XHR failed: ${xhr.status} ${xhr.statusText || ''}`));
        }
      };

      xhr.onerror = () => reject(new Error('XHR network error'));
      xhr.onabort = () => reject(new Error('XHR aborted'));

      try {
        xhr.send();
      } catch (err) {
        reject(err);
      }
    });
  }

  async function fetchVideoBlobWithFallback(url) {
    try {
      return await fetchMediaBlob(url);
    } catch (err1) {
      console.warn('[grok.js][video] fetch failed, trying XHR fallback:', url, err1);
      return fetchMediaBlobXHR(url);
    }
  }

  async function buildZipFromCapturedMedia({ onProgress }) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded");

    const zip = new JSZip();

    const imageEntries = [...dataImageCache.values()]
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map((entry, idx) => ({ kind: 'image', idx, entry }));

    const videoEntries = [...videoCache.values()]
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .map((entry, idx) => ({ kind: 'video', idx, entry }));

    const entries = [...imageEntries, ...videoEntries]
      .sort((a, b) => ((a.entry.ts || 0) - (b.entry.ts || 0)));

    const total = entries.length;

    for (let i = 0; i < total; i++) {
      const current = entries[i];

      if (current.kind === 'image') {
        const { dataUrl, parameters } = current.entry;
        const pngBlob = await convertDataImageToPngWithParameters(dataUrl, parameters || '');
        const name = `image_${String(current.idx + 1).padStart(4, '0')}.png`;
        zip.file(name, pngBlob);
      } else {
        const { url } = current.entry;
        const blob = await fetchVideoBlobWithFallback(url);
        const extMatch = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
        const ext = (extMatch?.[1] || 'mp4').toLowerCase();
        const name = `video_${String(current.idx + 1).padStart(4, '0')}.${ext}`;
        zip.file(name, blob);
      }

      if (onProgress) onProgress(i + 1, total);

      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    return { blob, count: total, title: getShortTitleFromCaches() };
  }

  function ensurePanel() {
    let panel = document.getElementById(ARCHIVE_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = ARCHIVE_ID;
    panel.style.cssText = `
      position: fixed; right: 12px; bottom: 12px; z-index: 999999;
      width: 620px; max-height: 55vh; overflow: hidden;
      background: rgba(0,0,0,0.88); color: #fff; padding: 10px;
      border-radius: 12px; font: 12px/1.35 system-ui;
      box-shadow: 0 8px 30px rgba(0,0,0,0.45);
    `;

    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        panel.style.left = `${saved.left}px`;
        panel.style.top = `${saved.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
    } catch {}

    panel.innerHTML = `
      <div id="grok-arch-dragbar" title="Drag to move" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;user-select:none;">
        <div style="display:flex;align-items:center;gap:10px;">
          <b>Archive</b>
          <span id="${STATUS_ID}" style="opacity:.8">${items.size} urls</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <label style="display:flex;align-items:center;gap:6px;opacity:.9">
            <span>Export:</span>
            <select id="grok-arch-exportfmt" style="cursor:pointer;">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <button id="grok-arch-export" style="cursor:pointer;">Export</button>
          <button id="grok-arch-copy" style="cursor:pointer;">Copy URLs</button>
          <button id="grok-arch-rescan" style="cursor:pointer;">Rescan</button>
          <button id="grok-arch-zip" style="cursor:pointer;">ZIP (media)</button>
          <button id="grok-arch-top" style="cursor:pointer;">Top</button>
          <button id="grok-arch-scroll" style="cursor:pointer;">Auto-scroll</button>
          <button id="grok-arch-clear" style="cursor:pointer;">Clear</button>
          <button id="grok-arch-hide" style="cursor:pointer;">Hide</button>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <input id="grok-arch-filter"
               placeholder="filter (comma-separated, OR): cdn-cgi, mp4, webm..."
               style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;" />
      </div>
      <div id="${LIST_ID}" style="margin-top:8px;max-height:43vh;overflow:auto;display:flex;flex-direction:column;gap:6px;"></div>
    `;

    panel.querySelectorAll("button, select").forEach(el => {
      el.style.cssText += `
        padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.15);
        background: rgba(255,255,255,.06); color: #fff;
      `;
    });

    document.body.appendChild(panel);

    const dragBar = panel.querySelector("#grok-arch-dragbar");
    if (dragBar) {
      let dragging = false;
      let startX = 0, startY = 0;
      let startLeft = 0, startTop = 0;

      const onMove = (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        const nextLeft = Math.max(0, Math.min(window.innerWidth - 40, startLeft + dx));
        const nextTop  = Math.max(0, Math.min(window.innerHeight - 40, startTop + dy));

        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);

        const left = parseFloat(panel.style.left) || 0;
        const top = parseFloat(panel.style.top) || 0;
        try { localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top })); } catch {}
      };

      dragBar.addEventListener("mousedown", (ev) => {
        if (ev.target?.closest?.("button,select,input,textarea,a")) return;

        const rect = panel.getBoundingClientRect();
        dragging = true;
        startX = ev.clientX;
        startY = ev.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        panel.style.left = `${startLeft}px`;
        panel.style.top = `${startTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mouseup", onUp, true);

        ev.preventDefault();
      }, true);
    }

    const filterInput = panel.querySelector("#grok-arch-filter");
    if (filterInput && !filterInput.value) filterInput.value = DEFAULT_FILTER;

    panel.querySelector("#grok-arch-hide").onclick = () => {
      const list = panel.querySelector(`#${LIST_ID}`);
      list.style.display = (list.style.display === "none") ? "flex" : "none";
    };

    panel.querySelector("#grok-arch-clear").onclick = () => {
      items.clear();
      try { localStorage.removeItem(KEY); } catch {}
      persist();

      dataImageCache.clear();
      videoCache.clear();
      dataImageCountLastUI = -1;
      updateZipButtonCounter(true);

      const list = panel.querySelector(`#${LIST_ID}`);
      if (list) list.innerHTML = "";
      renderList(panel);

      captureEnabled = false;
    };

    panel.querySelector("#grok-arch-top").onclick = () => {
      const el = getScrollableEl();

      if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        el.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    panel.querySelector("#grok-arch-copy").onclick = async () => {
      try {
        const txt = [...items.values()].map(x => x.url).join("\n");
        await navigator.clipboard.writeText(txt);
        const btn = panel.querySelector("#grok-arch-copy");
        btn.textContent = "Copied";
        setTimeout(() => btn.textContent = "Copy URLs", 900);
      } catch {
        alert("Clipboard blocked by browser permissions.");
      }
    };

    panel.querySelector("#grok-arch-rescan").onclick = () => {
      captureEnabled = true;
      const before = items.size;
      captureVisibleMedia();
      const after = items.size;

      const btn = panel.querySelector("#grok-arch-rescan");
      btn.textContent = `Rescan (+${Math.max(0, after - before)})`;
      setTimeout(() => btn.textContent = "Rescan", 1200);

      renderList(panel);
    };

    panel.querySelector("#grok-arch-zip").onclick = async () => {
      const btn = panel.querySelector("#grok-arch-zip");
      const original = btn.textContent;

      try {
        btn.disabled = true;
        btn.textContent = "Scanning…";

        const { blob, count, title } = await buildZipFromCapturedMedia({
          onProgress: (done, total) => {
            btn.textContent = `ZIP ${done}/${total}`;
          }
        });

        if (count === 0) {
          btn.textContent = "ZIP (0 found)";
          setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
          return;
        }

        btn.textContent = "Downloading…";
        downloadBlob(blob, buildZipFilename(title));

        btn.textContent = `ZIP done (${count})`;
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
      } catch (e) {
        console.error(e);
        btn.textContent = "ZIP error";
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1600);
      }
    };

    let scrollTimer = null;

    function getScrollableEl() {
      const main = document.querySelector("main, [role='main']");
      const candidates = [
        main,
        document.scrollingElement,
        document.documentElement,
        document.body,
        ...document.querySelectorAll("div")
      ].filter(Boolean);

      return candidates.find(el => {
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        const canScroll = (oy === "auto" || oy === "scroll" || oy === "overlay");
        return canScroll && el.scrollHeight > el.clientHeight + 50;
      }) || document.scrollingElement || document.documentElement;
    }

    panel.querySelector("#grok-arch-scroll").onclick = () => {
      const btn = panel.querySelector("#grok-arch-scroll");
      if (scrollTimer) {
        clearInterval(scrollTimer);
        scrollTimer = null;
        btn.textContent = "Auto-scroll";
        return;
      }
      btn.textContent = "Stop";
      scrollTimer = setInterval(() => {
        const el = getScrollableEl();
        const step = Math.round((el.clientHeight || window.innerHeight) * 0.75);

        if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
          window.scrollBy(0, step);
        } else {
          el.scrollTop += step;
        }

        captureVisibleMedia();
        renderList(panel);
      }, 900);
    };

    panel.querySelector("#grok-arch-export").onclick = () => {
      const fmt = panel.querySelector("#grok-arch-exportfmt").value;
      const data = [...items.values()];
      if (fmt === "json") exportJSON(data);
      else exportCSV(data);
    };

    panel.querySelector("#grok-arch-filter").oninput = () => renderList(panel);

    renderList(panel);
    return panel;
  }

  function pickBestContainer() {
    const candidates = [...document.querySelectorAll("main, [role='main'], body, div")]
      .filter(el => el && el.nodeType === 1)
      .map(el => ({
        el,
        score:
          Math.min(el.childElementCount, 500) +
          Math.min(el.scrollHeight / 1000, 500) +
          (el === document.body ? 50 : 0)
      }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.el || document.body;
  }

  function startObserver() {
    const panel = ensurePanel();
    const target = pickBestContainer();

    const observer = new MutationObserver(mutations => {
      if (!captureEnabled) return;
      let changed = false;

      for (const m of mutations) {
        if (m.type === "attributes" && m.target && m.target.nodeType === 1) {
          const el = m.target;
          const scope = el.closest?.("article, section, div") || el;

          const urls = extractUrlsFromNode(scope);
          for (const u of urls) if (addUrl(u, scope)) changed = true;

          collectDataImagesFromNode(scope);
          continue;
        }

        for (const node of m.removedNodes || []) {
          if (!node || node.nodeType !== 1) continue;

          const urls = extractUrlsFromNode(node);
          for (const u of urls) if (addUrl(u, node)) changed = true;

          collectDataImagesFromNode(node);
        }

        for (const node of m.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;

          const urls = extractUrlsFromNode(node);
          for (const u of urls) if (addUrl(u, node)) changed = true;

          collectDataImagesFromNode(node);
        }
      }

      if (changed) renderList(panel);
      updateZipButtonCounter();
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "href", "srcset", "poster", "data-src", "data-url", "data-href"]
    });

    console.log("[Grok archive] observing:", target);

    captureVisibleMedia();
    renderList(panel);
  }

  const onScrollCapture = throttle(() => {
    if (!captureEnabled) return;
    captureVisibleMedia();
    const panel = document.getElementById(ARCHIVE_ID);
    if (panel) renderList(panel);
  }, 800);

  window.addEventListener("scroll", onScrollCapture, { passive: true, capture: true });

  startObserver();
})();