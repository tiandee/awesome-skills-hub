---
name: publish-to-wechat
description: Use this skill when the user wants to publish Markdown content to WeChat Official Account (微信公众号). This includes converting Markdown to WeChat-compatible format, formatting articles for mobile reading, and publishing to the official account platform.
license: MIT
---

# 微信公众号发布指南

## Overview

本指南帮助你将 Markdown 文档转换为微信公众号兼容的格式，并发布到公众号。

## 快速开始

### 推荐方案：Doocs/md 编辑器（免费无需注册）

```bash
# 1. 复制 Markdown 源文件到剪贴板
cat your-article.md | pbcopy

# 2. 打开 Doocs/md 编辑器
open https://doocs.github.io/md/
```

**操作步骤：**
1. 在左侧编辑区粘贴 Markdown 内容
2. 右侧实时预览效果
3. 点击右上角 **「复制」** 按钮
4. 打开公众号后台 → 内容与互动 → 图文消息 → 写新图文
5. 在正文区域 **Cmd+V** 粘贴即可

## 发布前优化

### 排版建议

1. **精简标题**：公众号标题限制 64 字符，建议简洁有力
2. **使用 Emoji**：适当添加 emoji 增加阅读趣味 🎯
3. **移除徽章图片**：公众号对外链图片支持有限，建议用文字替代
4. **优化表格**：确保表格在移动端可正常滚动查看
5. **检查图片**：确保图片已上传到图床，公众号不支持相对路径

### 标题风格示例

| 风格 | 示例 |
|:---|:---|
| **直接型** | ASH — AI IDE 界的"Homebrew" |
| **痛点型** | 还在为每个IDE重复配置AI技能？一键搞定！ |
| **吸引型** | 装一次技能，8个AI IDE同步，这个工具太香了 |
| **简洁型** | ASH：AI 技能跨平台管理利器 |

## 其他在线编辑器

| 编辑器 | 地址 | 是否需要注册 |
|:---|:---|:---|
| **Doocs/md** (推荐) | https://doocs.github.io/md/ | ❌ 无需注册 |
| mdnice | https://editor.mdnice.com/ | ✅ 需要注册 |
| markdown.com.cn | https://www.markdown.com.cn/editor/ | ❌ 无需注册 |

## CLI 工具方案（备选）

### md2wechat

```bash
# 安装
npm install -g md2wechat

# 转换（输出到终端）
npx md2wechat convert your-article.md

# 转换并保存到文件
npx md2wechat convert your-article.md > output.html
```

> ⚠️ **注意**：md2wechat 输出可能包含调试信息，需要手动清理 HTML 前的调试内容。

## API 自动发布方案（高级）

如果你有**已认证的公众号**（可获取 AppID 和 AppSecret），可以使用 [baoyu-post-to-wechat](https://github.com/jimliu/baoyu-skills) 技能实现自动化发布。

### 安装

```bash
ash install jimliu/baoyu-skills
```

### 配置

在 `~/.baoyu-skills/baoyu-post-to-wechat/EXTEND.md` 中配置：

```yaml
wechat_app_id: your_app_id
wechat_app_secret: your_app_secret
default_publish_method: api  # 或 browser
default_author: your_name
```

### 使用

配置完成后，AI 助手可以直接调用该 skill 将 Markdown 转换并发布到公众号草稿箱。

> ⚠️ **限制**：未认证的订阅号无法获取 AppSecret，只能使用浏览器方式或手动粘贴。

## 常见问题

### Q: 粘贴后显示 HTML 代码而不是格式化内容？
**A**: 公众号编辑器需要富文本格式，不能直接粘贴 HTML 源码。请使用 Doocs/md 编辑器的「复制」功能，它会复制富文本格式。

### Q: 公众号有字数限制吗？
**A**: 正规的「文章」没有字数限制。如果遇到限制，可能是粘贴到了「摘要」或「短图文」区域。

### Q: 未认证订阅号能用 API 发布吗？
**A**: 未认证的订阅号无法使用 API 接口（没有 AppSecret），只能手动粘贴发布。

### Q: 图片无法显示？
**A**: 公众号不支持外链图片，需要先将图片上传到公众号素材库，或使用支持公众号的图床服务。

## 发布流程 Checklist

- [ ] Markdown 内容已完成并校对
- [ ] 使用 Doocs/md 转换并复制富文本
- [ ] 粘贴到公众号「文章」编辑器
- [ ] 设置标题（64字符内）
- [ ] 设置作者
- [ ] 上传封面图
- [ ] 预览移动端效果
- [ ] 发布

## 相关链接

- 🛠️ **Doocs/md**: https://doocs.github.io/md/
- 📘 **公众号后台**: https://mp.weixin.qq.com/
- 💡 **md2wechat**: https://www.npmjs.com/package/md2wechat
