# AURA GROW — Full-stack scaffold

This repository contains a simple full-stack app (Node.js + Express backend and a pure HTML/CSS/JS frontend) to monitor air quality, save readings and get AI-driven plant recommendations.

Folders:
- backend/ — Express server, data storage
- frontend/ — static HTML/CSS/JS pages

Quick start (backend)
1. Open a terminal to `backend` folder:

```powershell
cd c:\Users\Amant\Desktop\AURA GROW\AURA-GROW\backend
npm install
```

2. Copy `.env.example` to `.env` and set values (OpenAI and OpenWeatherMap API keys, JWT secret):

```powershell
copy .env.example .env
# then edit .env with your keys
```

3. Start server:

```powershell
npm run dev
# or
npm start
```

Backend exposes:
- POST /api/signup
- POST /api/login
- GET /api/pollution?lat=...&lon=...
- GET /api/latest
- GET /api/history
- GET /api/weather?lat=...&lon=...
- POST /api/ai-plants (protected) — requires Authorization: Bearer <token>

Frontend
Open the `frontend` files in a browser (e.g., open `frontend/index.html`). The frontend calls the backend at http://localhost:3000 — ensure the backend is running and CORS is allowed.

Notes
- This scaffold stores users and readings in JSON files under `backend/data/`.
- For production use, replace JSON storage with a proper database and secure your keys.
- The AI integration uses OpenAI Responses API; ensure `OPENAI_API_KEY` is set in `.env`.

