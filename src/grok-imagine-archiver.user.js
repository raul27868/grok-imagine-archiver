// ==UserScript==
// @name         Grok Imagine - Archive media (anti-virtualization) + JSON/CSV export + ZIP base64 JPEG
// @namespace    local.grok.archive
// @version      1.4
// @description  Capture image/video URLs from grok.com/imagine (including recycled DOM/virtualization) and export JSON/CSV. Includes default filter, rescan, and ZIP for data:image/jpeg;base64 images.
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

  // Default filter tokens (comma-separated, OR logic)
  const DEFAULT_FILTER = "cdn-cgi";

  // Cache for base64 JPEGs seen over time (so virtualization doesn't lose them)
const dataJpegCache = new Map(); // key -> { base64, ts }
let dataJpegCountLastUI = 0;

function makeDataKeyFromBase64(b64) {
  // Dedup without heavy hashing: length + head/tail slices
  const head = b64.slice(0, 32);
  const tail = b64.slice(-32);
  return `${b64.length}:${head}:${tail}`;
}

function addDataJpegFromDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image/jpeg;base64,")) return false;
  const base64 = dataUrl.split(",", 2)[1] || "";
  if (!base64) return false;

  const key = makeDataKeyFromBase64(base64);
  if (dataJpegCache.has(key)) return false;

  dataJpegCache.set(key, { base64, ts: Date.now() });
  return true;
}

function collectDataJpegsFromNode(node) {
  if (!node?.querySelectorAll) return 0;
  let added = 0;
  node.querySelectorAll("img").forEach(img => {
    const src = img.currentSrc || img.src || "";
    if (addDataJpegFromDataUrl(src)) added++;
  });
  return added;
}

