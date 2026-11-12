# KudiCart Backend — Dependency & Reproducible Environment Guide

## 1. Runtime Standardization
- **Node.js:** `>=20.0.0 <23.0.0` (LTS, recommended: `v22.17.0`)
- **npm:** `>=10.0.0` (Pinned: `10.9.2`)
- **Configuration Files:** `.nvmrc`, `.node-version`, `.npmrc`, `package.json`

## 2. Port Architecture
- **Port:** `3001` (HTTP API and WebSocket at `/ws/tracking`)
- **Swagger Docs:** `http://localhost:3001/api/docs`

## 3. First-Time Setup
```bash
npm ci
npm run validate:deps
```

## 4. Normal Daily Development
```bash
npm run dev
```
Do **not** run `npm install` on normal daily startup.

## 5. Adding/Updating Dependencies
```bash
npm install <package-name>
npm run validate:deps
npm run build
git add package.json package-lock.json
git commit -m "feat(deps): add <package-name>"
```
Colleague pulls and installs via:
```bash
git pull
npm ci
```

## 6. Troubleshooting
- **EPERM DLL lock on Windows:** If `prisma generate` fails with `EPERM` during install, stop the running `npm run dev` server before reinstalling.
- **Prisma Client Generation:** Automatically executed via `"postinstall": "prisma generate"`.

