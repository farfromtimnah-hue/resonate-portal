# Contemporary Stonework — Mockup Reconciliation Manifest

**Client:** Junio Alves (Contemporary Stonework, Tampa)
**Folder:** `proposals/contemporary-stonework/mockups/`
**Reconciled:** 2026-07-05
**Naming convention:** `[phase]_[surface]_[screen]_[lang].[ext]`
**Result:** 9 files, all matched. 0 unmatched, 0 duplicates. 1 master-list screen missing (Deviation Audit).

---

## Reconciliation table

| Original file | Final filename | Phase | Surface | Screen | Lang | Master entry | Status |
|---|---|---|---|---|---|---|---|
| csw_hub_prototype3.html | p1_hub_operations_en.html | p1 | hub | operations | en | #1 Operations/Overview dashboard | READY |
| csw_dispatch_queue_builder.html | p2_dispatch_queue_builder_en.html | p2 | dispatch | queue builder | en | #2 Dispatch Queue Builder | READY |
| csw_driver_mobile2html.html | p2_driver_job_queue_pt.html | p2 | driver | job queue | pt | #3 Driver Sequential Job Queue (PT) | READY |
| csw_driver_mobile_EN.html | p2_driver_job_queue_en.html | p2 | driver | job queue | en | #3 Driver Sequential Job Queue (EN) | READY |
| Photos2.html | p2_audit_photo_en.html | p2 | audit | photo | en | #4 Photo Audit Workflow | READY |
| csw_appstore_install_screen_v2.png | p3_appstore_install_en.png | p3 | appstore | install | en | #5 App Store Install | READY |
| Phase 3 -CSW Command Widget.dc copy.html | p3_widget_home_en.html | p3 | widget | home | en | #6 Home Screen Widget | READY |
| Phase 3 csw_route_map_screen3_v3.png | p3_map_route_en.png | p3 | map | route | en | #7 GPS Breadcrumb Route Map | READY |
| csw_push_notif_stack_of_2.png | p3_push_lockscreen_en.png | p3 | push | lockscreen | en | #9 Push Notification | READY |

---

## Flag lists

### a. Unmatched files
None. Every file maps to a master-list entry.

### b. Missing mockups
- **#8 Deviation Audit (desktop)** — no file exists. Confirmed missing. The route-map screen (#7) contains a "Deviation — Sem nota" chip and a Deviations nav item, but the standalone desktop audit table (driver / job / expected vs. actual / delta / PT note chip / repeat-pattern badge) is not present.
- #4 Photo Audit — PRESENT (not missing).
- #9 Push Notification — PRESENT (not missing).

### c. Possible duplicates
None.
- Hub (#1) and Dispatch (#2) share the title "CSW Hub — Owner Triage Prototype" but are confirmed distinct screens via body diff. Both carry the corrected navy sidebar gradient.
- Photo Audit has only one copy; the rumored `csw_photo_audit.html` twin does not exist in the folder.

---

## Verification notes
- Each file matched by opening and inspecting contents, not filename.
- Driver PT confirmed via "Fila de Entregas / Parada / próxima"; Driver EN via "Delivery Queue (English) / Stop / Next".
- Photo Audit confirmed via SupplyPro pill, progress bar, "Mark Job Behind Schedule" button, driver "Adrian".
- PNGs opened visually: App Store (CSW lettermark, "Contemporary Stonework Ops", GET, carousel); Route Map (dark map, white pins, 5 stops Depot -> Riverwalk Plaza -> Harborview Estates -> Oakmont Terrace -> Yard); Push (lock screen, 2-notification stack).
- No file contents were edited. Renames only.
