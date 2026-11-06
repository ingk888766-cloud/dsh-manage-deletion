# dsh-Manage deletion

**DSH 会话删除管理插件**：会话行上的一键删除、工作区多选批量删、全会话扫描统一清理，删除一律进可恢复的回收站（会话 + 工作区文件都能还原）。

包名 `dsh-manage-deletion`，界面名 **dsh-Manage deletion**（npm 包名只能小写）。

## 它在你看到的界面上加了什么

| 位置 | 加的东西 |
|---|---|
| 侧栏导航（新会话 / 插件 / 自动化任务 那一列） | **删除管理** 入口，点开就是删除管理页 |
| 工作区列表顶部 | **多选** 工具栏：多选 / 全选 / 删除选中 (N) |
| 每个会话行右侧（悬停快捷区） | 🗑 **快捷删除按钮** |
| 多选模式下每个会话行左侧 | 勾选框（勾多少就删多少，全选可用） |
| 全局弹窗 | **删除确认框**：删除 / **放弃删除**，可勾选「同时删除工作区文件」 |
| 删除管理页 | **快速扫描** → 按时间倒序列出全部会话（标题在左、时间在右），全选/多选统一删除 |
| 删除管理页 → 回收站 | 列出所有已删除会话（按删除时间排列、标出时间），支持恢复、全选/多选恢复、彻底删除 |

## 30 秒上手

1. 装插件：`dsh plugin --profile desktop add dsh-manage-deletion`（或插件市场里安装）。
2. 重启 DSH（Web 重启服务并刷新页面；Desktop 退出重开）。侧栏就会出现「删除管理」。
3. 想删单个：鼠标移到会话行 → 点右侧垃圾桶 → 确认框里点「删除」。
4. 想批量：工作区顶部点「多选」→ 勾会话（或「全选」）→「删除选中」。
5. 想扫全部：侧栏「删除管理」→「快速扫描」→ 勾选 →「删除选中」。
6. 删错了：删除管理 →「回收站」→ 勾选 →「恢复选中」。

## 删除语义（重要）

- **默认删除 = 移入插件回收站**：会话日志目录移到 `$DSH_HOME/manage-deletion/trash/<条目>/session`，并写 `index.json`；DSH 侧栏里这个会话消失。
- **「同时删除工作区文件」**：把会话所在的工作区文件夹一起移到回收站同一条目里，恢复时一起还原。
  **只有该工作区里没有别的会话时才可选**——共享工作区里删一个会话不该带走别人的文件，所以勾选框会禁用并说明原因。
- **彻底删除**（回收站里）：物理删除日志与工作区副本，不可恢复，需要二次确认。
- 运行中的会话、置顶会话：拒绝删除（按钮会报错，不会动文件）。
- 删除前会先走宿主 `workspaceRegistry.archiveSession()` 归档，再移动日志；移动失败会把归档回滚，不会留下「看不见但还在」的会话。

## 配置

插件不导出 schemastery schema（保证 `file:` 链接装与 npm 装行为一致、零运行时依赖）。在 composition 条目里加参数：

```yaml
- id: manage-deletion
  name: 'dsh-manage-deletion'
  config:
    blankMaxBytes: 1200     # 扫描时的空会话上限
    tinyMaxBytes: 20480     # 很小且很久没动
    oldDays: 30
    threshold: 20
    includeSubagents: true
    titleResolveLimit: 200  # 一次扫描最多折叠多少个标题
    listLimit: 1000
    maxBatch: 50            # 单次删除上限
    trashDir: ''            # 空 = $DSH_HOME/manage-deletion/trash
```

## Agent 工具

| 工具 | 作用 |
|---|---|
| `manage_deletion_scan` | 只读扫描：统计、候选（含判定依据）、回收站状态 |
| `manage_deletion_clean` | `mode=archive / unarchive / trash`；`trash` 可带 `deleteWorkspace`；必须 `confirm=true` |
| `manage_deletion_trash` | `action=list / restore / purge` |

例：「扫一下空会话和子代理残留」→ scan；「把前 10 个删掉」→ clean(mode=trash, confirm=true)。

## 实现要点

- **数据只走宿主服务**：`sessionPersistence`（快照）、`sessions`（运行中）、`workspaceRegistry`（归档/置顶/工作区）、`sessionQuery`（标题）；不解析宿主内部文件。
- **一个 POST 路由** `/manage-deletion`：`scan / info / archive / unarchive / trash / restore / purge`；信任判定委托宿主 `connection.requestRejection`，缺失时退化为 loopback Host 校验。
- **界面挂在官方插槽上**：`main`（主页面）、`sidebar.panellist`（侧栏入口）、`sidebar.workspaces`（多选工具栏）、`sidebar.session.row.leading`（勾选框）、`sidebar.workspaces.session.row.action`（快捷删除）、`shell.overlay`（确认弹窗）。
- **并发保护**：同一时刻只允许一个删除/恢复操作。
- 运行时依赖：**无**（Node 内置模块 + React）。

## 兼容性

- DSH `>=0.2.0-rc.2 <0.3.0`（在 `0.2.2-rc.1` 上开发与实测）
- Node `>=22.19`
- profile：`web`、`desktop`

## 发布到插件市场

见 [PUBLISH.md](./PUBLISH.md)：npm publish → 干净 profile 里 `dsh plugin add` 验证 → 向 awesome-dsh-plugin 提 PR（Sessions & Messages 分类）。

## 开发

```bash
npm run check    # 语法检查 + 44 个单元/集成测试
npm test
npm pack --dry-run
```

## 许可证

MIT
