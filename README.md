# PDF Edit

Energia's in-house PDF tool: edit, permanently redact, split, merge and organize
PDFs (and JPG/PNG images), and export their text. It replaces pdf-viewer,
pdf-redact and pdf-split. Staff sign in with their energia-app account.

Plan and phases: the "pdf-edit — Combined PDF Tool Plan" doc.

## Layout

- `client/` — React + PDF.js screen (Vite), started from pdf-viewer
- `server/` — FastAPI + PyMuPDF API; in production it also serves the built screen
- `k8s/` — Deployment, Service and Ingress for the home-lab k3s cluster
- `Dockerfile` — one image: builds the screen, runs the API on port 8000

PDFs are processed in memory for one request and never stored.

## Local development (Windows)

```bash
npm run setup   # once: installs client packages and the Python venv
npm run dev     # screen on http://localhost:5173, API on :8750
npm test        # server tests
```

`npm run dev` skips sign-in unless `JWT_SECRET` is set. To test real sign-in,
set `JWT_SECRET` (same value as energia-app) and `ENERGIA_APP_URL` (e.g.
`http://localhost:3000`) before starting.

## API

| Method | Path | Does |
| --- | --- | --- |
| POST | `/api/redact` | Permanently removes `regions` (fractions of the visible page), `terms` and `patterns` |
| POST | `/api/redact/search` | Finds `terms` / `patterns` and returns them as regions to review |
| GET | `/api/redact/patterns` | Pattern list (SSN, phone, email, long numbers) |
| POST | `/api/text/remove` | Deletes the original words in `regions` before edited text is drawn (Save uses it) |
| POST | `/api/split` | `parts` [{name, pages: [0-based…]}] or [{name, start, end}] (inclusive) → one part: PDF, several: ZIP |
| POST | `/api/merge` | Several `files` → one PDF |
| POST | `/api/organize` | `pages` [{source, rotate}] → reorder, rotate, delete, extract |
| POST | `/api/export` | Text as `txt`, `docx`, `html`, `md`, `json` or `rtf` (OCR for scanned pages) |
| POST | `/api/auth/login` | Signs in through energia-app, sets the session cookie |

Interactive docs: `/docs` on the running server.

## Redaction

Redaction deletes the text, image pixels and drawings under each area, removes
comments and form fields that are under it or mention removed text, drops
matching bookmarks, clears document info and XMP metadata, and rewrites the
whole file so no older copies remain. `server/tests/test_redact.py` checks each
of these, including rotated and cropped pages.

**Draw field → Cover content** only paints over content; it is not redaction.

## Deploy

```bash
docker build -t ghcr.io/daav817/pdf-edit:latest .
docker push ghcr.io/daav817/pdf-edit:latest
kubectl apply -k k8s
```

The Deployment reads `JWT_SECRET` from the existing `energia-secrets` secret and
signs in through the `energia` service. It is reachable on the home network at
`https://pdf.192.168.1.243.nip.io`; no Cloudflare tunnel route points to it.
