---
title: Pelham Hills Homepage Refactor
date: 2026-09-04
area: web
status: completed
tags:
  - pelham-hills
  - frontend
  - playwright
---

# Pelham Hills Homepage Refactor

## Summary

Refactored the `frontend` home page into a Pelham Hills Golf Club landing experience based on the current public site content: 18-hole golf, Pelham Hills Pub, indoor golf simulators, contact details, and operating hours.

## Changes

- Replaced the previous BEPU-oriented home screen with a golf club homepage.
- Added locally stored generated bitmap assets for the hero and course section to avoid runtime dependency on external image hosts.
- Updated metadata and document language to match Pelham Hills content.
- Removed unsupported Next 16 config keys from `next.config.mjs`.
- Added a Playwright verification script that checks desktop and mobile rendering, primary CTA visibility, visit-section visibility, console errors, and saves screenshots.
- Updated the booking CTA flow to open an internal `/booking` program instead of linking out.
- Implemented a Tee-Sniper-inspired booking workspace using the source model from `https://github.com/stebennett/tee-sniper`: one-shot requests, recurring requests, time windows, players, partners, SMS notification, request status controls, and attempt history.
- Implemented an internal `/admin` operations console based on the Tee-Sniper admin concerns: queue monitoring, status controls, worker-run simulation, partner roster management, system configuration summary, and audit log.
- Implemented an internal `/teesheet` operator screen modeled after a Chronogolf/pelhamhills tee sheet: side navigation, weather/date/reservation summary, week grid, colored reservation bars, selected booking details, player cards, check-in/payment controls, and add-guest slot.
- Updated `/admin` to render the Tee Sheet operator layout directly, matching the admin URL pattern shown in the reference screenshot.
- Added FastAPI Tee Sheet endpoints under `/api/v1/tee-sheet/*` using the Tee-Sniper-style operational model: bookings, players, status updates, cancellation reason, audit log, and worker simulation.
- Connected the Tee Sheet UI to the FastAPI service when available, with local sample fallback when the API is offline.
- Split front-desk actions so `Cancel Reservation`, `Save`, player `Check In`, player `No Show`, and player `Collect/Paid` are distinct controls.
- Used parallel subagents to implement menu modules across disjoint frontend routes: `/pricing`, `/customers`, `/promotions`, `/reports`, and `/settings`.
- Added remaining admin menu MVP routes from the orchestration layer: `/dynamic-pricing`, `/events`, `/tour-operators`, `/business-intelligence`, `/radar`, and `/integrations`.
- Added a shared admin feature page component for lighter operational modules.
- Connected admin side navigation across implemented menu routes.
- Imported the visible Chronogolf Tee Sheet data for Thursday, September 10, 2026 into the refactored web app.
- Updated Tee Sheet bookings, player cards, cart counts, customer records, and the Thursday 18-hole rate to match the captured operating data. Confirmed visible rate: `$47.79`.
- Replaced the old sample September 5 bookings in both the frontend fallback data and FastAPI seed data with September 10 reservations.
- Added the currently visible Chronogolf Tee Sheet data for Friday, September 11, 2026, including visible booking groups, cart counts, visible member rate plans, and the displayed `$58.41` rate.
- Updated the Tee Sheet model with a `date` field so imported bookings from multiple visible days can coexist in the same weekly grid.

## Verification

- `npm run build` passed.
- `node scripts\verify-homepage.mjs` passed.
- Playwright verifies that the `Book Now` CTA opens `/booking`.
- Playwright creates a wanted tee-time request in `/booking`, verifies the created request, marks it booked, and saves `frontend/playwright-booking.png`.
- Playwright opens `/admin`, runs the worker simulation, adds a partner, verifies the admin log and roster update, and saves `frontend/playwright-admin.png`.
- Playwright opens `/teesheet`, verifies the seeded reservation grid, triggers the selected booking save/payment state, and saves `frontend/playwright-teesheet.png`.
- Verified FastAPI directly with REST calls for listing bookings, cancelling a booking with reason, and adding a player.
- Playwright now verifies the implemented admin menu routes render: pricing, dynamic pricing, events, customers, tour operators, promotions, reports, business intelligence, radar, integrations, and settings.
- `python -m py_compile backend\api\routes\tee_sheet.py backend\main.py` passed after the September 10 data update.
- `npm run build` passed after the September 10 data update.
- `node scripts\verify-homepage.mjs` passed after updating the verification target to the imported September 10 reservation.
- `node scripts\verify-homepage.mjs` passed after adding September 11 visible-screen data and duplicate-name handling.
- Playwright screenshots created:
  - `frontend/playwright-desktop.png`
  - `frontend/playwright-mobile.png`

## Notes

- `npm run lint` still reports pre-existing errors in chat and onboarding files outside this homepage refactor scope.
- `npm install -D @playwright/test` reported existing package audit findings: 12 vulnerabilities.
