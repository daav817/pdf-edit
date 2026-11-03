# CLAUDE.md — pdf-edit

Guidance for Claude Code working in this folder. Read this first; README.md has
the user-facing summary and API table.

## What this is

Energia Power LLC's in-house PDF tool: an Adobe Acrobat replacement for
**Energia staff only** (never customers). It combines three older projects,
which stay untouched in `C:\Users\daav8\projects\` until staff confirm
pdf-edit replaces them:

- `pdf-viewer` — React/PDF.js editor (this client started as a copy of it)
- `pdf-redact` — redaction
- `pdf-split` — splitting

All new PDF-tool work happens **here**, not in those folders.

Living plan (phases, checklist): Claude Doc "pdf-edit — Combined PDF Tool Plan",
https://claude.ai/artifact/FSGHPStw6t7yoEZgZGYBLy — tick its Phase 1/2/3 items
as they land.

## Decisions already made (do not re-litigate)

- **Python server** (FastAPI + PyMuPDF). The old Node export server was rewritten.
- **PyMuPDF (AGPL) is accepted** because the tool is internal only. Phase 3's
  customer-facing signing service must NOT use PyMuPDF (use pyHanko/pypdf) so
  AGPL never reaches customers.
- **Sign-in reuses energia-app accounts**: energia-app issues HS256 JWTs; this
  server verifies them with the same `JWT_SECRET` and stores no passwords.
- **Runs in the home lab** k3s cluster, LAN only (no Cloudflare tunnel route).
  The user is buying battery backup for router and servers.
- **Not a Word-style editor.** Text editing is "change words in place on the PDF".
- **E-signature (Phase 3)** will be built in-house to replace SignWell, which
  is paid for until then; Energia staff prepare documents, customers sign via
  a public link.

## Working with this user

- Explain in plain language; the user reads results, not code. Lead with what
  changed and whether it works.
- **Ask before anything outward-facing or hard to undo**: pushing images to
  GHCR, `kubectl apply`, deleting files, git commits and pushes. Git: local
  repo on `main` (since 2026-11-03), no remote yet; ask before adding one.
- The laptop is often **short on memory** (15.6 GB, frequently <2 GB free;
  Brave, Claude, Docker/WSL are the big users). Claude Code may kill
  background dev servers under memory pressure. If that happens, report it
  and only restart when asked. Check free memory before heavy work (docker
  builds) with:
  `Get-CimInstance Win32_OperatingSystem` (FreePhysicalMemory).
- UI preferences the user has stated:
  - Toolbar must never wrap or need scrolling (checked at 1366 and 1280 px wide).
  - Tool buttons (Edit text, Copy region, Paste, Draw field, Redact) are
    **icon-only with a tooltip showing the exact button name** (`ToolButton.tsx`).
  - ☰ menu (top right) holds Import, Save as, Print, Sign out.
  - **Every drawing tool switches off after one use**; the user clicks the
    button again for another. Copy region does not auto-arm Paste.
  - No big hint text inside boxes; hints go in the fixed context bar.
  - Thin plus-sign cursor in all tool modes.
  - Hatching: **red** for redaction marks, **blue** for Draw field boxes;
    applied redactions are **black**.
  - Close file prompts if there are unsaved changes.
  - "View edited file" opens the app's own viewer (`viewer.html`), never Adobe.

## Layout

```
pdf-edit/
├─ package.json          root scripts (setup/dev/test/build), concurrently
├─ Dockerfile            node:22-alpine builds client → python:3.13-slim runtime (+tesseract)
├─ .dockerignore
├─ k8s/                  deployment.yaml, service.yaml, ingress.yaml, kustomization.yaml
├─ client/               React 19 + Vite + pdfjs-dist 4.10 + pdf-lib
│  ├─ index.html         editor
│  ├─ viewer.html        stand-alone preview viewer (second Vite entry)
│  ├─ vite.config.ts     /api proxied to :8750; multi-page build (main + viewer)
│  └─ src/
│     ├─ App.tsx                 state, toolbar, tool modes, save/preview/print, undo
│     ├─ PdfViewer.tsx           page render (cancellable), overlays, plus cursor
│     ├─ usePagePointerDrag.ts   drag handling for tool modes
│     ├─ pageDrawHandlers.ts     what each drag does; returns true when a tool was used
│     ├─ FieldDomLayer.tsx       gold text-edit boxes (move, edit) + Draw field boxes
│     ├─ ResizableField.tsx      Draw field / pasted region boxes
│     ├─ RedactionLayer.tsx      red redaction marks
│     ├─ textExtract.ts          PDF.js text → gold box (lines, spacing, blocks)
│     ├─ textStyle.ts            fonts, font metrics, FIRST_BASELINE_EM
│     ├─ savePdf.ts              build edited PDF (pdf-lib); download/preview
│     ├─ redact.ts               server API calls (redact, search, text removal)
│     ├─ useUndoRedo.ts          history with merge keys
│     ├─ ToolButton.tsx          icon buttons + portal tooltips + inline SVG icons
│     ├─ MainMenu.tsx, CloseFileDialog.tsx, AuthGate.tsx
│     ├─ types.ts                FormField, TextEdit, RedactRegion, helpers
│     └─ viewer/viewer.ts,.css   preview viewer page
└─ server/
   ├─ dev.py                    uvicorn on 127.0.0.1:8750 with reload; AUTH_DISABLED=1 unless JWT_SECRET set
   ├─ requirements.txt / requirements-dev.txt
   ├─ app/
   │  ├─ main.py      routes; serves client/dist (STATIC_DIR) with SPA fallback
   │  ├─ auth.py      JWT verify, login proxy to energia-app, session cookie
   │  ├─ coords.py    NormRect ⇄ PyMuPDF coordinates
   │  ├─ redact.py    search + permanent redaction (text, pixels, line art, annots, TOC, metadata)
   │  ├─ textedit.py  remove original words under edited text
   │  ├─ pages.py     split (zip), merge, organize
   │  └─ export.py    txt/docx/html/md/json/rtf with Tesseract OCR fallback
   └─ tests/          pytest (44 tests): conftest, test_redact, test_api, test_textedit
