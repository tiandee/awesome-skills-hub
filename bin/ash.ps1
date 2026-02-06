# ash.ps1 - Awesome Skills Hub CLI for Windows
# A PowerShell implementation for managing AI IDE skills.
# Version: 1.1.30

# --- Encoding Setup ---
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# --- Path Configuration ---
$ASH_HOME = Join-Path $env:USERPROFILE ".ash"
$SKILLS_DIR = Join-Path $ASH_HOME "skills"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
$VERSION = "1.1.30"

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
$AGENT_SKILLS_DIR    = Join-Path $env:USERPROFILE ".agent\skills"
$AGENTS_SKILLS_DIR   = Join-Path $env:USERPROFILE ".agents\skills"
$CURSOR_SKILLS_DIR   = Join-Path $env:USERPROFILE ".cursor\skills"
$TRAE_SKILLS_DIR     = Join-Path $env:USERPROFILE ".trae\skills"
$TRAE_CN_SKILLS_DIR  = Join-Path $env:USERPROFILE ".trae-cn\skills"
$WINDSURF_SKILLS_DIR = Join-Path $env:USERPROFILE ".windsurf\skills"
$COPILOT_SKILLS_DIR  = Join-Path $env:USERPROFILE ".copilot\skills"
$CLAUDE_SKILLS_DIR   = Join-Path $env:USERPROFILE ".claude\skills"

# All IDE targets as array of hashtables
function Get-IdeTargets {
    return @(
        @{ Name = "Antigravity";     Dir = $AGENT_SKILLS_DIR },
        @{ Name = "Generic Agents";  Dir = $AGENTS_SKILLS_DIR },
        @{ Name = "Cursor";          Dir = $CURSOR_SKILLS_DIR },
        @{ Name = "TRAE";            Dir = $TRAE_SKILLS_DIR },
        @{ Name = "TRAE CN";         Dir = $TRAE_CN_SKILLS_DIR },
        @{ Name = "Windsurf";        Dir = $WINDSURF_SKILLS_DIR },
        @{ Name = "Copilot";         Dir = $COPILOT_SKILLS_DIR },
        @{ Name = "Claude";          Dir = $CLAUDE_SKILLS_DIR }
    )
}

# Trusted GitHub orgs (for security check)
$TRUSTED_ORGS = @("tiandee","anthropics","huggingface","vercel-labs","aws-samples","microsoft","google","openai")

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

# ==============================================================================
# Helpers
# ==============================================================================

# Get all .md files recursively (raw, unfiltered)
function Get-SkillFiles {
    if (-not (Test-Path $SKILLS_DIR)) { return @() }
    Get-ChildItem -Path $SKILLS_DIR -Filter "*.md" -Recurse |
        Where-Object { $_.Name -ne "README.md" }
}

# Returns de-duplicated skill paths (matching Bash get_all_skills):
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

# Extract description from a skill file (YAML frontmatter or first markdown heading)
function Get-SkillDescription($path) {
    if (-not (Test-Path $path)) { return "" }
    $content = Get-Content $path -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $content) { return "" }

    # Try YAML frontmatter
    if ($content -match '(?s)^---\r?\n(.*?)\r?\n---') {
        $yaml = $Matches[1]
        if ($yaml -match 'description:\s*(.+)') { return $Matches[1].Trim().Trim('"').Trim("'") }
        if ($yaml -match 'name:\s*(.+)') { return $Matches[1].Trim().Trim('"').Trim("'") }
    }

    # Fallback: first markdown heading
    $lines = Get-Content $path -Encoding UTF8 -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match '^#+\s+(.+)') { return $Matches[1].Trim() }
        if ($line.Trim().Length -gt 0 -and -not ($line -match '^---')) { return $line.Trim() }
    }
    return ""
}

# Resolve skill path by name (returns full path, $null if not found, "MULTIPLE" if ambiguous)
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

# Suggest closest skill name on error (fuzzy match)
function Suggest-SkillName($name) {
    $allPaths = @(Get-AllSkillPaths)
    foreach ($sp in $allPaths) {
        $leaf = (Split-Path $sp -Leaf).ToLower()
        if ($leaf -like "*$($name.ToLower())*") {
            $display = Split-Path $sp -Leaf
            Write-Host "  Did you mean: ${CYAN}ash install $display${NC} ?"
            return
        }
    }
}

