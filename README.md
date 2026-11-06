# dsh-Manage deletion

> **一句话**：把用不着的会话连同它写过的文件一起安全删掉，删错了能原样恢复。

**DSH 会话删除管理**：删除不再是「归档藏起来」——真的清走，但清得可逆、清得有边界。

## 亮点

- **三个入口，随手就删**：侧栏「删除管理」页、每个会话行悬停时的小垃圾桶、页面内多选批量删。
- **删除可逆**：先进 `$DSH_HOME/manage-deletion/trash`，回收站按删除时间列出（标时间与大小），一键还原。
- **删会话，也删它自己写过的文件**：读会话日志里 `write/edit/apply_patch` 的路径，只绑该会话工作目录内的文件。
- **脚本产物也扫得到**：第三层「会话时间窗」把会话运行期间被改动的 `docx/pdf/png` 列进额外文件。
- **默认防误伤**：额外文件默认不勾；会话目录之外的路径一律不绑；运行中的会话直接拒绝。
- **置顶会话照样能删**：删除前自动取消置顶，不会在 pin 列表里留死 id。
- **打开着的会话也能删**：归档遇到活动检查时自动走 `stopActivity`，先让宿主停掉活动再归档。
- **四种语义色**：青绿=退出、琥珀金=取消选择、蓝=主操作、红=删除，一眼分清不会误点。
- **不卡**：宿主 60 秒缓存 + lean 载荷（只回 8 个字段）+ 首屏 50 行分页，736 个会话也能秒开。
- **零运行时依赖 + 45 项测试**：只用 Node 内置模块与 React，`npm run check` 一次跑完测试与清单门禁。

## 30 秒上手

1. 装插件：`dsh plugin --profile desktop add dsh-manage-deletion`（或插件市场里安装）。
2. 重启 DSH（Web 重启服务并刷新页面；Desktop 退出重开）。侧栏就会出现「删除管理」。
3. 想删单个：鼠标移到会话行 → 点右侧垃圾桶 → 确认框里点「删除」。
4. 想批量：工作区顶部点「多选」→ 勾会话（或「全选」）→「删除选中」。
5. 想扫全部：侧栏「删除管理」→「快速扫描」→ 勾选 →「删除选中」。
6. 删错了：删除管理 →「回收站」→ 勾选 →「恢复选中」。

## 删除语义（重要）

- **默认删除 = 移入插件回收站**：会话日志目录移到 `$DSH_HOME/manage-deletion/trash/<条目>/session`，并写 `index.json`；DSH 侧栏里这个会话消失。
- **「同时删除这些会话产生的文件」**：只收这些会话自己 `write/edit` 过、且位于该会话工作目录内的文件；
  对话框会逐条列出（可取消勾选），恢复时会话与文件一起还原。
  **硬边界**：不在会话 cwd 内的路径一律丢弃，工作区里其他文件不会被动到。
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
