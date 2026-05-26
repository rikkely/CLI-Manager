# Backend Development Guidelines

> Concrete backend contracts for Rust/Tauri code in this project.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [WebDAV Sync Contracts](./webdav-sync-contracts.md) | WebDAV sync request/response boundaries, size checks, and validation cases | Active |

---

## Pre-Development Checklist

Before modifying Rust/Tauri backend code:

- [ ] Read the relevant contract file for the affected module.
- [ ] Keep existing Tauri command signatures stable unless the task explicitly changes the contract.
- [ ] Validate external input at the Rust boundary, not only in the WebView.
- [ ] Run `cd src-tauri && cargo check` after backend changes.
