---
name: skill-finder
description: A meta-skill that helps the Agent find and install new skills autonomously when it encounters a task it cannot perform.
---

# Skill Manager (Meta-Skill)

## Purpose
This system skill grants you the ability to **self-extend** your capabilities. When you encounter a task you cannot solve with your current tools, use this skill to find and install the necessary tools dynamically.

## Triggers & Activation
Activate this behavior when:
1.  **Missing Capability**: User asks for "PDF generation", "Video analysis", etc., and you lack a corresponding tool.
2.  **Explicit Request**: User asks you to "find a tool to do X".
3.  **Error Recovery**: You try to run a command and get "command not found".

## Protocol: The Self-Extension Loop

When you need a new skill, follow this **4-Step Loop**:

### 1. **SEARCH** (Discover)
Run `ash search` to look for official skills in the registry.
```bash
ash search <keywords>
```

### 2. **EVALUATE** (Analyze)
- Analyze the output description.
- **Good Match**: If a skill clearly solves the problem, proceed to Install.
- **No Match**: Inform the user you couldn't find a local skill, and suggest searching GitHub (`ash add user/repo`).

### 3. **INSTALL** (Acquire)
Install the chosen skill.
```bash
ash add <skill-name>
```
*Note: This command will automatically link the skill to your environment. No restart is usually required.*

### 4. **EXECUTE** (Apply)
Once installed, **immediately use the new tool** to fulfill the user's original request. Do not just stop at installation.

---

## Example Scenario

**User**: "Can you crop this image to 500x500?"
**Agent Internal Monologue**: 
*I don't have an image processing tool. Let me check the hub.*

**Step 1: Search**
`ash search image`

**Step 2: Evaluate**
*Output: `images basic-image-processing-tools`*
*Match found: `images` skill looks relevant.*

**Step 3: Install**
`ash add images`

**Step 4: Execute**
*Now I can use the newly installed `crop_image` tool to satisfy the request.*