# Check and auto-init IDE directories if none exist
function Test-AndAutoInit {
    $targets = Get-IdeTargets
    $initialized = $false
    foreach ($t in $targets) {
        if (Test-Path $t.Dir) { $initialized = $true; break }
    }
    if (-not $initialized) {
        Write-LogWarn "No IDE directories found. Auto-initializing..."
        Invoke-Init
        Write-Host ""
    }
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
    Write-Host "  status            Show installed skills status (supports --full, <ide>)"
    Write-Host "  install <name>    Install skill (supports --all, -p, user/repo)"
    Write-Host "  uninstall <name>  Uninstall skill (supports --all)"
    Write-Host "  clean <ide|--all> Remove all skill links from IDE(s)"
    Write-Host "  sync              Sync/update skills from repository"
    Write-Host "  help              Show this help"
    Write-Host ""
    Write-Host "${YELLOW}Examples:${NC}"
    Write-Host "  ash list"
    Write-Host "  ash install pdf"
    Write-Host "  ash install --all"
    Write-Host "  ash install user/repo          # from GitHub"
    Write-Host "  ash install pdf -p             # project mode"
    Write-Host "  ash info docx"
    Write-Host "  ash search react"
    Write-Host "  ash status cursor"
    Write-Host "  ash clean --all"
    Write-Host ""
}

# ==============================================================================
# Command: list (aligned with Bash: uses Get-AllSkillPaths, shows tags)
# ==============================================================================
function Invoke-List {
    Write-LogInfo "Available skills:"
    Write-Host "${DIM}Format: * skill_name (tag: relative_path)${NC}"
    Write-Host ""

    $skillPaths = @(Get-AllSkillPaths)
    $entries = [System.Collections.Generic.List[string]]::new()

    foreach ($sp in $skillPaths) {
        $displayName = Split-Path $sp -Leaf
        $rel = $sp.Substring($SKILLS_DIR.Length + 1)

        # Determine tag
        $tag = "built-in"
        if ($rel -like "downloaded\*" -or $rel -like "downloaded/*") { $tag = "downloaded" }
        elseif ($rel -like "system\*" -or $rel -like "system/*") { $tag = "system" }
        elseif ($rel -like "demo\*" -or $rel -like "demo/*") { $tag = "demo" }

        Write-Host "  ${GREEN}*${NC} ${CYAN}${displayName}${NC} ${DIM}(${tag}: ${rel})${NC}"
        $entries.Add($displayName)
    }

    Write-Host ""
    Write-LogInfo "Total: $($entries.Count) skills available"
    Write-Host "${DIM}Tip: use 'ash info <name>' to see details${NC}"
}

# ==============================================================================
# Command: info (enhanced: relative path, name field, skip YAML preview)
# ==============================================================================
function Invoke-Info($name) {
    if (-not $name) { Write-LogError "Please specify skill name (e.g.: ash info pdf)"; return }
    $path = Resolve-SkillPath $name
    if ($null -eq $path) { Write-LogError "Skill not found: $name"; Suggest-SkillName $name; return }
    if ($path -eq "MULTIPLE") { return }

    # Handle directory skill: use SKILL.md for info
    $contentFile = $path
    $sourcePath = $path
    if ((Split-Path $path -Leaf) -eq "SKILL.md") {
        $sourcePath = Split-Path $path -Parent
        $contentFile = $path
    }

    $rel = $sourcePath.Substring($SKILLS_DIR.Length + 1)
    Write-Host "${CYAN}Skill:${NC} $rel"

    # Extract description
    $desc = Get-SkillDescription $contentFile
    if ($desc) {
        Write-Host "${GREEN}Description:${NC} $desc"
    } else {
        Write-Host "${GREEN}Description:${NC} (none)"
    }

    # Content preview (skip YAML frontmatter)
    Write-Host ""
    Write-Host "${DIM}Content preview:${NC}"
    $lines = Get-Content $contentFile -Encoding UTF8 -ErrorAction SilentlyContinue
    $inFrontmatter = $false
    $shown = 0
    $skippedFrontmatter = $false
    foreach ($line in $lines) {
        if ($shown -ge 10) { break }
        if (-not $skippedFrontmatter) {
            if ($line -match '^---' -and -not $inFrontmatter) { $inFrontmatter = $true; continue }
            if ($line -match '^---' -and $inFrontmatter) { $skippedFrontmatter = $true; continue }
            if ($inFrontmatter) { continue }
            $skippedFrontmatter = $true
        }
        Write-Host "  $line"
        $shown++
    }
    if ($lines.Count -gt ($shown + 5)) { Write-Host "  ..." -ForegroundColor Gray }
}

