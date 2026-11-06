# dsh-Manage deletion

删会话，可选择是否带上它写过的文件；删掉的进回收站，按时间还原，支持多选批量。

- 入口：侧栏「删除管理」页、会话行右侧垃圾桶、页面内多选
- 删除范围：会话日志；可选该会话工作目录内它写过的文件（对话框先列清单）
- 回收站：按删除时间列出，单条或批量还原
- 拒绝条件：会话正在跑（有活动回合）
- 会话数多时：扫描结果缓存 60 秒，首屏 50 行

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
- 置顶的会话可以删，删除前会先取消置顶。
- 正在跑（有活动回合）的会话会被拒绝，不会动它的文件；打开着但空闲的会话可以删。
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
| `manage_deletion_clean` | `mode=archive / unarchive / trash`；`trash` 可带 `deleteFiles`、`deleteExtraFiles`；必须 `confirm=true` |
| `manage_deletion_trash` | `action=list / restore / purge` |

例：「扫一下空会话和子代理残留」→ scan；「把前 10 个删掉」→ clean(mode=trash, confirm=true)。

## 实现要点

- **数据只走宿主服务**：`sessionPersistence`（快照）、`sessions`（运行中）、`workspaceRegistry`（归档/置顶/工作区）、`sessionQuery`（标题）；不解析宿主内部文件。
- **一个 POST 路由** `/manage-deletion`：`scan / info / archive / unarchive / trash / restore / purge`；信任判定委托宿主 `connection.requestRejection`，缺失时退化为 loopback Host 校验。
- **界面挂在官方插槽上**：`main`（主页面）、`sidebar.panellist`（侧栏入口）、`sidebar.session.row.leading`（勾选框）、`sidebar.workspaces.session.row.action`（行内删除/多选）、`shell.overlay`（确认弹窗与浮动多选条）。不占用 `sidebar.workspaces`——那个位置只有一个座位，占了会把工作区列表顶掉。
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
