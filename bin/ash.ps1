# ash.ps1 - Awesome Skills Hub CLI for Windows
# A PowerShell implementation for managing AI IDE skills.
# Version: 1.1.27

# --- Encoding Setup ---
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# --- Path Configuration ---
$ASH_HOME = Join-Path $env:USERPROFILE ".ash"
$SKILLS_DIR = Join-Path $ASH_HOME "skills"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
$VERSION = "1.1.27"

# First Run Logic: initialize global skills from package
if (-not (Test-Path $SKILLS_DIR)) {
    $LOCAL_SKILLS = Join-Path $PROJECT_ROOT "skills"
    if (Test-Path $LOCAL_SKILLS) {
        Write-Host "[INFO] First run, initializing ~/.ash ..." -ForegroundColor Blue
        New-Item -Path $ASH_HOME -ItemType Directory -Force | Out-Null
        Copy-Item -Path $LOCAL_SKILLS -Destination $SKILLS_DIR -Recurse -Force
        Write-Host "[OK] Initialized!" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Skills directory not found: $LOCAL_SKILLS" -ForegroundColor Yellow
        $SKILLS_DIR = $LOCAL_SKILLS
    }
}

# --- IDE Target Paths ---
$AGENT_SKILLS_DIR  = Join-Path $env:USERPROFILE ".agent\skills"
$CURSOR_SKILLS_DIR = Join-Path $env:USERPROFILE ".cursor\skills"
$TRAE_SKILLS_DIR   = Join-Path $env:USERPROFILE ".trae\skills"
$TRAE_CN_SKILLS_DIR = Join-Path $env:USERPROFILE ".trae-cn\skills"
$WINDSURF_SKILLS_DIR = Join-Path $env:USERPROFILE ".windsurf\skills"
$COPILOT_SKILLS_DIR = Join-Path $env:USERPROFILE ".copilot\skills"
$CLAUDE_SKILLS_DIR = Join-Path $env:USERPROFILE ".claude\skills"

# All IDE targets as array of hashtables
function Get-IdeTargets {
    return @(
        @{ Name = "Antigravity"; Dir = $AGENT_SKILLS_DIR },
        @{ Name = "Cursor";      Dir = $CURSOR_SKILLS_DIR },
        @{ Name = "TRAE";        Dir = $TRAE_SKILLS_DIR },
        @{ Name = "TRAE CN";     Dir = $TRAE_CN_SKILLS_DIR },
        @{ Name = "Windsurf";    Dir = $WINDSURF_SKILLS_DIR },
        @{ Name = "Copilot";     Dir = $COPILOT_SKILLS_DIR },
        @{ Name = "Claude";      Dir = $CLAUDE_SKILLS_DIR }
    )
}

# --- ANSI Colors ---
$ESC = [char]27
$GREEN  = "$ESC[32m"
$BLUE   = "$ESC[34m"
$YELLOW = "$ESC[33m"
$RED    = "$ESC[31m"
$CYAN   = "$ESC[36m"
$DIM    = "$ESC[2m"
$NC     = "$ESC[0m"

# --- Log Functions ---
function Write-LogInfo($msg)    { Write-Host "${BLUE}[INFO]${NC} $msg" }
function Write-LogSuccess($msg) { Write-Host "${GREEN}[OK]${NC} $msg" }
function Write-LogError($msg)   { Write-Host "${RED}[ERR]${NC} $msg" }
function Write-LogWarn($msg)    { Write-Host "${YELLOW}[WARN]${NC} $msg" }

# --- Helpers ---
function Get-SkillFiles {
    if (-not (Test-Path $SKILLS_DIR)) { return @() }
    Get-ChildItem -Path $SKILLS_DIR -Filter "*.md" -Recurse |
        Where-Object { $_.Name -ne "README.md" }
}

# Returns de-duplicated skill paths:
#   - Folder skill (dir with SKILL.md) -> returns the directory path
#   - Standalone .md file -> returns the file path
#   - Skips .md files nested inside a folder skill
function Get-AllSkillPaths {
    if (-not (Test-Path $SKILLS_DIR)) { return @() }
    $results = [System.Collections.Generic.List[string]]::new()
    $folderSkillDirs = [System.Collections.Generic.HashSet[string]]::new()

    # Pass 1: Identify all folder skills (directories containing SKILL.md)
    Get-ChildItem -Path $SKILLS_DIR -Filter "SKILL.md" -Recurse -File | ForEach-Object {
        $dir = $_.DirectoryName
        $folderSkillDirs.Add($dir) | Out-Null
        $results.Add($dir)
    }

    # Pass 2: Collect standalone .md files not nested inside any folder skill
    Get-ChildItem -Path $SKILLS_DIR -Filter "*.md" -Recurse -File |
        Where-Object { $_.Name -ne "README.md" -and $_.Name -ne "SKILL.md" } |
        ForEach-Object {
            $filePath = $_.FullName
            $isNested = $false
            foreach ($fsd in $folderSkillDirs) {
                if ($filePath.StartsWith($fsd + [IO.Path]::DirectorySeparatorChar)) {
                    $isNested = $true
                    break
                }
            }
            if (-not $isNested) {
                $results.Add($filePath)
            }
        }

    return $results | Sort-Object
}

# ==============================================================================
# Command: help
# ==============================================================================
function Show-Help {
    Write-Host ""
    Write-Host "${CYAN}   ___   _____ _   _ ${NC}"
    Write-Host "${CYAN}  / _ \ / ____| | | |${NC}"
    Write-Host "${CYAN} | |_| | (___ | |_| |${NC}"
    Write-Host "${CYAN} |  _  |\___ \|  _  |${NC}"
    Write-Host "${CYAN} | | | |____) | | | |${NC}"
    Write-Host "${CYAN} |_| |_|_____/|_| |_|${NC}"
    Write-Host ""
    Write-Host "Awesome Skills Hub (ASH) v${VERSION}"
    Write-Host ""
    Write-Host "${YELLOW}Usage:${NC} ash <command> [args]"
    Write-Host ""
    Write-Host "${YELLOW}Commands:${NC}"
    Write-Host "  init              Initialize environment and detect IDEs"
    Write-Host "  list              List all available skills"
    Write-Host "  info <name>       Show skill details and preview"
    Write-Host "  search <keyword>  Search skills by keyword"
    Write-Host "  status            Show installed skills status"
    Write-Host "  install <name>    Install skill to all IDEs (supports --all)"
    Write-Host "  uninstall <name>  Uninstall skill (supports --all)"
    Write-Host "  sync              Sync/update skills from repository"
    Write-Host "  help              Show this help"
    Write-Host ""
    Write-Host "${YELLOW}Examples:${NC}"
    Write-Host "  ash list"
    Write-Host "  ash install pdf"
    Write-Host "  ash install --all"
    Write-Host "  ash info docx"
    Write-Host "  ash search react"
    Write-Host ""
}

# ==============================================================================
# Command: list
# ==============================================================================
function Invoke-List {
    Write-LogInfo "Available skills:"
    Write-Host ""
    $categories = Get-ChildItem -Path $SKILLS_DIR -Directory -ErrorAction SilentlyContinue
    foreach ($cat in $categories) {
        $files = Get-ChildItem -Path $cat.FullName -Filter "*.md" |
            Where-Object { $_.Name -ne "README.md" }
        if ($files.Count -gt 0) {
            Write-Host "${YELLOW}[$($cat.Name)]${NC}"
            foreach ($f in $files) {
                Write-Host "  ${GREEN}*${NC} $($f.Name)"
            }
            Write-Host ""
        }
    }
    $all = @(Get-SkillFiles)
    Write-LogInfo "Total: $($all.Count) skills available"
    Write-Host "${DIM}Tip: use 'ash info <name>' to see details${NC}"
}

# ==============================================================================
# Helper: Resolve skill path by name
# ==============================================================================
function Resolve-SkillPath($name) {
    if ([string]::IsNullOrEmpty($name)) { return $null }
    if ($name.EndsWith(".md")) { $name = $name.Substring(0, $name.Length - 3) }

    # 1. Check for folder skill (directory containing SKILL.md)
    $folderMatches = @(Get-ChildItem -Path $SKILLS_DIR -Directory -Recurse |
        Where-Object { $_.Name -eq $name -and (Test-Path (Join-Path $_.FullName "SKILL.md")) })
    
    if ($folderMatches.Count -eq 1) {
        return Join-Path $folderMatches[0].FullName "SKILL.md"
    }

    # 2. Check for file skill (.md file)
    $fileMatches = @(Get-SkillFiles | Where-Object {
        $_.BaseName -eq $name -or $_.Name -eq $name
    })

    $allMatches = @()
    if ($folderMatches.Count -gt 0) { $allMatches += $folderMatches | ForEach-Object { Join-Path $_.FullName "SKILL.md" } }
    if ($fileMatches.Count -gt 0) { $allMatches += $fileMatches | ForEach-Object { $_.FullName } }

    if ($allMatches.Count -eq 0) { return $null }
    if ($allMatches.Count -eq 1) { return $allMatches[0] }

    # Multiple matches
    Write-LogWarn "Multiple skills found with name '$name'. Please specify full path:"
    foreach ($m in $allMatches) {
        $rel = $m.Substring($SKILLS_DIR.Length + 1)
        Write-Host "  * ash install $rel"
    }
    return "MULTIPLE"
}