# ==============================================================================
# Command: search (aligned with Bash: uses Get-AllSkillPaths, shows descriptions)
# ==============================================================================
function Invoke-Search($query) {
    if (-not $query) { Write-LogError "Please provide a search keyword"; return }
    Write-LogInfo "Searching for '$query'..."
    Write-Host ""

    $skillPaths = @(Get-AllSkillPaths)
    $found = 0

    foreach ($sp in $skillPaths) {
        $displayName = Split-Path $sp -Leaf
        $rel = $sp.Substring($SKILLS_DIR.Length + 1)

        # Get content file for description
        $contentFile = $sp
        if (Test-Path $sp -PathType Container) {
            $contentFile = Join-Path $sp "SKILL.md"
        }
        $desc = Get-SkillDescription $contentFile

        # Search in path + description (case-insensitive)
        if ($rel -match [regex]::Escape($query) -or $desc -match [regex]::Escape($query)) {
            Write-Host "  ${GREEN}*${NC} ${CYAN}${displayName}${NC} ${DIM}($rel)${NC}"
            if ($desc) {
                # Truncate long descriptions
                $truncated = if ($desc.Length -gt 100) { $desc.Substring(0, 97) + "..." } else { $desc }
                Write-Host "    $truncated"
            }
            $found++
        }
    }

    if ($found -eq 0) { Write-LogWarn "No matches found." }
    else {
        Write-Host ""
        Write-LogInfo "Found $found matching skill(s)."
    }
}

# ==============================================================================
# Helper: Install a skill (file or folder) to all detected IDEs (global)
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
                New-Item -ItemType SymbolicLink -Path $dest -Target $source -Force -ErrorAction Stop | Out-Null
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
# Helper: Install skill to project (.claude/skills + IDE bridge)
# ==============================================================================
function Install-ToProject($skillPath, $projectPath) {
    if (-not $projectPath) { $projectPath = Get-Location }
    $projectPath = (Resolve-Path $projectPath -ErrorAction SilentlyContinue).Path
    if (-not $projectPath) { $projectPath = Get-Location }

    $filename = Split-Path $skillPath -Leaf

    # Create .claude/skills in project
    $claudeSkills = Join-Path $projectPath ".claude\skills"
    if (-not (Test-Path $claudeSkills)) {
        New-Item -Path $claudeSkills -ItemType Directory -Force | Out-Null
    }

    $target = Join-Path $claudeSkills $filename

    # Install to .claude/skills (symlink with copy fallback)
    try {
        if (Test-Path $target) { Remove-Item $target -Force -Recurse -ErrorAction SilentlyContinue }
        New-Item -ItemType SymbolicLink -Path $target -Target $skillPath -Force -ErrorAction Stop | Out-Null
    } catch {
        try {
            if (Test-Path $skillPath -PathType Container) {
                Copy-Item -Path $skillPath -Destination $target -Recurse -Force -ErrorAction Stop
            } else {
                Copy-Item -Path $skillPath -Destination $target -Force -ErrorAction Stop
            }
        } catch {
            Write-LogError "Failed to install to project: $filename"
            return
        }
    }
    Write-LogSuccess "Installed to project: .claude/skills/$filename"

    # Bridge to other IDEs in the project
    Invoke-BridgeIdeRules $projectPath $filename $target
}

