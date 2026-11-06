# Changelog

## [1.0.0] — 2026-11-06

Renamed from `dsh-session-janitor` to **dsh-Manage deletion** (`dsh-manage-deletion`)
and rebuilt the UI around the sidebar, as asked.

### Added

- **侧栏「删除管理」入口**（`sidebar.panellist` + `main` 面板）：点开即删除管理页。
- **会话行快捷删除**（`sidebar.workspaces.session.row.action`）：每个会话右侧垃圾桶按钮。
- **删除确认弹窗**（`shell.overlay`）：删除 / 放弃删除，可勾选「同时删除工作区文件」；
  共享工作区禁用该勾选并说明原因。
- **工作区顶部多选工具栏**（`sidebar.workspaces`）：多选 / 全选 / 删除选中 (N)。
- **多选勾选框**（`sidebar.session.row.leading`）：勾多少删多少。
- **删除管理页**：快速扫描全部会话，按时间倒序、标题在左时间在右；全选/多选统一删除。
- **回收站页**：按删除时间列出所有已删会话，标出时间与大小，支持全选/多选恢复、彻底删除。
- **工作区文件一起进回收站**：仅当该工作区没有其他会话时可用；恢复时一并还原。
- `manage_deletion_scan` / `manage_deletion_clean`（含 `deleteWorkspace`）/ `manage_deletion_trash` 三个 Agent 工具。
- 路由 `POST /manage-deletion`：`scan / info / archive / unarchive / trash / restore / purge`。

### Changed

- 回收站目录改为 `$DSH_HOME/manage-deletion/trash`。
- 工具名从 `session_janitor_*` 改为 `manage_deletion_*`。
- 测试 44 项（分类、文件搬运、服务、入口/路由、客户端渲染）。

## [0.1.0] — 2026-11-06

First release as `dsh-session-janitor`（已在 1.0.0 中更名）：扫描空会话/测试标题/子代理残留/孤儿会话，
归档或移入回收站，含设置页与三个工具。
