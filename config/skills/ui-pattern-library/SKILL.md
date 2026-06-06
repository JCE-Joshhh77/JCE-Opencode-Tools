---
name: ui-pattern-library
description: UI pattern catalog for frontend, dashboard, landing page, SaaS, fintech, ecommerce, developer tools, admin, marketplace, healthcare, mobile web, forms, tables, onboarding, settings, and empty states. Use when choosing product-specific interface patterns.
---

# UI Pattern Library

Katalog pola UI untuk membantu agent memilih arah desain yang terasa seperti produk nyata. Gunakan sebagai inspirasi arsitektur UI, bukan template siap copy.

## Aturan Pakai

- Pilih pola berdasarkan **domain + user job + data density + backend state**.
- Jangan pakai semua pola sekaligus.
- Jangan copy brand, aset, layout spesifik, atau CSS dari produk lain.
- Jika project sudah punya design system, katalog ini hanya referensi sekunder.

## Enterprise SaaS / Admin

**Cocok untuk:** CRM, ERP, internal tools, ops dashboard, RBAC admin.

- Layout: sidebar kiri stabil, top bar ringkas, content area dengan page header + action cluster.
- Density: medium-high; table/list sering lebih penting daripada card cantik.
- Visual: neutral surfaces, border halus, status chip, compact filters.
- State: permission denied, audit trail, bulk action, stale data, optimistic failure.
- Jangan: hero marketing, gradient, card grid kosong.

## Developer Tool

**Cocok untuk:** API platform, CLI dashboard, logs, deployments, observability.

- Layout: split pane, command palette, monospace data, timeline/log stream.
- Visual: high clarity, low ornament, strong information hierarchy.
- State: build running, failed job, retry, copied token, rate limit, webhook error.
- Microcopy: direct, technical, actionable.
- Jangan: friendly mascot berlebihan jika task technical.

## Fintech / Billing

**Cocok untuk:** payments, invoice, wallet, subscription, accounting.

- Layout: account summary + transaction timeline/table + risk/status callouts.
- Visual: trust-first; conservative color, clear currency alignment, audit metadata.
- State: pending settlement, failed payment, dispute, verification required.
- Microcopy: exact amounts, dates, next action, legal clarity.
- Jangan: playful gradients yang mengurangi trust.

## Ecommerce / Marketplace

**Cocok untuk:** product catalog, cart, merchant admin, order management.

- Layout: visual product grid untuk browse, table/timeline untuk admin ops.
- Visual: product images lead; filters visible; price/availability prominent.
- State: out of stock, variant unavailable, shipping delay, return window.
- Microcopy: concrete delivery/return/payment info.
- Jangan: fake reviews/metrics.

## Healthcare / Wellness

**Cocok untuk:** patient dashboard, appointment, medical records, habit tracking.

- Layout: calm hierarchy, priority alerts, clear next step, minimal cognitive load.
- Visual: accessible contrast, restrained color, avoid alarm fatigue.
- State: missing consent, pending lab, urgent alert, privacy warning.
- Microcopy: plain language, safety-focused, no overclaim.
- Jangan: gamified visual jika konteks klinis serius.

## AI Product

**Cocok untuk:** chat, copilots, generation tools, review assistants.

- Layout: input/result loop, source citations, confidence/status, history.
- Visual: clear provenance; show what changed and why.
- State: streaming, queued, model error, unsafe request, low confidence.
- Microcopy: transparent about limits.
- Jangan: “AI magic” hero generik dan glowing orb default.

## Landing Page Produk

**Cocok untuk:** marketing site, launch page, product homepage.

- Layout: specific hero promise, proof near top, product screenshot/context, use cases, pricing/CTA.
- Visual: one memorable motif tied to product domain.
- State: no backend heavy state, but forms need validation/success/error.
- Copy: name actual customer problem; avoid buzzword soup.
- Jangan: centered generic hero + 3 cards + gradient blobs tanpa proof.

## Data Dashboard

**Cocok untuk:** analytics, metrics, monitoring, business intelligence.

- Layout: KPI strip only if actionable; primary chart/table gets largest area.
- Visual: chart semantics > decoration; align axes, legends, units.
- State: no data, partial data, stale sync, timezone, permissions.
- Microcopy: explain metric definition and freshness.
- Jangan: fake metric cards yang tidak bisa ditindak.

## Forms / Onboarding

**Cocok untuk:** signup, setup wizard, KYC, config.

- Layout: one decision per step; progress visible only if meaningful.
- Visual: strong labels, inline validation, examples, save/resume behavior.
- State: validation, duplicate, server rejected, partial save, timeout.
- Microcopy: explain why data needed.
- Jangan: giant decorative side panel jika form panjang dan task berat.

## Settings / Preferences

**Cocok untuk:** account, team, billing, notification, API keys.

- Layout: grouped sections, destructive actions isolated, save state clear.
- Visual: compact, predictable, low novelty.
- State: unsaved changes, save success, permission, revoke/rotate, audit event.
- Jangan: hide dangerous actions near primary controls.

## Pattern Selection Output

```md
## Pattern Choice
**Domain:** ...
**Selected pattern:** ...
**Why:** ...
**Rejected patterns:** ...
**Backend states shaping UI:** ...
```