# ==============================================================================
# Helper: Bridge IDE rules (project mode)
# ==============================================================================
function Invoke-BridgeIdeRules($projectRoot, $skillName, $sourceFile) {
    $ideDirs = @(
        @{ DirName = ".cursor";   Name = "Cursor" },
        @{ DirName = ".windsurf"; Name = "Windsurf" },
        @{ DirName = ".trae";     Name = "TRAE" },
        @{ DirName = ".trae-cn";  Name = "TRAE CN" },
        @{ DirName = ".agent";    Name = "Antigravity" },
        @{ DirName = ".agents";   Name = "Generic Agents" },
        @{ DirName = ".copilot";  Name = "Copilot" }
    )

    foreach ($ide in $ideDirs) {
        $ideDir = Join-Path $projectRoot $ide.DirName
        if (Test-Path $ideDir) {
            $skillsDir = Join-Path $ideDir "skills"
            if (-not (Test-Path $skillsDir)) {
                New-Item -Path $skillsDir -ItemType Directory -Force | Out-Null
            }
            $dest = Join-Path $skillsDir $skillName
            try {
                if (Test-Path $dest) { Remove-Item $dest -Force -Recurse -ErrorAction SilentlyContinue }
                New-Item -ItemType SymbolicLink -Path $dest -Target $sourceFile -Force -ErrorAction Stop | Out-Null
            } catch {
                try { Copy-Item -Path $sourceFile -Destination $dest -Force -Recurse -ErrorAction Stop } catch {}
            }
            Write-LogInfo "  Bridge ($($ide.Name)): $($ide.DirName)/skills/$skillName"
        }
    }
}

# ==============================================================================
# Helper: Execute skill installation (global or project dispatch)
# ==============================================================================
function Invoke-SkillInstallation($skillPath, $mode, $projectPath) {
    if ($mode -eq "project") {
        Install-ToProject $skillPath $projectPath
    } else {
        # Global install
        $filename = Split-Path $skillPath -Leaf
        # For folder skills (SKILL.md), show parent dir name
        if ($filename -eq "SKILL.md") { $filename = Split-Path (Split-Path $skillPath -Parent) -Leaf }
        $rel = $skillPath
        if ($skillPath.StartsWith($SKILLS_DIR)) {
            $rel = $skillPath.Substring($SKILLS_DIR.Length + 1)
        }
        $count = Install-SkillToIdes $skillPath
        if ($count -gt 0) {
            Write-LogSuccess "Installed ${CYAN}$filename${NC} ($rel)"
            $updated = [System.Collections.Generic.List[string]]::new()
            $targets = Get-IdeTargets
            foreach ($t in $targets) {
                if (Test-Path $t.Dir) { $updated.Add($t.Name) }
            }
            $ideList = [string]::Join(', ', $updated)
            Write-Host "  -> Synced to $count IDE(s): [${GREEN}$ideList${NC}]"
        } else {
            Write-LogWarn "No IDE directories found. Run 'ash init' first."
        }
    }
}

# ==============================================================================
# Helper: Download from GitHub
# ==============================================================================
function Install-FromGitHub($repoArg, $skillOption) {
    # Parse user/repo and optional subdir
    if ($repoArg -notmatch '^([a-zA-Z0-9_\-]+)/([a-zA-Z0-9_\-]+)(/(.*))?$') {
        Write-LogError "Invalid repository format. Use: user/repo or user/repo/path"
        return @()
    }
    $user = $Matches[1]
    $repo = $Matches[2]
    $subdir = $Matches[4]
    $userRepo = "$user/$repo"

    # Override subdir if --skill flag provided
    if ($skillOption) {
        if ($subdir) {
            Write-LogWarn "Path conflict: URL contains subdir '$subdir' but --skill '$skillOption' also specified."
            Write-LogWarn "Using --skill parameter."
        }
        $subdir = $skillOption
    }

    # Security check for untrusted orgs
    if ($user -notin $TRUSTED_ORGS) {
        Write-LogWarn "Security warning: Installing from third-party org '$user'."
        Write-LogWarn "Source: https://github.com/$userRepo"
        Write-Host "${YELLOW}Please verify you trust this author and review code after install.${NC}"
        $confirm = Read-Host "Continue? [y/N]"
        if ($confirm -ne "y" -and $confirm -ne "Y") {
            Write-LogError "Installation cancelled."
            return @()
        }
    }

    Write-LogInfo "Downloading from GitHub: ${CYAN}${userRepo}${NC} ..."
    if ($subdir) { Write-LogInfo "  Target subdir: $subdir" }

    # Clone to temp dir
    $tmpDir = Join-Path $ASH_HOME "tmp\$([System.DateTime]::Now.Ticks)"
    New-Item -Path $tmpDir -ItemType Directory -Force | Out-Null
    $cloneUrl = "https://github.com/$userRepo.git"

    git clone --depth 1 $cloneUrl $tmpDir 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "GitHub clone failed. Check repository URL or network connection."
        Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
        return @()
    }

    # Locate target
    $sourcePath = $tmpDir
    if ($subdir) {
        $sourcePath = Join-Path $tmpDir $subdir
        if (-not (Test-Path $sourcePath)) {
            Write-LogError "Subdir not found in repository: '$subdir'"
            Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
            return @()
        }
    }

    # Discover skills
    $installTargets = [System.Collections.Generic.List[string]]::new()

    # Check if current path is a valid skill
    $skillMd = Join-Path $sourcePath "SKILL.md"
    if (Test-Path $skillMd) {
        $installTargets.Add($sourcePath)
    } else {
        # Monorepo discovery: scan for SKILL.md files
        Write-LogInfo "Scanning repository for skills..."
        $candidates = @(Get-ChildItem -Path $sourcePath -Filter "SKILL.md" -Recurse -Depth 4 -File)

        if ($candidates.Count -eq 0) {
            # Also check for standalone .md files
            $mdFiles = @(Get-ChildItem -Path $sourcePath -Filter "*.md" -Depth 2 -File |
                Where-Object { $_.Name -ne "README.md" })
            if ($mdFiles.Count -gt 0) {
                foreach ($md in $mdFiles) { $installTargets.Add($md.FullName) }
            } else {
                Write-LogWarn "No skills found in repository."
                Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
                return @()
            }
        } else {
            Write-LogInfo "Found $($candidates.Count) skill(s) in repository:"
            for ($i = 0; $i -lt $candidates.Count; $i++) {
                $rel = $candidates[$i].DirectoryName.Substring($sourcePath.Length).TrimStart('\', '/')
                if (-not $rel) { $rel = "." }
                Write-Host "  [$($i+1)] $rel"
            }

            # Interactive selection
            Write-Host ""
            $selection = Read-Host "Select skills to install (comma-separated numbers, 'a' for all, Enter to cancel)"
            if ([string]::IsNullOrEmpty($selection)) {
                Write-LogWarn "Installation cancelled."
                Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
                return @()
            }

            if ($selection -eq "a" -or $selection -eq "A") {
                foreach ($c in $candidates) { $installTargets.Add($c.DirectoryName) }
            } else {
                $indices = $selection -split ',' | ForEach-Object { $_.Trim() }
                foreach ($idx in $indices) {
                    $num = 0
                    if ([int]::TryParse($idx, [ref]$num) -and $num -ge 1 -and $num -le $candidates.Count) {
                        $installTargets.Add($candidates[$num - 1].DirectoryName)
                    }
                }
            }
        }
    }

    if ($installTargets.Count -eq 0) {
        Write-LogWarn "No skills selected for installation."
        Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue
        return @()
    }

    # Store to downloaded/ and return paths
    $downloadRoot = Join-Path $SKILLS_DIR "downloaded"
    if (-not (Test-Path $downloadRoot)) { New-Item -Path $downloadRoot -ItemType Directory -Force | Out-Null }

    $installedPaths = [System.Collections.Generic.List[string]]::new()
    foreach ($src in $installTargets) {
        $skillName = Split-Path $src -Leaf
        if ($skillName -eq (Split-Path $tmpDir -Leaf)) { $skillName = $repo }

        if (Test-Path $src -PathType Container) {
            $destDir = Join-Path $downloadRoot $skillName
            if (Test-Path $destDir) { Remove-Item $destDir -Force -Recurse -ErrorAction SilentlyContinue }
            Copy-Item -Path $src -Destination $destDir -Recurse -Force
            $installedPaths.Add($destDir)
        } else {
            $destFile = Join-Path $downloadRoot (Split-Path $src -Leaf)
            Copy-Item -Path $src -Destination $destFile -Force
            $installedPaths.Add($destFile)
        }
        Write-LogSuccess "Downloaded: ${CYAN}$skillName${NC}"
    }

    # Cleanup
    Remove-Item $tmpDir -Force -Recurse -ErrorAction SilentlyContinue

    return $installedPaths
}

# ==============================================================================
# Helper: Import from Vercel/Agents (~/.agents/skills)
# ==============================================================================
function Import-FromVercel {
    $vercelDir = $AGENTS_SKILLS_DIR
    if (-not (Test-Path $vercelDir)) { return }

    # Find new skills not in ~/.ash/skills
    $newSkills = [System.Collections.Generic.List[string]]::new()
    $items = Get-ChildItem -Path $vercelDir -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $name = $item.Name
        # Check if already exists in ASH
        $existing = Resolve-SkillPath $name
        if ($null -eq $existing) {
            $newSkills.Add($item.FullName)
        }
    }

    if ($newSkills.Count -eq 0) { return }

    Write-Host ""
    Write-LogInfo "Discovered $($newSkills.Count) new skill(s) from Vercel/Agents:"
    foreach ($s in $newSkills) {
        Write-Host "  ${GREEN}+${NC} $(Split-Path $s -Leaf)"
    }
    Write-Host ""
    Write-Host "${YELLOW}Import these skills into ASH and distribute to all IDEs?${NC}"
    $confirm = Read-Host "Confirm import? [Y/n]"
    if ($confirm -eq "n" -or $confirm -eq "N") {
        Write-Host "Skipped import."
        return
    }

    $successCount = 0
    foreach ($source in $newSkills) {
        $name = Split-Path $source -Leaf
        $target = Join-Path $SKILLS_DIR $name
        try {
            Copy-Item -Path $source -Destination $target -Recurse -Force -ErrorAction Stop
            Write-LogSuccess "Imported: $name"
            Install-SkillToIdes $target | Out-Null
            $successCount++
        } catch {
            Write-LogError "Import failed: $name"
        }
    }

    if ($successCount -gt 0) {
        Write-Host ""
        Write-LogSuccess "Successfully imported and distributed $successCount skill(s)!"
        Write-Host "Tip: use ${CYAN}ash info <name>${NC} to view them."
    }
}

# ==============================================================================
# Command: install (full: --all, -p/--project, user/repo, --skill)
# ==============================================================================
function Invoke-Install {
    param($AllArgs)

    # Parse arguments
    $skillName = $null
    $mode = "global"
    $projectPath = $null
    $skillOption = $null

    $i = 0
    while ($i -lt $AllArgs.Count) {
        $a = $AllArgs[$i]
        switch -Regex ($a) {
            '^(-p|--project)$' {
                $mode = "project"
                # Next arg may be a path (if it doesn't start with -)
                if (($i + 1) -lt $AllArgs.Count -and $AllArgs[$i + 1] -notmatch '^-') {
                    $projectPath = $AllArgs[$i + 1]
                    $i++
                }
            }
            '^--skill$' {
                if (($i + 1) -lt $AllArgs.Count) {
                    $skillOption = $AllArgs[$i + 1]
                    $i++
                }
            }
            default {
                if ($null -eq $skillName) { $skillName = $a }
            }
        }
        $i++
    }

    if (-not $skillName) { Write-LogError "Please specify skill name (e.g.: pdf, --all, or user/repo)"; return }

    # Auto-init check
    if ($mode -eq "global") { Test-AndAutoInit }

    # --all: batch install
    if ($skillName -eq "--all") {
        $skillPaths = @(Get-AllSkillPaths)
        Write-LogInfo "Batch installing $($skillPaths.Count) skills to all detected IDEs..."
        Write-Host ""
        $total = 0

        foreach ($sp in $skillPaths) {
            $rel = $sp.Substring($SKILLS_DIR.Length + 1)
            $displayName = Split-Path $sp -Leaf
            Write-Host "  ${GREEN}*${NC} ${CYAN}${displayName}${NC} ${DIM}($rel)${NC}"
            if ($mode -eq "project") {
                Invoke-SkillInstallation $sp $mode $projectPath
            } else {
                $count = Install-SkillToIdes $sp
                $total += $count
            }
        }

        if ($mode -ne "project") {
            $updated_ides = [System.Collections.Generic.List[string]]::new()
            $targets = Get-IdeTargets
            foreach ($t in $targets) {
                if (Test-Path $t.Dir) { $updated_ides.Add($t.Name) }
            }
            Write-Host ""
            Write-LogSuccess "Batch install complete!"
            $ideList = [string]::Join(', ', $updated_ides)
            Write-Host "  ${CYAN}Synced IDEs:${NC} $ideList"
            Write-Host "  ${CYAN}Total links:${NC} $total"
        }
        return
    }

    # GitHub: user/repo pattern
    if ($skillName -match '^[a-zA-Z0-9_\-]+/[a-zA-Z0-9_\-]+') {
        $downloadedPaths = @(Install-FromGitHub $skillName $skillOption)
        foreach ($dp in $downloadedPaths) {
            if ($dp) {
                Invoke-SkillInstallation $dp $mode $projectPath
            }
        }
        return
    }

    # Local skill
    $path = Resolve-SkillPath $skillName
    if ($null -eq $path) { Write-LogError "Skill not found: $skillName"; Suggest-SkillName $skillName; return }
    if ($path -eq "MULTIPLE") { return }

    Invoke-SkillInstallation $path $mode $projectPath
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
                break
            }
        }
    }
    if ($total -eq 0) { Write-LogWarn "Skill not found in any IDE: $name"; Suggest-SkillName $name }
}

# ==============================================================================
# Command: status (enhanced: --full, IDE filtering, fuzzy match)
# ==============================================================================
function Invoke-Status {
    param($AllArgs)

    $fullMode = $false
    $targetIde = $null

    foreach ($a in $AllArgs) {
        if ($a -eq "--full" -or $a -eq "-v" -or $a -eq "--list") { $fullMode = $true }
        else { $targetIde = $a; $fullMode = $true }
    }

    Write-LogInfo "Installed skills status:"
    if (-not $fullMode) {
        Write-Host "${DIM}Tip: use 'ash status --full' or 'ash status <ide_name>' for details${NC}"
    }
    Write-Host ""

    $targets = Get-IdeTargets
    $matchedAny = $false

    foreach ($t in $targets) {
        # IDE filtering (fuzzy, case-insensitive)
        if ($targetIde) {
            if ($t.Name.ToLower() -notlike "*$($targetIde.ToLower())*") { continue }
            $matchedAny = $true
        }

        if (Test-Path $t.Dir) {
            $items = @(Get-ChildItem -Path $t.Dir -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne "README.md" })

            if ($fullMode) {
                Write-Host "  ${CYAN}$($t.Name) ($($t.Dir)):${NC}"
                if ($items.Count -eq 0) {
                    Write-Host "    ${YELLOW}(none)${NC}"
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
                Write-Host ""
            } else {
                # Compact mode
                $linkCount = ($items | Where-Object { $_.Attributes -match "ReparsePoint" -or $true }).Count
                if ($linkCount -gt 0) {
                    Write-Host "  ${GREEN}*${NC} ${CYAN}$($t.Name):${NC} ${GREEN}$linkCount${NC} skill(s) installed"
                } else {
                    Write-Host "  ${DIM}o $($t.Name):${NC} ${YELLOW}no skills installed${NC}"
                }
            }
        }
    }

    if ($targetIde -and -not $matchedAny) {
        Write-LogError "IDE not found: '$targetIde'"
        $names = ($targets | ForEach-Object { $_.Name }) -join ", "
        Write-Host "Available: ${DIM}$names${NC}"
    }
}

