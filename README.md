# Grok Imagine Archiver

Userscript para capturar, archivar y exportar automáticamente imágenes y vídeos generados en:

- https://grok.com/imagine
- https://grok.com/imagine/favorites

Incluye exportación en JSON/CSV y generación de ZIP con imágenes base64 aunque el DOM sea virtualizado.

---

## 🎯 Problema que resuelve

La página `/imagine` de Grok utiliza **virtualización del DOM**:

- Solo mantiene ~20–30 elementos visibles
- Los elementos antiguos se eliminan del DOM al hacer scroll
- Las imágenes `data:image/jpeg;base64,...` desaparecen al salir de pantalla
- No existe descarga masiva oficial
- No se pueden exportar fácilmente URLs o imágenes en lote

Esto provoca:

- Pérdida de imágenes si no se guardan manualmente
- Imposibilidad de generar un ZIP completo
- Dificultad para crear backups
- Imposibilidad de análisis posterior

Este script soluciona ese problema mediante:

- Observación del DOM (MutationObserver)
- Captura en scroll manual y automático
- Caché persistente en memoria
- Exportación estructurada
- Generación de ZIP acumulativo

---

## 🚀 Funcionalidades

### 1️⃣ Captura automática de medios

- Detecta imágenes y vídeos añadidos al DOM
- Detecta cambios de atributos (`src`, `srcset`, etc.)
- Captura elementos eliminados (anti-virtualización)
- Funciona durante scroll manual
- Funciona con botón Auto-scroll

---

### 2️⃣ Caché persistente anti-virtualización

Las imágenes `data:image/jpeg;base64,...` se almacenan en una caché interna.

Aunque desaparezcan del DOM:

- Permanecen almacenadas
- Se incluyen en el ZIP final

---

### 3️⃣ Exportación

- JSON
- CSV
- Copia de URLs al portapapeles

---

### 4️⃣ Generación de ZIP

Genera un archivo:
