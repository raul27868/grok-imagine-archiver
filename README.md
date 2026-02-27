# Grok Imagine Archiver

A userscript that automatically captures, archives, and exports images and videos generated on:

- https://grok.com/imagine
- https://grok.com/imagine/favorites

Includes JSON/CSV export and ZIP generation for base64 images, even when the page uses DOM virtualization.

---

## 🎯 Problem It Solves

The `/imagine` page on Grok uses **DOM virtualization**:

- Only ~20–30 items remain mounted in the DOM at a time
- Older items are removed when scrolling
- `data:image/jpeg;base64,...` images disappear when out of view
- No official bulk download exists
- No structured export option is available

This results in:

- Loss of images if not manually saved
- Inability to generate a complete ZIP archive
- No reliable backup mechanism
- Difficulty performing later analysis

This script solves these issues through:

- DOM observation (MutationObserver)
- Manual and automatic scroll capture
- Persistent in-memory caching
- Structured export
- Accumulative ZIP generation

---

## 🚀 Features

### 1️⃣ Automatic Media Capture

- Detects images and videos added to the DOM
- Detects attribute changes (`src`, `srcset`, etc.)
- Captures elements removed due to virtualization
- Works during manual scrolling
- Works with built-in Auto-scroll

---

### 2️⃣ Anti-Virtualization Cache

All `data:image/jpeg;base64,...` images are stored in an internal cache.

Even after they disappear from the DOM:

- They remain stored
- They are included in the final ZIP

---

### 3️⃣ Export Options

- JSON export
- CSV export
- Copy URLs to clipboard

---

### 4️⃣ ZIP Generation

Generates a file named:


Includes all base64 images captured during the session.

---

### 5️⃣ Available Buttons

- Export (JSON / CSV)
- Copy URLs
- Rescan
- Auto-scroll
- ZIP (data:jpeg)
- Clear
- Hide

---

## 🖥️ Compatibility

Works with:

- Firefox + Violentmonkey
- Firefox + Tampermonkey
- Chrome
- Brave
- Edge

Operating Systems:

- Ubuntu
- Windows
- macOS

Designed for desktop browsers.

Not intended for mobile browsers.

---

## 📦 Requirements

- Userscript manager:
  - Violentmonkey (recommended)
  - Tampermonkey

- Internet connection (JSZip loaded via CDN using `@require`)

---

## 🔧 Installation

### Recommended Method

1. Install Violentmonkey or Tampermonkey.
2. Open the extension dashboard.
3. Create a new script.
4. Copy the contents of:


Tampermonkey/Violentmonkey will automatically detect installation.

---

## ⚠️ Technical Notes

- Base64 images are stored in memory.
- Capturing hundreds or thousands may increase RAM usage.
- ZIP generation may take time for large collections.
- If Grok changes its DOM structure in the future, updates may be required.

---

## 🧠 How It Works

- MutationObserver monitors the main container
- Captures `addedNodes`, `removedNodes`, and attribute changes
- Throttled scroll scanning for manual scrolling
- Deduplicated cache based on base64 size and partial fingerprint
- ZIP generation via JSZip
- File download using Blob + URL.createObjectURL

---

## 📄 License

MIT License