# ==============================================================================
# Command: clean (remove all skill links from IDE directories)
# ==============================================================================
function Invoke-Clean($target) {
    if (-not $target) {
        Write-Host "Usage: ash clean <ide_name> or ash clean --all"
        $names = (Get-IdeTargets | ForEach-Object { $_.Name }) -join ", "
        Write-Host "Available IDEs: [$names]"
        return
    }

    Write-Host "${YELLOW}Warning: This will remove all skill links from target directories (source files are not deleted).${NC}"
    $confirm = Read-Host "Continue? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Cancelled."
        return
    }

    $targets = Get-IdeTargets
    $cleanedAny = $false

    foreach ($t in $targets) {
        # Filter: --all or fuzzy match
        if ($target -ne "--all") {
            if ($t.Name.ToLower() -ne $target.ToLower()) { continue }
        }

        if (-not (Test-Path $t.Dir)) { continue }

        # Count and remove symlinks only (safe: don't delete manually placed files)
        $links = @(Get-ChildItem -Path $t.Dir -ErrorAction SilentlyContinue |
            Where-Object { $_.Attributes -match "ReparsePoint" })

        if ($links.Count -gt 0) {
            foreach ($link in $links) {
                Remove-Item $link.FullName -Force -ErrorAction SilentlyContinue
            }
            Write-LogSuccess "Cleaned $($t.Name) skill directory ($($links.Count) links removed)."
            $cleanedAny = $true
        } else {
            # Also clean copies if no symlinks found
            $copies = @(Get-ChildItem -Path $t.Dir -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne "README.md" })
            if ($copies.Count -gt 0) {
                foreach ($c in $copies) {
                    Remove-Item $c.FullName -Force -Recurse -ErrorAction SilentlyContinue
                }
                Write-LogSuccess "Cleaned $($t.Name) skill directory ($($copies.Count) items removed)."
                $cleanedAny = $true
            } else {
                Write-Host "${DIM}  $($t.Name): already empty.${NC}"
            }
        }
    }

    if ($target -ne "--all") {
        $matched = $targets | Where-Object { $_.Name.ToLower() -eq $target.ToLower() }
        if (-not $matched) {
            Write-LogError "IDE not found: '$target'"
            $names = ($targets | ForEach-Object { $_.Name }) -join ", "
            Write-Host "Available: $names"
        }
    }

    if (-not $cleanedAny) {
        Write-LogWarn "No cleanup performed (directories empty or not found)."
    }
}

# ==============================================================================
# Command: sync (with Vercel import)
# ==============================================================================
function Invoke-Sync {
    Write-LogInfo "Syncing skills..."

    # Step 1: Detect & import NEW skills from Vercel/Agents (~/.agents/skills)
    # Must run BEFORE redistribution, otherwise our own copies overwrite new downloads
    Import-FromVercel

    # Step 2: Git pull + sync source skills to ~/.ash/skills
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
            Write-LogSuccess "Source skills synced to $SKILLS_DIR"
        }
    } else {
        Write-LogWarn "Not in a Git repository. Skipping git sync."
        Write-Host "Tip: Clone the repo and run install.ps1, or use 'npm update -g askill'" -ForegroundColor Cyan
    }

    # Step 3: Re-distribute ALL skills from ~/.ash/skills to every IDE directory
    # (On Windows, copies must be refreshed since symlinks often require admin)
    Write-LogInfo "Re-distributing skills to all IDE directories..."
    $allSkills = Get-AllSkillPaths
    $distCount = 0
    foreach ($sp in $allSkills) {
        $result = Install-SkillToIdes $sp
        if ($result -gt 0) { $distCount++ }
    }
    if ($distCount -gt 0) {
        Write-LogSuccess "Distributed $distCount skill(s) to IDE directories."
    } else {
        Write-LogInfo "No skills to distribute (IDE directories may not be initialized)."
    }

    Write-Host ""
    Write-LogSuccess "Sync complete! Run '${CYAN}ash list${NC}' to see latest skills."
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
# Entry Point (enhanced argument parsing)
# ==============================================================================
$cmd = $args[0]
$restArgs = @()
if ($args.Count -gt 1) {
    $restArgs = @($args[1..($args.Count - 1)])
}
$param = if ($restArgs.Count -gt 0) { $restArgs[0] } else { $null }

switch ($cmd) {
    "list"      { Invoke-List }
    "info"      { Invoke-Info $param }
    "install"   { Invoke-Install -AllArgs $restArgs }
    "add"       { Invoke-Install -AllArgs $restArgs }
    "uninstall" { Invoke-Uninstall $param }
    "search"    { Invoke-Search $param }
    "status"    { Invoke-Status -AllArgs $restArgs }
    "sync"      { Invoke-Sync }
    "init"      { Invoke-Init }
    "clean"     { Invoke-Clean $param }
    "help"      { Show-Help }
    "-h"        { Show-Help }
    "--help"    { Show-Help }
    "-v"        { Write-Host "${CYAN}ASH (Awesome-Skills-Hub) v${VERSION}${NC}" }
    "--version" { Write-Host "${CYAN}ASH (Awesome-Skills-Hub) v${VERSION}${NC}" }
    ""          { Show-Help }
    default     { Invoke-DidYouMean $cmd }
}