```

## Commands (Windows; root folder)

```bash
npm run setup   # once: root + client packages, server/.venv with dev requirements
npm run dev     # screen http://localhost:5173, API http://localhost:8750
npm test        # server pytest
npm run build   # client → client/dist (needed before testing the prod server/image)
cd client && npx tsc --noEmit -p .   # client type check (run after every client change)
```

Without `JWT_SECRET`, dev skips sign-in. For real sign-in set `JWT_SECRET`
(same as energia-app) and `ENERGIA_APP_URL`.

Production-like local run without Vite: `npm run build`, then
`cd server && AUTH_DISABLED=1 .venv/Scripts/python -m uvicorn app.main:app --port 8751`
(serves the built screen and API together).

## Core design rules (keep these true)

**Coordinates.** The client works in fractions (0..1) of the *visible* page
(rotation applied, CropBox) exactly as PDF.js shows it. The server converts with
`coords.to_page_rect` (`page.rect` + `page.derotation_matrix`). Page numbers are
1-based in the client, 0-based on the wire (`redact.ts` converts).

**Text edits (gold boxes) must look the same on screen and in the saved file.**
- `textExtract.ts`: an item's box top = baseline − 1.05·fontSize, height
  1.35·fontSize; `item.width` from PDF.js is already in page units (don't
  multiply by font size). Lines are grouped by y; wide gaps become spaces;
  indents become leading spaces; line spacing (`lineHeight`) is the median
  baseline gap ÷ font size. A selection is split into **blocks** (font size
  change >15% or gap >2.2× size), one gold box each.
- Save (`savePdf.ts`) draws line 1's baseline at `FIRST_BASELINE_EM` (1.05)
  font sizes below the box top, at the box's exact left edge, stepping
  `size × lineHeight`.
- Screen (`FieldDomLayer.tsx`) offsets the textarea by
  `firstLineOffsetEm(family, lineHeight)` (uses measured browser font
  ascent/descent) so CSS baselines land in the same place. The gold outline is a
  `box-shadow` (outside the box) so it doesn't push text inward. Change one side
  → change the other.
- Moving a box stores `origin` (where it started). Screen and save keep a white
  cover over `origin`; a moved box counts as modified (`isTextMoved`).
- **Save removes the original words** first: `buildAnnotatedPdf` sends every
  changed edit's box (and `origin`) to `POST /api/text/remove`, then draws with
  pdf-lib. Server (`textedit.py`) deletes only characters whose *centre* is in
  an area, via shrunken per-character redaction marks, text only (images and
  drawings kept), then rewrites the file (`garbage=4, clean=True`). If the
  server call fails, Save/Preview/Print fail with a message — never silently
  fall back to cover-only.

**Redaction** (`redact.py`) is the "remove for good" tool: black fill, removes
text, image pixels, touched line art, overlapping comments/fields, comments or
fields mentioning removed text, matching bookmarks, metadata/XMP; full rewrite.
Applying is undoable in the client until the file is closed (the `file` is part
of undo state). Draw field "cover" only paints over content — not redaction.

**Undo** (`useUndoRedo.ts`): history is recorded outside React updaters (StrictMode
safe). `undoMergeKey` in App.tsx makes quick runs of the *same kind* of change
on the same item (typing in box X, moving box X) one step; adding/removing
items or switching typing→moving starts a new step.

**Tools switch off after one use**: `finishPageDrag` returns `true` when it did
something; `PdfViewer` then calls `onToolUsed` → `App.handleToolUsed` clears all
modes. Selecting text with Edit text puts the caret in the new box.

**Preview** ("View edited file"): opens `/viewer.html` synchronously (pop-up
blockers), builds the same bytes as Save, then sets the viewer's hash to
`#src=<blob url>&name=...`. Unapplied redaction marks are not in the preview
(status message says so).

**pdf.js rendering**: renders are cancellable (`RenderHandle`) — StrictMode
double-render otherwise throws "Cannot use the same canvas during multiple
render()".

## Testing

- Server: `npm test` (pytest, uses `AUTH_DISABLED=1` TestClient). Add tests for
  any server change; redaction/text removal tests check text is unsearchable
  and neighbours survive (tight 1.15 line spacing, rotated pages).
- Client: type check + browser tests with **playwright-core** driving the
  installed Chromium at
  `%LOCALAPPDATA%\ms-playwright\chromium-1140\chrome-win\chrome.exe`
  against http://localhost:5173 (or :8751 / a container). Test scripts live in
  the session scratchpad, not the repo. Typical checks: screenshot crops of
  gold boxes vs. original, pixel bounds comparison, toolbar
  `scrollWidth <= clientWidth`, saved PDF inspected with PyMuPDF
  (`get_text`, `search_for`).
- Test PDFs are generated with pdf-lib (Helvetica, letter size).

## Deploy (needs the user's explicit go-ahead)

Image: `ghcr.io/daav817/pdf-edit` (built and verified locally 2026-10-29 with
pod-like settings: uid 10001, read-only root FS, tmpfs /tmp, 1 GiB limit;
~124 MiB at rest; image 818 MB).

```bash
docker build -t ghcr.io/daav817/pdf-edit:latest .
docker push ghcr.io/daav817/pdf-edit:latest     # needs GHCR login with write:packages
kubectl apply -k k8s
```

- Cluster already has `ghcr-pull-secret` and `energia-secrets` (JWT_SECRET) used
  by energia-app; sign-in calls `http://energia.default.svc.cluster.local`.
- Ingress: Traefik `websecure`, host `pdf.192.168.1.243.nip.io` (LAN only),
  currently Traefik's default certificate (browser warning).
- Recommended before/at deploy: versioned image tags (not only `latest`), and a
  trusted HTTPS certificate (also required to install pdf-edit as a PWA).
- Plaintext secrets exist in the separate `home lab/kubernetes/*.txt` files; the
  user was advised to rotate them. Never copy their values anywhere.

## Status (as of 2026-11-03)

Phase 1 done:
- Server: redact (areas, words, patterns), split, merge, organize, export
  with OCR, energia-app sign-in.
- Editor: Edit text with exact placement, movable boxes, true removal of the old
  words on save, Redact with undo, Draw field, Copy/Paste region, undo/redo,
  close prompt, View edited file viewer, icon toolbar.
- Docker image + k8s manifests, verified in a container.

Phase 1 open:
1. **Split / Merge / Organize screens** in the client (server endpoints exist).
2. **Push image and deploy** to the home lab (waiting on user's go-ahead).
3. Retire the old projects once staff confirm.

Later / offered:
- **Phase 2**: fill in existing PDF form fields (user wants it; may move up).
- **Default PDF app on Windows**: add a web app manifest with `file_handlers` +
  `launchQueue` in the viewer, install from Brave, set as default for `.pdf`.
  Needs the app served from localhost or trusted HTTPS. Not started.
- **Phase 3**: in-house e-signature replacing SignWell (customer-facing, no
  PyMuPDF there).

Known limits:
- Edited text uses only Helvetica / Times / Courier (no original font, no bold).
- Text removal does not touch the document title/bookmarks (Redact does).
- Draw field "cover" boxes only paint over.
- pdf-lib draws in MediaBox space while the client uses the visible (CropBox,
  rotated) page; edits on rotated/cropped pages have not been tested.
- The main client chunk is ~690 kB (Vite warns); fine for LAN use.

## Gotchas

- **Port 8750 busy / API not reloading**: old `dev.py` processes from earlier
  sessions can keep running and stop reloading. Find them with
  `Get-NetTCPConnection -LocalPort 5173,8750 -State Listen`; stop only with the
  user's OK, then `npm run dev`.
- Shell: Git Bash heredocs containing some quote patterns fail on this machine;
  for multi-line patch scripts write a `.py` file and run it.
- Cookie name `pdfedit_session`; `COOKIE_SECURE=1` in the cluster.
- `client/dist` is served by FastAPI in production; rebuild after client
  changes before testing the prod server or image.