# ==============================================================================
# Command: info
# ==============================================================================
function Invoke-Info($name) {
    if (-not $name) { Write-LogError "Please specify skill name (e.g.: ash info pdf)"; return }
    $path = Resolve-SkillPath $name
    if ($null -eq $path) { Write-LogError "Skill not found: $name"; return }
    if ($path -eq "MULTIPLE") { return }

    $content = Get-Content $path -Raw -Encoding UTF8
    $filename = Split-Path $path -Leaf
    Write-Host "${CYAN}[$filename]${NC}"
    Write-Host "------------------------------------------"

    # Simple YAML frontmatter parser
    if ($content -match '(?s)^---\r?\n(.*?)\r?\n---') {
        $yaml = $Matches[1]
        if ($yaml -match 'description:\s*(.+)') {
            Write-Host "Description: " -NoNewLine
            Write-Host $Matches[1] -ForegroundColor Green
        }
        if ($yaml -match 'triggers:\s*(.+)') {
            Write-Host "Triggers: " -NoNewLine
            Write-Host $Matches[1] -ForegroundColor Yellow
        }
    }
    Write-Host ""
    Write-Host "Content preview:" -ForegroundColor Cyan
    $lines = Get-Content $path -Encoding UTF8 | Select-Object -First 15
    foreach ($l in $lines) { Write-Host "  $l" }
    $totalLines = (Get-Content $path -Encoding UTF8).Count
    if ($totalLines -gt 15) { Write-Host "  ..." -ForegroundColor Gray }
}

# ==============================================================================
# Helper: Install a skill (file or folder) to all detected IDEs
# ==============================================================================
function Install-SkillToIdes($source) {
    $installed = 0
    $targets = Get-IdeTargets
    $isFolder = $false
    $installName = Split-Path $source -Leaf

    # Detect folder skill: if source is SKILL.md, install the parent directory
    if ($installName -eq "SKILL.md") {
        $isFolder = $true
        $source = Split-Path $source -Parent
        $installName = Split-Path $source -Leaf
    }
    # Also handle when source is a directory directly (from Get-AllSkillPaths)
    if (Test-Path $source -PathType Container) {
        $isFolder = $true
    }

    foreach ($t in $targets) {
        if (Test-Path $t.Dir) {
            $dest = Join-Path $t.Dir $installName
            try {
                if (Test-Path $dest) { Remove-Item $dest -Force -Recurse -ErrorAction SilentlyContinue }
                if ($isFolder) {
                    # Try symlink for directory
                    New-Item -ItemType SymbolicLink -Path $dest -Target $source -Force -ErrorAction Stop | Out-Null
                } else {
                    New-Item -ItemType SymbolicLink -Path $dest -Target $source -Force -ErrorAction Stop | Out-Null
                }
                $installed++
            } catch {
                # Symlink requires admin/dev mode on Windows; fall back to copy
                try {
                    if ($isFolder) {
                        Copy-Item -Path $source -Destination $dest -Recurse -Force -ErrorAction Stop
                    } else {
                        Copy-Item -Path $source -Destination $dest -Force -ErrorAction Stop
                    }
                    $installed++
                } catch {
                    # silently skip
                }
            }
        }
    }
    return $installed
}

# ==============================================================================
# Command: install
# ==============================================================================
function Invoke-Install($name) {
    if (-not $name) { Write-LogError "Please specify skill name (e.g.: pdf or --all)"; return }

    if ($name -eq "--all") {
        $skillPaths = @(Get-AllSkillPaths)
        Write-LogInfo "Batch installing $($skillPaths.Count) skills to all detected IDEs..."
        Write-Host ""
        $total = 0
        $updated_ides = [System.Collections.Generic.List[string]]::new()

        foreach ($sp in $skillPaths) {
            $rel = $sp.Substring($SKILLS_DIR.Length + 1)
            $displayName = Split-Path $sp -Leaf
            Write-Host "  ${GREEN}*${NC} ${CYAN}${displayName}${NC} ${DIM}($rel)${NC}"
            $count = Install-SkillToIdes $sp
            $total += $count
        }

        # Recap IDEs
        $targets = Get-IdeTargets
        foreach ($t in $targets) {
            if (Test-Path $t.Dir) { $updated_ides.Add($t.Name) }
        }

        Write-Host ""
        Write-LogSuccess "Batch install complete!"
        $ideList = [string]::Join(', ', $updated_ides)
        Write-Host "  ${CYAN}Synced IDEs:${NC} $ideList"
        Write-Host "  ${CYAN}Total links:${NC} $total"
        return
    }

    $path = Resolve-SkillPath $name
    if ($null -eq $path) { Write-LogError "Skill not found: $name"; return }
    if ($path -eq "MULTIPLE") { return }

    $count = Install-SkillToIdes $path
    if ($count -gt 0) {
        Write-LogSuccess "Installed to $count IDE environment(s)."
    } else {
        Write-LogWarn "No target directories found. Please run 'ash init' first."
    }
}

# ==============================================================================
# Command: uninstall
# ==============================================================================
function Invoke-Uninstall($name) {
    if (-not $name) { Write-LogError "Please specify skill name (e.g.: pdf or --all)"; return }

    $targets = Get-IdeTargets

    if ($name -eq "--all") {
        Write-LogInfo "Uninstalling all skills from all IDEs..."
        $total = 0
        foreach ($t in $targets) {
            if (Test-Path $t.Dir) {
                $count = 0
                $removed = [System.Collections.Generic.List[string]]::new()
                $items = Get-ChildItem -Path $t.Dir -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -ne "README.md" }
                foreach ($item in $items) {
                    Remove-Item $item.FullName -Force -Recurse -ErrorAction SilentlyContinue
                    $removed.Add($item.Name)
                    $count++
                    $total++
                }
                if ($count -gt 0) {
                    $removedList = [string]::Join(', ', $removed)
                    Write-Host "  ${CYAN}$($t.Name):${NC} removed ${GREEN}$count${NC} skills [$removedList]"
                }
            }
        }
        Write-Host ""
        if ($total -gt 0) { Write-LogSuccess "Uninstall complete. Removed $total items total." }
        else { Write-LogWarn "No installed skills found." }
        return
    }

    # Single uninstall: try both with and without .md
    $candidates = @($name)
    if (-not $name.EndsWith(".md")) { $candidates += "$name.md" }
    if ($name.EndsWith(".md")) { $candidates += $name.Substring(0, $name.Length - 3) }
    
    $total = 0
    foreach ($t in $targets) {
        foreach ($candidate in $candidates) {
            $p = Join-Path $t.Dir $candidate
            if (Test-Path $p) {
                Remove-Item $p -Force -Recurse -ErrorAction SilentlyContinue
                Write-LogSuccess "Removed from $($t.Name): $candidate"
                $total++
                break  # one match per IDE is enough
            }
        }
    }
    if ($total -eq 0) { Write-LogWarn "Skill not found in any IDE: $name" }
}

# ==============================================================================
# Command: status
# ==============================================================================
function Invoke-Status {
    Write-LogInfo "Installed skills status:"
    Write-Host ""
    $targets = Get-IdeTargets
    foreach ($t in $targets) {
        if (Test-Path $t.Dir) {
            Write-Host "  ${CYAN}$($t.Name) ($($t.Dir)):${NC}"
            $items = @(Get-ChildItem -Path $t.Dir -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne "README.md" })
            if ($items.Count -eq 0) {
                Write-Host "    * (none)" -ForegroundColor Gray
            } else {
                foreach ($item in $items) {
                    $isDir = $item.PSIsContainer
                    $isSymlink = $item.Attributes -match "ReparsePoint"
                    $label = $item.Name
                    if ($isDir) { $label += "/" }
                    if ($isSymlink) {
                        try {
                            $tgt = (Get-Item $item.FullName).Target
                            Write-Host "    ${GREEN}*${NC} $label -> $tgt"
                        } catch {
                            Write-Host "    ${GREEN}*${NC} $label (symlink)"
                        }
                    } else {
                        $kind = if ($isDir) { "copy/dir" } else { "copy" }
                        Write-Host "    ${GREEN}*${NC} $label ($kind)"
                    }
                }
            }
        }
    }
}

