# dsh-Manage deletion

**Session deletion manager for DeepSeek Harness (DSH)**: one-click delete on every session row, multi-select batch delete per workspace, a scan page for the whole session store, and a restorable trash that also holds workspace folders.

Package `dsh-manage-deletion`, display name **dsh-Manage deletion** (npm names are lowercase-only).

## What it adds to the UI

| Where | What |
|---|---|
| Sidebar navigation (next to Plugins / Automations) | **删除管理** entry opening the manager page |
| Top of the workspace list | **Multi-select** toolbar: Select / Select all / Delete selected (N) |
| Right side of every session row (hover actions) | 🗑 quick delete button |
| Left side of every row while selecting | checkbox (select all works) |
| Global dialog | **Delete confirmation**: Delete / **Give up**, plus「Also delete workspace files」 |
| Manager page | **Quick scan** → every session, newest first, title left and time right; select all / multi-select and delete together |
| Manager page → Trash | Every deleted session with its delete time, select all / multi-select, restore, delete forever |

## Delete semantics

- **Delete = move to the plugin trash**: the session directory moves to `$DSH_HOME/manage-deletion/trash/<entry>/session` and is recorded in `index.json`; the session disappears from the DSH sidebar.
- **「Also delete workspace files」**: the session's workspace folder moves into the same trash entry and comes back on restore. It is only selectable when no other session lives in that folder — a shared workspace must not lose other conversations' files.
- **Delete forever** (from the trash) is physical and needs confirmation.
- Running and pinned sessions are refused; nothing on disk changes.
- The delete archives first through the host registry, then moves the log; a failed move rolls the archive back.

## Layout, safety, compatibility

- Host services only (`sessionPersistence`, `sessions`, `workspaceRegistry`, `sessionQuery`).
- One `POST /manage-deletion` route with `scan / info / archive / unarchive / trash / restore / purge`, trust delegated to the host `connection.requestRejection` with a loopback fallback.
- Registered on official slots: `main`, `sidebar.panellist`, `sidebar.workspaces`, `sidebar.session.row.leading`, `sidebar.workspaces.session.row.action`, `shell.overlay`.
- DSH `>=0.2.0-rc.2 <0.3.0`, Node `>=22.19`, profiles `web` + `desktop`, no runtime dependencies.

## Agent tools

`manage_deletion_scan` (read-only), `manage_deletion_clean` (`archive | unarchive | trash`, `deleteWorkspace`, `confirm=true`), `manage_deletion_trash` (`list | restore | purge`).

## Publishing and license

See [PUBLISH.md](./PUBLISH.md). MIT.
