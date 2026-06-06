---
name: visual-qa-rubric
description: Visual QA, screenshot review, browser review, Playwright, responsive QA, accessibility QA, UI polish, design review, visual regression, anti-AI UI rubric. Use when validating frontend visuals or reviewing screenshots.
---

# Visual QA Rubric

Gunakan untuk mengecek apakah UI layak ship secara visual, aksesibilitas, responsive, dan tidak terlihat generated AI.

## Browser/Screenshot Workflow

Jika browser tool tersedia:

1. Buka halaman target.
2. Ambil snapshot DOM/accessibility.
3. Ambil screenshot desktop.
4. Resize mobile/tablet, ambil screenshot lagi.
5. Cek console error dan request gagal.
6. Bandingkan state: loading, empty, error, success jika bisa direproduksi.
7. Tulis visual QA report dengan risiko tersisa.

Jika browser tool tidak tersedia:

- Jelaskan blocker.
- Lakukan static review dari komponen/CSS.
- Minta screenshot atau URL lokal jika perlu.

## Rubrik Skor 0-2

Skor tiap kategori:
- 0 = gagal / terlihat broken.
- 1 = cukup tapi perlu polish.
- 2 = siap ship.

Kategori wajib:

1. **Hierarchy** — primary action, title, content, metadata jelas.
2. **Spacing Rhythm** — spacing konsisten, tidak terlalu simetris/generic.
3. **Typography** — scale, weight, line-height, measure nyaman.
4. **Color/Contrast** — WCAG AA, status color tidak ambigu.
5. **Layout Density** — cocok domain, tidak terlalu kosong atau padat.
6. **Responsive** — mobile/tablet bukan desktop dipaksa mengecil.
7. **Interaction States** — hover, focus, disabled, loading, success, error.
8. **Backend Reality** — empty/error/permission/validation/pagination nyata.
9. **Anti-AI Smell** — tidak memakai pola generik tanpa alasan.
10. **Brand Fit** — terasa konsisten dengan produk existing.

Skor interpretasi:
- 18-20: ship-ready.
- 14-17: usable, polish needed.
- 10-13: risky visual quality.
- <10: redesign needed.

## Anti-AI Smell Checks

- Apakah hero/copy terlalu umum?
- Apakah card grid terlalu seragam?
- Apakah warna/gradient tidak punya makna produk?
- Apakah ikon/ilustrasi cuma filler?
- Apakah semua state memakai kalimat default?
- Apakah layout bisa dipakai di produk apa pun tanpa perubahan?

Jika “ya” untuk 2+ item, UI perlu product-specific polish.

## Output Contract

```md
## Visual QA Report
**Surface:** ...
**Evidence:** screenshot/browser/static review

| Category | Score | Finding | Fix |
|----------|-------|---------|-----|

**Total:** x/20
**Verdict:** ship-ready | polish-needed | risky | redesign-needed

## Browser Evidence
- Desktop:
- Tablet:
- Mobile:
- Console/network:

## Required Fixes
1. ...
```
