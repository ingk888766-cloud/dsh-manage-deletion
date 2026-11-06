# 发布到 DSH 插件市场

插件市场的社区索引是 **awesome-dsh-plugin**（npm 包 `dsh-plugin-catalog`，每天构建）。收录门槛：**能用 `dsh plugin add` 装上、做到一句描述里说的事、放在对的分类、有人维护**。所以发布 = npm 上有一个能装的包 + 往索引仓库提一个 PR。

本仓库已备好：`dsh.bundle.patch`、`dsh.client`、`dsh.compatibility`、`icon`、`files`、`publishConfig`；`npm run check` 会逐项核对（44 个测试 + 清单门禁）。

## 0. 需要你本人的两样东西

| 需要 | 用途 |
|---|---|
| npm 账号（`npm login`） | 发布 `dsh-manage-deletion@1.0.0`（2026-11-06 查证：包名未被占用） |
| GitHub 账号 + 仓库 | 索引条目要链到源码仓库，评审也会看源码 |

**我不会用你的凭据代发**。你在本机执行下面的命令，或者把 token 交给我（不推荐）再代跑。

## 1. 建仓库并推源码

```bash
cd dsh-manage-deletion
git init -b main
git add -A
git commit -m "feat: dsh-Manage deletion 1.0.0"
# 在 GitHub 上建一个空仓库 dsh-manage-deletion 后：
git remote add origin git@github.com:<你的用户名>/dsh-manage-deletion.git
git push -u origin main
```

先把 `package.json` 里的仓库地址补上（现在故意留空，避免写假地址）：

```json
"repository": { "type": "git", "url": "git+https://github.com/<你的用户名>/dsh-manage-deletion.git" },
"homepage": "https://github.com/<你的用户名>/dsh-manage-deletion#readme"
```

## 2. 发布 npm 包

```bash
npm login
npm run check        # 44 个测试 + 清单门禁，必须 exit 0
npm pack --dry-run   # 看清将要发布的文件（约 15 个）
npm publish          # access=public 已在 publishConfig 里
```

## 3. 在干净 profile 里验证「装得上」

```bash
dsh plugin --profile web add dsh-manage-deletion
```

重启后：侧栏应出现「删除管理」；会话行悬停应出现垃圾桶；点开任一删除应弹确认框。三项都出现才算真装上。

## 4. 提交索引 PR

仓库：`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`

在 `README.md` 的 **Sessions & Messages** 分类按字母序加一行（描述必须与实际功能一致，评审会逐条核对）：

```markdown
- [dsh-manage-deletion](https://github.com/<你的用户名>/dsh-manage-deletion) - Session deletion manager: one-click delete on every session row, per-workspace multi-select batch delete, a full-store scan page sorted by time, and a restorable trash that also holds workspace folders (restore brings both back).
```

`README.zh.md` 同步一行中文描述。提交前读仓库里的 `contributing.md`（How submissions are reviewed）。

## 5. 让用户发现它

- dsh 0.2.1+：**插件 → 发现 → 索引源** 添加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`；
- 用 dsh-market / dsh-m 的用户会在市场里直接看到；
- `keywords` 已含 `dsh`、`dsh-plugin`、`deepseek-harness`、`session`、`delete`。

## 每次发版

1. 改 `package.json` 的 `version`，更新 `CHANGELOG.md`；
2. `npm run check && npm publish`；
3. 索引在下一次构建时带上新版本。
