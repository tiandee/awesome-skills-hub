# Awesome Skills Hub（ASH）

> 专注管理 `~/.agents/skills` 通用用户 Skill 库。

[English](README.md) · [控制面设计](doc/SKILL_CONTROL_PLANE.md)

ASH v2 只管理一类对象：用户拥有的 Agent Skill。它负责创建、发现、审计、
打包和迁移 `~/.agents/skills`，不会再向 Cursor、Claude、Windsurf、TRAE、
Copilot、Codex 或其他客户端专属目录复制和建立软链接。

## 为什么 v2 要做减法

越来越多 Agent 工具已经共用标准 Agents Skill 目录。继续维护一层客户端软链接，
会带来大量无意义的同步告警、Bash/PowerShell 双份实现，以及用户 Skill 与系统
Skill 所有权混乱。

ASH v2 因此删除：

- Agent 检测、软链接分发、状态、清理和卸载命令；
- 项目级 `.claude/skills` 桥接；
- 项目内置 Skill 文件及其向用户库自动补充的逻辑；
- 旧 `~/.ash/skills` 自动补迁；
- Codex Store、系统 Skill、插件缓存和未知 Codex Skill 扫描迁移；
- 旧 `add`/`install` GitHub 下载器。

Agent 自带系统 Skill 和插件 Skill 继续由对应 Agent 管理。ASH 不复制、不修复、
不打包、也不迁移这些内容。

## 安装

v2 发布到 npm 后：

```bash
npm install -g askill
ash init
```

从源码安装：

```bash
git clone https://github.com/tiandee/awesome-skills-hub.git
cd awesome-skills-hub
npm install -g .
ash init
```

`ash init` 只在需要时创建 `~/.agents/skills`。ASH 不再携带任何 Skill，也不会
向用户库自动写入或覆盖 Skill 内容。

## 常用流程

```bash
# 查看用户库
ash list
ash search release
ash info delivery-loop
ash inventory
ash ui

# 创建用户 Skill
ash create review-release \
  --description "审查发布就绪度和必要证据。"

# 审计用户 Skill
ash doctor
ash doctor --verbose

# 预览并执行 Codex 引导修复
ash repair
ash repair --apply

# 打包用户 Skill
ash package delivery-loop
ash package --all
```

安装第三方用户 Skill 时，使用能直接写入标准用户库的安装器，例如：

```bash
npx skills add owner/repository
ash doctor
```

## 命令说明

| 命令 | 用途 |
| --- | --- |
| `ash init` | 在缺失时创建用户库 |
| `ash list` | 列出顶层用户 Skill |
| `ash info <name>` | 查看一个用户 Skill |
| `ash search <query>` | 搜索名称和描述 |
| `ash create <name>` | 创建 `SKILL.md` 与 `agents/openai.yaml` |
| `ash inventory` | 查看用户库和 Agents 安装锁漂移 |
| `ash doctor` | 审计元数据、用户软链接、安装锁、生成物和 Codex 创建引导 |
| `ash repair` | 预览 Codex 创建引导写入 |
| `ash rollback` | 回滚已完成的修复事务 |
| `ash package` | 创建确定性的 `.skill` 包 |
| `ash snapshot` | 创建、恢复或校验纯用户级迁移快照 |
| `ash sync` | 使用 `git pull --ff-only` 更新 ASH 源码仓库 |
| `ash ui` | 启动仅限本机回环地址访问的管理页面 |

`sync` 不是跨机器同步，也不会上传用户库；跨电脑迁移请使用 snapshot。

## 本地管理页面

```bash
ash ui
ash ui --port 4173 --no-open
```

`ash ui` 在 `127.0.0.1` 启动本地 HTTP 服务并打开管理页面。页面展示当前配置的
用户库、Skill 元数据与正文、Doctor 诊断、修复计划和最近一次可回滚事务。页面还
支持：

- 添加和移除持久化的只读扫描目录，不改动目录文件；
- 将指向同一物理 Skill 的软链接入口合并并保留全部位置，只报告同名但真实内容不同的目录；
- 在受管用户库中创建标准 Skill 脚手架；
- 通过事务化、可回滚写入修改受管 Skill 的描述；
- 将选中的 Skill 打包到配置的 packages 输出目录；
- 创建、校验并增量恢复页面受管的用户库快照；
- 展示来源覆盖率、异常来源、缺少基线与长期未更新统计；
- 将更新状态收敛为7个明确动作状态，并将错误/警告/提示作为独立健康维度展示；
- 在保护当前可回滚事务的前提下，预览并清理过期或已废弃事务；
- 为未关联来源的 Skill 自动查找 skills.sh 精确同名候选，经人工选择后通过准确 URL
  （或 GitHub 仓库与路径）接管，并为旧安装记录安全重建版本基线；