function updateZipButtonCounter() {
  const btn = document.getElementById("grok-arch-zip");
  if (!btn) return;

  const n = dataJpegCache.size;
  if (n === dataJpegCountLastUI) return;
  dataJpegCountLastUI = n;

  // keep base label, add count
  if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.textContent.replace(/\s*\(\d+\)\s*$/, "");
  btn.textContent = `${btn.dataset.baseLabel} (${n})`;
}




  /**
   * item = { url: string, uuid?: string, type?: "image"|"video"|"other", prompt?: string, ts?: number }
   */
  const stored = JSON.parse(localStorage.getItem(KEY) || "[]");
  const items = new Map(); // url -> item
  for (const it of stored) if (it?.url) items.set(it.url, it);

  function persist() {
    localStorage.setItem(KEY, JSON.stringify([...items.values()]));
    const st = document.getElementById(STATUS_ID);
    if (st) st.textContent = `${items.size} urls`;
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
    return /\.(png|jpe?g|webp|gif|mp4|webm)(\?|$)/i.test(url) ||
           /\/(image|images|video|videos)\b/i.test(url);
  }

  function normalizeUrl(u) {
    try {
      return new URL(u, location.href).toString(); // keep query
    } catch {
      return null;
    }
  }

  function inferType(url) {
    if (/\.(mp4|webm)(\?|$)/i.test(url)) return "video";
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
      if (v.poster) urls.add(v.poster);
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

  function addUrl(url) {
    if (!url) return false;
    if (items.has(url)) return false;

    const item = {
      url,
      uuid: extractUuid(url) || undefined,
      type: inferType(url),
      ts: Date.now()
      // prompt: (future)
    };

    items.set(url, item);
    persist();
    return true;
  }

  // Comma-separated filter tokens (OR logic)
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

  // Capture media currently visible on screen (helps when no removedNodes yet)
function captureVisibleMedia() {
  const els = document.querySelectorAll("img, video");
  for (const el of els) {
    const container = el.closest?.("article, section, div") || el;
    if (!isElementVisibleInViewport(container)) continue;

    // existing URL capture
    const urls = extractUrlsFromNode(container);
    for (const u of urls) addUrl(u);

    // NEW: base64 jpeg capture (for ZIP cache)
    collectDataJpegsFromNode(container);
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

  async function buildZipFromCachedDataJpegs({ onProgress }) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error("JSZip not loaded");
  const zip = new JSZip();

  // dataJpegCache: Map(key -> { base64, ts })
  const entries = [...dataJpegCache.values()]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));  // opcional: orden por aparición

  const total = entries.length;

  for (let i = 0; i < total; i++) {
    const { base64 } = entries[i];
    const name = `image_${String(i + 1).padStart(4, "0")}.jpg`;

    zip.file(name, base64, { base64: true });

    if (onProgress) onProgress(i + 1, total);

    // Evita congelar UI si hay muchas imágenes
    if (i % 25 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, count: total };
}



  async function buildZipFromDataJpegs({ onProgress }) {
    const JSZip = await ensureJSZip();
    const zip = new JSZip();

  // --- JSZip loader (on demand) ---
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-grok-zip="1"][src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Failed to load JSZip")));
        // If already loaded, resolve quickly
        if (window.JSZip) resolve();
        return;
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.grokZip = "1";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load JSZip"));
      document.head.appendChild(s);
    });
  }

  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
      jszipPromise = loadScriptOnce(JSZIP_CDN).then(() => {
        if (!window.JSZip) throw new Error("JSZip loaded but not available");
        return window.JSZip;
      });
    }
    return jszipPromise;
  }

  // --- ZIP: capture data:image/jpeg;base64,... in current DOM ---
  function collectBase64JpegsFromPage() {
    const out = new Map(); // base64Payload -> { dataUrl, idx }
    const imgs = document.querySelectorAll("img");

    for (const img of imgs) {
      const src = img.currentSrc || img.src || "";
      if (!src.startsWith("data:image/jpeg;base64,")) continue;

      // dedupe by base64 payload
      const payload = src.split(",", 2)[1] || "";
      if (!payload) continue;
      if (!out.has(payload)) out.set(payload, { dataUrl: src });
    }

    return [...out.values()].map(x => x.dataUrl);
  }


    const dataUrls = collectBase64JpegsFromPage();
    const total = dataUrls.length;

    for (let i = 0; i < total; i++) {
      const dataUrl = dataUrls[i];
      const base64 = dataUrl.split(",", 2)[1] || "";

      // name images sequentially
      const name = `image_${String(i + 1).padStart(4, "0")}.jpg`;

      // JSZip can take base64 directly
      zip.file(name, base64, { base64: true });

      if (onProgress) onProgress(i + 1, total);

      // yield to UI every so often to avoid freezing
      if (i % 25 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    return { blob, count: total };
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

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
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
          <button id="grok-arch-zip" style="cursor:pointer;">ZIP (data:jpeg)</button>
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

    // default filter
    const filterInput = panel.querySelector("#grok-arch-filter");
    if (filterInput && !filterInput.value) filterInput.value = DEFAULT_FILTER;

    panel.querySelector("#grok-arch-hide").onclick = () => {
      const list = panel.querySelector(`#${LIST_ID}`);
      list.style.display = (list.style.display === "none") ? "flex" : "none";
    };

    panel.querySelector("#grok-arch-clear").onclick = () => {
      items.clear();
      persist();
      panel.querySelector(`#${LIST_ID}`).innerHTML = "";
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
      const before = items.size;
      captureVisibleMedia();
      const after = items.size;

      const btn = panel.querySelector("#grok-arch-rescan");
      btn.textContent = `Rescan (+${Math.max(0, after - before)})`;
      setTimeout(() => btn.textContent = "Rescan", 1200);

      renderList(panel);
    };

    // NEW: ZIP button (data:image/jpeg;base64,...)
    panel.querySelector("#grok-arch-zip").onclick = async () => {
      const btn = panel.querySelector("#grok-arch-zip");
      const original = btn.textContent;

      try {
        btn.disabled = true;
        btn.textContent = "Scanning…";

        const { blob, count } = await buildZipFromCachedDataJpegs({
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
        downloadBlob(blob, `grok-imagine-datajpeg-${tsStamp()}.zip`);

        btn.textContent = `ZIP done (${count})`;
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
      } catch (e) {
        console.error(e);
        btn.textContent = "ZIP error";
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1600);
      }
    };

    // Auto-scroll (scroll actual scrollable container, not always window)
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
    // Heuristic: big scrollHeight + many children
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
      let changed = false;

      for (const m of mutations) {
        // IMPORTANT: capture attribute changes (DOM recycling / virtualization)
        if (m.type === "attributes" && m.target && m.target.nodeType === 1) {
          const el = m.target;
          const scope = el.closest?.("article, section, div") || el;

          const urls = extractUrlsFromNode(scope);
          for (const u of urls) if (addUrl(u)) changed = true;

          // NEW
          collectDataJpegsFromNode(scope);
          continue;
        }

        for (const node of m.removedNodes || []) {
          if (!node || node.nodeType !== 1) continue;

          const urls = extractUrlsFromNode(node);
          for (const u of urls) if (addUrl(u)) changed = true;

          // NEW
          collectDataJpegsFromNode(node);
        }

        for (const node of m.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;

          const urls = extractUrlsFromNode(node);
          for (const u of urls) if (addUrl(u)) changed = true;

          // NEW
          collectDataJpegsFromNode(node);
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

  // Capture on manual scroll too
  const onScrollCapture = throttle(() => {
    captureVisibleMedia();
    const panel = document.getElementById(ARCHIVE_ID);
    if (panel) renderList(panel);
  }, 800);

  window.addEventListener("scroll", onScrollCapture, { passive: true, capture: true });

  // Start
  startObserver();
})();