# Awesome Skills Hub (ASH)
**—— AI IDE 界的 "Homebrew"**
> **Write Once, Link Everywhere.** (一次编写，全端同步)
>
> 🌟 **GitHub**: [https://github.com/tiandee/awesome-skills-hub](https://github.com/tiandee/awesome-skills-hub)
> 🍎 **适用平台**: 目前深度适配 **macOS**，Windows 用户建议在 WSL 下使用。

## 1. 它是做什么的？
ASH 是一个**跨平台的 AI 技能（Skills）包管理器**。它是 AI 编程时代的 `npm` 或 `Homebrew`，专门以此来管理你的 AI 辅助能力。

## 2. 解决了什么痛点？
*   **割裂感强**：在 Cursor 里写了一套好用的 Prompt，换到 Windsurf 又得手动复制一遍；
*   **维护困难**：精心调教的 "Java 专家"、"Git 规范" 散落在各个项目的文件夹里，版本各不相同；
*   **缺乏标准**：每个 IDE 都有自己的技能目录（`.cursor/skills`, `.windsurf/skills`...），难以统一。

## 3. 核心亮点 ✨
*   **⚡️ 一键全端同步**
    只需运行 `ash add java`，它会自动检测你电脑上安装的 IDE (Cursor, Windsurf, Trae, VSCode Copilot...)，并将技能自动注入到所有环境中。
*   **🌉 自动桥接引擎**
    你只管维护一份标准的 Markdown 技能文件，ASH 会自动生成各个 IDE 所需的专用配置（自动创建软链），保持所有工具的一致性。
*   **📦 熟悉的开发体验**
    完全复刻包管理器的体验：`ash list` (查看), `ash search` (搜索), `ash add` (安装), `ash update` (更新)。
*   **🛡️ 双模式支持**
    *   **全局模式**：个人常用工具箱（如：翻译、代码审查），安装一次，所有项目通用。
    *   **项目模式**：团队协作规范（如：API 接口规范），安装在项目内，同事 `git clone` 后即刻生效。

## 4. 极速上手 🚀
无需安装任何依赖，直接在终端运行：

```bash
# 1. 查看有哪些好用的技能
npx askill list

# 2. 给你的 IDE 增加 "读取 PDF" 的能力
npx askill add pdf
```
