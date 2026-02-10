---
name: publish-to-wechat
description: Use this skill when the user wants to publish Markdown content to WeChat Official Account (微信公众号). Automates the entire pipeline: content adaptation, AI image generation, format conversion, and browser-assisted publishing.
license: MIT
---

# 微信公众号发布技能

## Overview

本技能实现从 Markdown 源文件到微信公众号发布的**端到端自动化流水线**。AI 收到指令后，自动完成草稿改写、配图生成、格式转换等全部步骤。

## 触发方式

当用户发出以下任一指令时，自动触发完整发布流程：

- `"把 [文件路径] 发到公众号"`
- `"发布 [文件路径] 到微信公众号"`
- 同时引用一个 Markdown 文件 + 本 SKILL.md

**AI 收到触发后，按以下 Pipeline 自动执行所有步骤。**

## 自动化 Pipeline

```
源文件 → Step 1: 草稿生成 → Step 2: 配图生成 → Step 3: 格式转换 → Step 4: 发布准备
```

---

## Step 1: 草稿生成

### 输出规范

| 项目 | 规范 |
|:---|:---|
| **草稿路径** | `docs/weichat/[slug]/Draft.md` |
| **图片目录** | `docs/weichat/[slug]/images/` |
| **slug 命名** | 英文短横线格式，基于文章主题，如 `ash-introduction`、`openclaw-memory` |

### 内容改写指引

从源文档转换为公众号风格时，遵循以下规则：

**必须处理：**

1. **移除不兼容元素**：GitHub 徽章（badge）、相对路径图片、CI/CD 链接
2. **调整标题层级**：正文从 `###` 开始（h3），因为公众号的文章标题占用了 h1
3. **替换外链图片**：将外链图片替换为本地生成的配图，或使用已上传到图床的 URL
4. **精简代码块**：只保留最核心的 2-3 个代码示例，移动端长代码体验差

**风格调整：**

1. **语气转换**：从技术文档风 → 技术博客风（更口语化，可加入"我们"等第一人称）
2. **篇幅控制**：1500-3000 字（移动端最佳阅读长度，约 5-10 分钟）
3. **结构优化**：采用"痛点引入 → 方案解析 → 核心亮点 → 快速上手"的结构
4. **添加 Emoji**：章节标题适当添加 emoji 增加阅读趣味
5. **强化金句**：每个章节末尾用 **加粗** 总结一句核心观点

### 标题 & 摘要自动生成

在 Draft.md 顶部生成以下内容：

```markdown
---
标题备选：
  1. [直接型标题]
  2. [痛点型标题]
  3. [吸引型标题]
摘要: [120字以内的文章摘要，用于公众号分享时显示]
---
```

**标题风格参考：**

| 风格 | 示例 |
|:---|:---|
| **直接型** | ASH — AI IDE 界的"Homebrew" |
| **痛点型** | 还在为每个IDE重复配置AI技能？一键搞定！ |
| **吸引型** | 装一次技能，8个AI IDE同步，这个工具太香了 |

> ⚠️ 公众号标题限制 **64 字符**，务必精简。

---

## Step 2: 配图生成

使用 `generate_image` 工具根据文章内容自动生成封面图和正文配图。

### 封面图

| 类型 | 尺寸 | 比例 | 说明 |
|:---|:---|:---|:---|
| **首图封面** | 900 × 383 | 2.35:1 | 必须，显示在消息列表和文章顶部 |
| **次图封面** | 200 × 200 | 1:1 | 可选，多图文时使用 |

**Prompt 模板：**

```
A modern tech blog cover image for a WeChat article about [文章主题].
Design: [根据内容选择视觉元素].
Color palette: [选择与主题匹配的配色].
Style: clean, minimalist, professional. No text.
Aspect ratio 2.35:1, wide format.
```

**保存路径**：`[slug]/images/cover.png`

**配色风格参考：**

| 文章类型 | 推荐配色 | 视觉元素 |
|:---|:---|:---|
| AI / 深度学习 | 深蓝 + 青蓝渐变 | 神经网络、大脑、电路 |
| 架构设计 | 深灰 + 橙色点缀 | 模块、连接线、流程图 |
| 工具推荐 | 紫色渐变 + 白色 | 工具图标、齿轮、拼图 |
| 教程入门 | 浅蓝 + 绿色 | 书本、阶梯、灯泡 |
| 经验总结 | 暖橙 + 深色底 | 山峰、路径、里程碑 |

### 正文配图

**插图策略：**

1. **每 800-1200 字**插入一张，避免大段纯文字
2. **优先在以下位置插入**：
   - 每个大章节（h2/h3）标题后
   - 核心概念的解释段落旁
   - 流程/架构描述处
   - 文末总结前
3. 一篇 2000 字文章建议 **2-4 张**配图

**Prompt 模板：**

```
A [风格] illustration for a tech article section about [本节主题].
Visual elements: [与内容相关的具象元素].
Color palette: consistent with [封面配色方案].
Style: flat design / isometric / minimalist. No text.
Square format.
```

> ⚠️ 正文配图的配色风格应与封面图保持一致，形成统一的视觉语言。

**保存路径**：`[slug]/images/section-[序号]-[简述].png`

### 图片插入

在 Draft.md 对应位置先用本地路径插入：

```markdown
![配图描述](images/section-01-architecture.png)
```

### 图片上传到 OSS 图床

生成配图后，自动上传到阿里云 OSS，并将 Draft.md 中的本地路径替换为图床 URL。

