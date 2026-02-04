# Contributing to Awesome-Skills-Hub

Thank you for your interest in contributing! This project aims to be a collaborative library of high-quality AI prompts and skills.

## How to Add a New Skill

1.  **Fork the repository**.
2.  **Create a new file**: 
    -   Navigate to `skills/`.
    -   Choose the appropriate category folder (e.g., `java`, `python`, `general`).
    -   If a category doesn't exist, feel free to create it.
    -   Create your markdown file, e.g., `my-cool-skill.md`.

3.  **Skill Format**:
    Ideally, your skill file should contain a clear system prompt or set of instructions. 
    
    Example:
    ```markdown
    # Expert Java Developer
    
    You are an expert Java developer using Spring Boot...
    ```

4.  **Test it**:
    -   Run `ash install <your-skill-path>` locally.
    -   Verify it works in your target IDE (Antigravity/Cursor/etc.).

5.  **Submit a Pull Request**:
    -   Describe what your skill does.
    -   We will review and merge it!

## Reporting Issues

If you find a bug in the CLI tool `ash`, please open a GitHub Issue with:
-   Your OS version.
-   The error message.
-   Steps to reproduce.