# ==============================================================================
# Command: sync
# ==============================================================================
function Invoke-Sync {
    Write-LogInfo "Syncing skills..."

    $gitDir = Join-Path $PROJECT_ROOT ".git"
    if (Test-Path $gitDir) {
        Write-LogInfo "Git repo detected. Pulling latest..."
        Push-Location $PROJECT_ROOT
        try {
            git pull origin main 2>&1 | ForEach-Object { Write-Host $_ }
            if ($LASTEXITCODE -eq 0) {
                Write-LogSuccess "Git sync complete."
            }
        } finally {
            Pop-Location
        }

        # Sync to global dir
        Write-LogInfo "Syncing to global directory ($SKILLS_DIR)..."
        $localSkills = Join-Path $PROJECT_ROOT "skills"
        if (Test-Path $localSkills) {
            Copy-Item -Path (Join-Path $localSkills "*") -Destination $SKILLS_DIR -Recurse -Force
            Write-LogSuccess "Sync complete! Run 'ash list' to see latest skills."
        }
    } else {
        Write-LogWarn "Not in a Git repository. Skipping sync."
        Write-Host "Tip: Clone the repo and run install.ps1, or use 'npm update -g askill'" -ForegroundColor Cyan
    }
}

# ==============================================================================
# Command: init
# ==============================================================================
function Invoke-Init {
    Write-LogInfo "Initializing IDE skill directories..."
    $targets = Get-IdeTargets
    foreach ($t in $targets) {
        if (-not (Test-Path $t.Dir)) {
            New-Item -Path $t.Dir -ItemType Directory -Force | Out-Null
            Write-LogSuccess "Created: $($t.Dir)"
        } else {
            Write-LogInfo "Exists:  $($t.Dir)"
        }
    }
    Write-LogSuccess "Init complete."
}

# ==============================================================================
# Command: search
# ==============================================================================
function Invoke-Search($query) {
    if (-not $query) { Write-LogError "Please provide a search keyword"; return }
    Write-LogInfo "Searching for '$query'..."
    Write-Host ""
    $files = @(Get-SkillFiles)
    $found = 0
    foreach ($f in $files) {
        $content = Get-Content $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        $rel = $f.FullName.Substring($SKILLS_DIR.Length + 1)
        if ($f.Name -match $query -or $content -match $query) {
            Write-Host "  ${GREEN}*${NC} ${CYAN}$($f.Name)${NC} ${DIM}($rel)${NC}"
            $found++
        }
    }
    if ($found -eq 0) { Write-LogWarn "No matches found." }
    else { Write-LogInfo "Found $found matching skill(s)." }
}

# ==============================================================================
# Did You Mean? (typo suggestions)
# ==============================================================================
function Invoke-DidYouMean($cmd) {
    $typos = @{
        "ls" = "list"; "l" = "list"; "serch" = "search"; "find" = "search";
        "intall" = "install"; "instal" = "install"; "insall" = "install";
        "unintall" = "uninstall"; "rm" = "uninstall";
        "stat" = "status"; "st" = "status"
    }
    if ($typos.ContainsKey($cmd)) {
        $suggest = $typos[$cmd]
        Write-LogWarn "Unknown command '$cmd'. Did you mean '${CYAN}ash $suggest${NC}'?"
        return
    }
    Write-LogError "Unknown command '$cmd'. Run 'ash help' for usage."
}

# ==============================================================================
# Entry Point
# ==============================================================================
$cmd = $args[0]
$param = $args[1]

switch ($cmd) {
    "list"      { Invoke-List }
    "info"      { Invoke-Info $param }
    "install"   { Invoke-Install $param }
    "add"       { Invoke-Install $param }
    "uninstall" { Invoke-Uninstall $param }
    "search"    { Invoke-Search $param }
    "status"    { Invoke-Status }
    "sync"      { Invoke-Sync }
    "init"      { Invoke-Init }
    "help"      { Show-Help }
    "-h"        { Show-Help }
    "--help"    { Show-Help }
    "-v"        { Write-Host "${CYAN}ASH (Awesome-Skills-Hub) v${VERSION}${NC}" }
    "--version" { Write-Host "${CYAN}ASH (Awesome-Skills-Hub) v${VERSION}${NC}" }
    ""          { Show-Help }
    default     { Invoke-DidYouMean $cmd }
}
