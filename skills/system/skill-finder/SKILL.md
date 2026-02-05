---
name: skill-finder
description: A meta-skill that helps the Agent find and install new skills when it encounters a task it cannot perform.
---

# Skill Finder (Meta-Skill)

## Purpose
This skill empowers you (the Agent) to extend your own capabilities by finding and installing new tools from the Awesome Skills Hub (ASH) or the Vercel Labs ecosystem.

## When to Use
Activate this skill when:
1.  The user asks for a capability you do not currently have (e.g., "Create a PDF", "Generate a video", "Design a UI").
2.  The user explicit asks you to find a tool or skill.
3.  You encounter an error indicating a missing tool.

## Instructions
When you realize you need a new skill, follow these steps:

1.  **Search Locally**:
    Run `ash search <keyword>` to see if a relevant skill exists in the official registry.
    
    ```bash
    ash search <keyword>
    ```

2.  **Analyze Results**:
    - If a matching skill is found (e.g., `pdf` for PDF creation), suggest it to the user.
    - Explain that installing it will give you the requested capability.

3.  **Propose Installation**:
    Ask the user if they want to install it.
    
    ```bash
    ash add <skill-name>
    ```
    
4.  **External Search (Fallback)**:
    If `ash search` yields no results, tell the user:
    "I can't find a local skill for this, but you might find one on **Skill Hub CN** (https://www.skill-cn.com) or GitHub."
    
    You can suggest they run:
    ```bash
    # Install from GitHub
    ash add user/repo
    
    # Or from Vercel Ecosystem
    npx skills add user/repo
    ```

## Example Interaction
**User**: "Can you generate a PDF report for me?"
**Agent (Thinking)**: I don't have a `create_pdf` tool. Let me check.
**Agent (Action)**: `ash search pdf`
**System**: 
```
Found skills:
- pdf (Handling PDF extraction and creation)
```
**Agent (Response)**: "I found a `pdf` skill that can help with that. Shall I install it for you? Run: `ash add pdf`"
