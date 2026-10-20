# Chennai Fiber Price Comparator — Milestone 1

New Node.js backend using Steel.dev to fetch live page content from official Chennai sources for Airtel Xstream Fiber, Tata Play Fiber, and BSNL Bharat Fiber.

## Design rule
`POST /api/compare` calls Steel for all three providers on every request. SQLite stores scrape logs only (timestamps, source URLs, status, duration, errors). It is never used as a price cache. This milestone returns raw Markdown; we will inspect real page content before writing provider-specific parsers, to avoid reporting old or location-inapplicable prices as current.

## Requirements
- Node.js 20+ (Node.js 22 LTS recommended)
- npm
- Steel API key from https://app.steel.dev/settings/api-keys

## Windows PowerShell setup
```powershell
cd .\chennai-fiber-price-comparator
npm install
Copy-Item .env.example .env
notepad .env
# Put your Steel API key in .env, save, and close Notepad.
npm run dev
```
Keep `.env` private. Never commit it or expose the key to a frontend.

## Test in a second PowerShell window
```powershell
Invoke-RestMethod http://localhost:5000/health
Invoke-RestMethod http://localhost:5000/api/providers
Invoke-RestMethod -Method Post http://localhost:5000/api/compare | ConvertTo-Json -Depth 8
Invoke-RestMethod http://localhost:5000/api/logs
```

## Endpoints
- `GET /health` — health check
- `GET /api/providers` — configured official source URLs
- `POST /api/compare` — fresh scrape of all three sources
- `GET /api/logs?limit=50` — recent SQLite scrape logs

## Sources
- Airtel Chennai: https://www.airtel.in/plans/broadband/chennai/
- Tata Play Fiber Chennai: https://www.tataplayfiber.com/broadband-plans/chennai
- BSNL Chennai Telephones: https://www.chennai.bsnl.co.in/

BSNL's current plan source must be verified. Older PDFs may describe expired plans, so do not treat them as current without checking their validity.

## Next milestone
Inspect each scraped response and implement provider-specific extraction for plan name, monthly price, GST treatment, speed, FUP/data limit, post-FUP speed, OTT benefits, duration, offer conditions, source URL, and retrieval timestamp. If a source fails, return unavailable rather than displaying an old price.