**前置条件：** 需要设置以下环境变量（参见附录「环境变量配置」）：

| 环境变量 | 说明 | 示例 |
|:---|:---|:---|
| `OSS_BUCKET` | OSS Bucket 名 | `my-picture-bed` |
| `OSS_ENDPOINT` | OSS 节点地址 | `oss-cn-shanghai.aliyuncs.com` |
| `OSS_ACCESS_KEY_ID` | 阿里云 AccessKey ID | - |
| `OSS_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret | - |

**上传命令：**

```bash
ossutil cp docs/weichat/[slug]/images/[filename].png \
  oss://$OSS_BUCKET/tech/wechat/[slug]/[filename].png \
  -e $OSS_ENDPOINT \
  -i $OSS_ACCESS_KEY_ID \
  -k $OSS_ACCESS_KEY_SECRET
```

**上传后替换 Draft.md 中的路径：**

```
# 本地路径 → OSS URL
images/cover.png
→ https://$OSS_BUCKET.$OSS_ENDPOINT/tech/wechat/[slug]/cover.png

images/section-01-xxx.png
→ https://$OSS_BUCKET.$OSS_ENDPOINT/tech/wechat/[slug]/section-01-xxx.png
```

> ⚠️ 上传前确认 4 个环境变量均已设置，可通过 `echo $OSS_BUCKET` 验证。

---

## Step 3: 格式转换与发布

### AI 自动执行

1. **复制草稿到剪贴板**
   ```bash
   cat docs/weichat/[slug]/Draft.md | pbcopy
   ```

2. **打开 Doocs/md 编辑器**
   ```bash
   open https://md.doocs.org/
   ```

> 💡 AI 执行到这里即结束，后续由用户手动操作。

### 用户手动操作

1. 在 Doocs/md 左侧编辑区 **Cmd+A** 全选 → **删除** → **Cmd+V** 粘贴草稿
2. 右侧实时预览确认排版效果
3. 点击右上角 **「复制」** 按钮（复制为富文本）
4. 打开 [公众号后台](https://mp.weixin.qq.com/) → 内容与互动 → 图文消息 → 写新图文
5. 在正文区域 **Cmd+V** 粘贴
6. 从 Draft.md 顶部的 3 个备选标题中选一个填入标题栏
7. 上传封面图（`images/cover.png`）
8. 上传正文配图到素材库（如未使用图床）
9. 预览移动端效果 → 发布

### 其他编辑器（备选）

| 编辑器 | 地址 | 是否需要注册 |
|:---|:---|:---|
| **Doocs/md** (推荐) | https://md.doocs.org/ | ❌ 无需注册 |
| mdnice | https://editor.mdnice.com/ | ✅ 需要注册 |
| markdown.com.cn | https://www.markdown.com.cn/editor/ | ❌ 无需注册 |

### 图片上传策略

公众号不支持外链图片，需选择以下任一方案：

| 方案 | 操作 | 适用场景 |
|:---|:---|:---|
| **公众号素材库** | 在后台手动上传 `images/` 内的图片 | 默认推荐 |
| **图床** | 使用阿里云 OSS 等图床，在 Draft 中直接使用图床 URL | 有图床账号时 |

### 发布 Checklist

**AI 自动完成 ✅：**
- [x] 源文档 → 公众号草稿改写
- [x] 生成 3 个备选标题 + 摘要
- [x] 生成封面图（900×383）
- [x] 生成 2-4 张正文配图
- [x] 配图插入 Draft.md 合适位置
- [x] 上传图片到 OSS 图床，替换 Draft.md 中的本地路径为 OSS URL
- [x] 草稿内容复制到剪贴板
- [x] 打开 Doocs/md 编辑器

**用户手动完成 📋：**
- [ ] 在 Doocs/md 粘贴草稿并确认预览（图片应正常显示）
- [ ] 点击「复制」→ 粘贴到公众号编辑器
- [ ] 选择标题、设置作者
- [ ] 上传封面图（从 `images/cover.png` 或使用 OSS URL）
- [ ] 预览移动端效果
- [ ] 发布

---

## 附录

### CLI 工具方案（备选）

```bash
# 安装
npm install -g md2wechat

# 转换并保存到文件
npx md2wechat convert your-article.md > output.html
```

> ⚠️ md2wechat 输出可能包含调试信息，需要手动清理。

### API 自动发布方案（高级）

适用于**已认证的公众号**（可获取 AppID 和 AppSecret）：

```bash
ash install jimliu/baoyu-skills
```

在 `~/.baoyu-skills/baoyu-post-to-wechat/EXTEND.md` 中配置：

```yaml
wechat_app_id: your_app_id
wechat_app_secret: your_app_secret
```

> ⚠️ 未认证的订阅号无法使用 API 接口，只能使用浏览器方式或手动粘贴。

### 常见问题

**Q: 粘贴后显示 HTML 代码？**
A: 使用 Doocs/md 的「复制」功能复制富文本格式，不要复制 HTML 源码。

**Q: 图片无法显示？**
A: 公众号不支持外链图片，需上传到素材库或使用图床。

**Q: 未认证订阅号能用 API 发布吗？**
A: 不能，只能手动粘贴发布。

### 相关链接

- 🛠️ **Doocs/md**: https://md.doocs.org/
- 📘 **公众号后台**: https://mp.weixin.qq.com/
- 💡 **md2wechat**: https://www.npmjs.com/package/md2wechat