- 区分 skills.sh 接管渠道与实际 GitHub 代码上游，并提供目录页、仓库和精确
  `SKILL.md` 源码链接；
- 检查带来源锁的 GitHub Skill 更新，预览文件级差异，事务化更新单个 Skill，
  并安全回滚最近一次更新。

更新预览会明确区分：保留本地 `.env`、`.local` 与内部软链接；丢弃
`node_modules`、`__pycache__` 和内嵌 `.git` 等缓存。确认前不会删除任何内容，
完整旧目录仍保留在受保护的更新事务中供回滚。

来源统计直接由实时用户库和安装锁推导；超过180天的记录只提示、不修改。事务清理
不可回滚，因此必须先预览再确认：Repair 与 Update 历史分别保留最近10条或30天内
记录，并始终保护当前仍可安全回滚的事务。

受管用户库仍由 `library.path` 或 `ASH_SKILLS_DIR` 决定。额外扫描目录保存在
`~/.agents/.ash/state/control-plane/ui-preferences.json`，始终为只读观察模式。页面快照
保存在同一状态目录下，并且只包含受管用户库。

ASH 的生成状态统一收在既有 `~/.agents` 命名空间下，不再创建顶层 `~/.ash` 目录。

浏览器不会执行或解析 CLI 命令；本地 API 与 CLI 共同调用 `lib/control-plane`
核心模块。Repair 与 Rollback 仍然先预览再写入：页面要求明确确认，服务端重新
扫描并比较一次性计划摘要，最终继续由现有事务与文件哈希预检控制写入。服务只
允许绑定回环地址，也不会开放 CORS。
仓库同步、无来源第三方安装、直接编辑指令正文、删除和卸载仍不进入页面，因为这些操作会跨越
网络/所有权边界，或可能破坏用户内容。

## 维护优先级

本地页面和 API 是后续交互式管理功能的主要入口。v2 CLI 命令集合进入冻结状态，
仅允许为页面启动、确有必要的无界面自动化、兼容性和安全修复调整。页面新增功能
不要求同步增加一条 CLI 命令。公共业务规则仍放在 `lib/control-plane`，CLI 与
API 继续保持薄适配层。

## 把用户 Skill 迁移到另一台电脑

源电脑执行：

```bash
ash snapshot create user-skills.ash-snapshot
```

把文件复制到目标电脑，先预览再写入：

```bash
ash snapshot restore user-skills.ash-snapshot
ash snapshot restore user-skills.ash-snapshot --apply
ash snapshot verify user-skills.ash-snapshot
```

快照只包含 `~/.agents/skills` 中已有的顶层用户 Skill。顶层软链接会物化为可迁移
实体目录；`.env`、`.git`、`.local`、`node_modules`、Python 字节码和内部软链接
会排除并计数。恢复只创建缺失 Skill；相同内容保持不变；任何同名目标内容不同时，
整次写入都会拒绝。

## Doctor 和 Repair 的边界

`ash doctor` 不再检查 Skill 是否同步到任何 Agent，只检查：

- `SKILL.md` frontmatter、名称、描述、体积和重复声明；
- `~/.agents/skills` 中损坏的顶层软链接；
- `~/.agents/.skill-lock.json` 记录但本地缺失的 Skill；
- 已生成 `.skill` 包是否过期；
- 硬编码的旧 `~/.codex/skills` 路径；
- 用户 Skill 文档中仍引用的 ASH v1 废弃命令；
- `~/.codex/AGENTS.md` 中由 ASH marker 管理的创建指引。

`ash repair` 不会修改 Skill 业务指令，只会按配置维护 Codex `AGENTS.md` 中属于
ASH 的 marker 区块。修复默认 dry-run，支持事务和安全回滚。

## 配置

ASH v2 使用 `ash-control.json` schema version 2：

```json
{
  "schema_version": 2,
  "library": {
    "path": "~/.agents/skills",
    "exclude": []
  },
  "policies": {
    "codex_global_guidance": "manage"
  },
  "sources": {
    "agents_lock": "~/.agents/.skill-lock.json"
  },
  "output": {
    "state_dir": "~/.agents/.ash/state/control-plane",
    "packages": "~/.agents/.ash/packages"
  }
}
```

旧 `targets`、`codex_user_skills`、`codex_root`、`codex_store_lock` 和
`plugin_cache` 配置会明确报迁移错误，不会被静默忽略。

## 开发验证

```bash
npm test
npm pack --dry-run
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT
