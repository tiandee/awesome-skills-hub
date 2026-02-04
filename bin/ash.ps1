# ash.ps1 - Awesome Skills Hub CLI for Windows
# A PowerShell implementation for managing AI IDE skills.

$SKILLS_HUB_HOME = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SKILLS_DIR = Join-Path $SKILLS_HUB_HOME "skills"
$BIN_DIR = Join-Path $SKILLS_HUB_HOME "bin"

# Define Paths for Windows
$AGENT_SKILLS_DIR = Join-Path $env:USERPROFILE ".agent\skills"
$CURSOR_SKILLS_DIR = Join-Path $env:USERPROFILE ".cursor\skills"
$TRAE_SKILLS_DIR = Join-Path $env:USERPROFILE ".trae\skills"
$TRAE_CN_SKILLS_DIR = Join-Path $env:USERPROFILE ".trae-cn\skills"
$WINDSURF_SKILLS_DIR = Join-Path $env:USERPROFILE ".codeium\windsurf\skills"
$COPILOT_SKILLS_DIR = Join-Path $env:USERPROFILE ".copilot\skills"
$CLAUDE_SKILLS_DIR = Join-Path $env:USERPROFILE ".claude\skills"

# ANSI Colors for PowerShell (Ensure compatibility with Windows Terminal)
$RED = "`e[31m"
$GREEN = "`e[32m"
$YELLOW = "`e[33m"
$BLUE = "`e[34m"
$MAGENTA = "`e[35m"
$CYAN = "`e[36m"
$DIM = "`e[2m"
$NC = "`e[0m"

function Write-LogInfo($msg) { Write-Host "[$BLUE信息$NC] $msg" }
function Write-LogSuccess($msg) { Write-Host "[$GREEN成功$NC] $msg" }
function Write-LogError($msg) { Write-Host "[$RED错误$NC] $msg" }
function Write-LogWarn($msg) { Write-Host "[$YELLOW警告$NC] $msg" }

function Get-SkillFiles {
    Get-ChildItem -Path $SKILLS_DIR -Filter "*.md" -Recurse | Where-Object { $_.Name -ne "README.md" }
}

function Show-Help {
    Write-Host @"
$CYAN
   ___   _____ _   _ 
  / _ \ / ____| | | |
 | |_| | (___ | |_| |
 |  _  |\___ \|  _  |
 | | | |____) | | | |
 |_| |_|_____/|_| |_|
$NC
Awesome Skills Hub (ASH) - 跨平台 AI 技能管理工具

用法: ash <命令> [参数]

核心命令:
  list              列出所有可用技能
  info <技能名>      查看技能详细描述与触发词
  search <关键词>    搜索技能
  install <技能名>   安装技能到所有 IDE (支持 --all)
  uninstall <名称>   卸载技能 (支持 --all)
  status            查看当前安装映射关系
  sync              从远程 Git 仓库同步最新技能
  init              初始化 IDE 技能目录映射
  help              显示此帮助信息

示例:
  ash install pdf
  ash install --all
  ash info docx
"@
}

function Invoke-List {
    Write-LogInfo "可用技能列表:"
    echo ""
    $categories = Get-ChildItem -Path $SKILLS_DIR -Directory
    foreach ($cat in $categories) {
        $files = Get-ChildItem -Path $cat.FullName -Filter "*.md" | Where-Object { $_.Name -ne "README.md" }
        if ($files.Count -gt 0) {
            Write-Host "[$($cat.Name)]" -ForegroundColor Yellow
            foreach ($f in $files) {
                Write-Host "  • $($f.Name)"
            }
            echo ""
        }
    }
    $all = Get-SkillFiles
    Write-LogInfo "共 $($all.Count) 个技能可用"
    Write-Host "提示: 使用 'ash info <技能名>' 查看详细描述" -ForegroundColor Cyan
}

function Resolve-SkillPath($name) {
    if ($name.EndsWith(".md")) { $name = $name.Substring(0, $name.Length - 3) }
    $matches = Get-SkillFiles | Where-Object { $_.BaseName -eq $name -or $_.Name -eq $name }
    
    if ($matches.Count -eq 0) { return $null }
    if ($matches.Count -gt 1) {
        Write-LogWarn "找到多个重名技能，请指定分类路径:"
        foreach ($m in $matches) {
            $rel = $m.FullName.Replace("$SKILLS_DIR\", "")
            Write-Host "  • ash install $rel"
        }
        return "MULTIPLE"
    }
    return $matches[0].FullName
}

function Invoke-Info($name) {
    if (-not $name) { Write-LogError "请指定技能名称"; return }
    $path = Resolve-SkillPath $name
    if ($null -eq $path) { Write-LogError "技能未找到: $name"; return }
    if ($path -eq "MULTIPLE") { return }

    $content = Get-Content $path -Raw
    $filename = Split-Path $path -Leaf
    Write-Host "[$CYAN$filename$NC]"
    echo "------------------------------------------"
    
    # Simple YAML frontmatter parser for PS
    if ($content -match "(?s)^---\r?\n(.*?)\r?\n---") {
        $yaml = $Matches[1]
        Write-Host "技能描述: " -NoNewLine; $yaml -match "description: (.*)" | Out-Null; Write-Host $Matches[1] -ForegroundColor Green
        Write-Host "触发重点: " -NoNewLine; $yaml -match "triggers: (.*)" | Out-Null; Write-Host $Matches[1] -ForegroundColor Yellow
    }
    echo ""
    Write-Host "内容预览:" -ForegroundColor Cyan
    $lines = Get-Content $path | Select-Object -First 15
    foreach ($l in $lines) { Write-Host "  $l" }
    if ((Get-Content $path).Count -gt 15) { Write-Host "  ..." -ForegroundColor Gray }
}

function Install-SkillFile($source) {
    $filename = Split-Path $source -Leaf
    $installed = 0
    $targets = @(
        @{ Name = "Antigravity"; Dir = $AGENT_SKILLS_DIR },
        @{ Name = "Cursor"; Dir = $CURSOR_SKILLS_DIR },
        @{ Name = "TRAE"; Dir = $TRAE_SKILLS_DIR },
        @{ Name = "TRAE CN"; Dir = $TRAE_CN_SKILLS_DIR },
        @{ Name = "Windsurf"; Dir = $WINDSURF_SKILLS_DIR },
        @{ Name = "Copilot"; Dir = $COPILOT_SKILLS_DIR },
        @{ Name = "Claude"; Dir = $CLAUDE_SKILLS_DIR }
    )

    foreach ($t in $targets) {
        if (Test-Path $t.Dir) {
            $dest = Join-Path $t.Dir $filename
            # Use cmd /c mklink if New-Item fails for perms
            try {
                if (Test-Path $dest) { Remove-Item $dest -Force }
                New-Item -ItemType SymbolicLink -Path $dest -Target $source -Force | Out-Null
                $installed++
            } catch {
                # Fallback to hard link or copy if symlink perms missing? 
                # For "perfect support", we should advise admin or Developer Mode.
            }
        }
    }
    return $installed
}

function Invoke-Install($name) {
    if (-not $name) { Write-LogError "请指定参数 (例如: pdf 或 --all)"; return }

    if ($name -eq "--all") {
        $files = Get-SkillFiles | Sort-Object Name
        Write-LogInfo "正在批量安装 $($files.Count) 个技能到所有检测到的 IDE..."
        echo ""
        $total = 0
        $updated_ides = New-Object System.Collections.Generic.List[string]

        foreach ($f in $files) {
            $rel = $f.FullName.Replace("$SKILLS_DIR\", "")
            Write-Host "  $GREEN•$NC $CYAN$($f.Name)$NC ${DIM}($rel)$NC"
            $count = Install-SkillFile $f.FullName
            $total += $count
        }

        # Recap IDEs
        $ides = @("Antigravity", "Cursor", "TRAE", "Windsurf", "Copilot", "Claude", "Trae CN")
        $dirs = @($AGENT_SKILLS_DIR, $CURSOR_SKILLS_DIR, $TRAE_SKILLS_DIR, $WINDSURF_SKILLS_DIR, $COPILOT_SKILLS_DIR, $CLAUDE_SKILLS_DIR, $TRAE_CN_SKILLS_DIR)
        for ($i=0; $i -lt $ides.Length; $i++) {
            if (Test-Path $dirs[$i]) { $updated_ides.Add($ides[$i]) }
        }

        echo ""
        Write-LogSuccess "批量安装完成！"
        Write-Host "  ${CYAN}已同步 IDE:${NC} $([string]::Join("、", $updated_ides))"
        Write-Host "  ${CYAN}总链接数:${NC} $total"
        return
    }

    $path = Resolve-SkillPath $name
    if ($null -eq $path) { Write-LogError "技能未找到: $name"; return }
    if ($path -eq "MULTIPLE") { return }

    $count = Install-SkillFile $path
    if ($count -gt 0) {
        Write-LogSuccess "已安装至 $count 个 IDE 环境。"
    } else {
        Write-LogWarn "未找到可安装的目标目录，请先运行 'ash init'"
    }
}

function Invoke-Uninstall($name) {
    if (-not $name) { Write-LogError "请指定参数 (例如: pdf 或 --all)"; return }

    $targets = @(
        @{ Name = "Antigravity"; Dir = $AGENT_SKILLS_DIR },
        @{ Name = "Cursor"; Dir = $CURSOR_SKILLS_DIR },
        @{ Name = "TRAE"; Dir = $TRAE_SKILLS_DIR },
        @{ Name = "TRAE CN"; Dir = $TRAE_CN_SKILLS_DIR },
        @{ Name = "Windsurf"; Dir = $WINDSURF_SKILLS_DIR },
        @{ Name = "Copilot"; Dir = $COPILOT_SKILLS_DIR },
        @{ Name = "Claude"; Dir = $CLAUDE_SKILLS_DIR }
    )

    if ($name -eq "--all") {
        Write-LogInfo "正在从所有 IDE 卸载所有技能..."
        $total = 0
        foreach ($t in $targets) {
            if (Test-Path $t.Dir) {
                $count = 0
                $removed = New-Object System.Collections.Generic.List[string]
                $links = Get-ChildItem -Path $t.Dir -Filter "*.md"
                foreach ($l in $links) {
                    # Check if it's a symbolic link in PS
                    if ($l.Attributes -match "ReparsePoint") {
                        Remove-Item $l.FullName -Force
                        $removed.Add($l.Name)
                        $count++
                        $total++
                    }
                }
                if ($count -gt 0) {
                    Write-Host "  $CYAN$($t.Name):$NC 已移除 $GREEN$count$NC 个技能 [${DIM}$([string]::Join("、", $removed))$NC]"
                }
            }
        }
        echo ""
        if ($total -gt 0) { Write-LogSuccess "全量卸载完成，共移除了 $total 个链接。" }
        else { Write-LogWarn "未发现任何已安装的技能链接。" }
        return
    }

    # Single uninstall
    $filename = if ($name.EndsWith(".md")) { $name } else { "$name.md" }
    $total = 0
    foreach ($t in $targets) {
        $path = Join-Path $t.Dir $filename
        if (Test-Path $path) {
            Remove-Item $path -Force
            $total++
        }
    }
    if ($total -gt 0) { Write-LogSuccess "已从 $total 个环境移除 $filename。" }
    else { Write-LogError "未在任何环境中找到技能: $filename" }
}

function Invoke-Status {
    Write-LogInfo "当前技能安装状态:"
    echo ""
    $targets = @(
        @{ Name = "Antigravity"; Dir = $AGENT_SKILLS_DIR },
        @{ Name = "Cursor"; Dir = $CURSOR_SKILLS_DIR },
        @{ Name = "TRAE"; Dir = $TRAE_SKILLS_DIR },
        @{ Name = "TRAE CN"; Dir = $TRAE_CN_SKILLS_DIR },
        @{ Name = "Windsurf"; Dir = $WINDSURF_SKILLS_DIR },
        @{ Name = "Copilot"; Dir = $COPILOT_SKILLS_DIR },
        @{ Name = "Claude"; Dir = $CLAUDE_SKILLS_DIR }
    )
    foreach ($t in $targets) {
        if (Test-Path $t.Dir) {
            Write-Host "  $($t.Name) ($($t.Dir)):" -ForegroundColor Cyan
            $links = Get-ChildItem -Path $t.Dir -Filter "*.md" | Where-Object { $_.Attributes -match "ReparsePoint" }
            if ($links.Count -eq 0) {
                Write-Host "    • (无)" -ForegroundColor Gray
            } else {
                foreach ($l in $links) {
                    # Get target of symlink in PS
                    $target = (Get-Item $l.FullName).Target
                    Write-Host "    • $($l.Name) -> $target"
                }
            }
        }
    }
}

function Invoke-Sync {
    Write-LogInfo "正在从远程仓库同步技能..."
    git pull origin main
    Write-LogSuccess "同步完成！您可以运行 'ash list' 查看最新技能。"
}

function Invoke-Init {
    Write-LogInfo "正在初始化 IDE 技能目录..."
    $dirs = @($AGENT_SKILLS_DIR, $CURSOR_SKILLS_DIR, $TRAE_SKILLS_DIR, $TRAE_CN_SKILLS_DIR, $WINDSURF_SKILLS_DIR, $COPILOT_SKILLS_DIR, $CLAUDE_SKILLS_DIR)
    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) {
            New-Item -Path $d -ItemType Directory -Force | Out-Null
            Write-LogSuccess "已创建目录: $d"
        } else {
            Write-LogInfo "目录已存在: $d"
        }
    }
}

function Invoke-Search($query) {
    if (-not $query) { Write-LogError "请提供搜索关键词"; return }
    Write-LogInfo "正在搜索关键词 '$query'..."
    echo ""
    $files = Get-SkillFiles
    $found = 0
    foreach ($f in $files) {
        $content = Get-Content $f.FullName -Raw
        if ($f.Name -match $query -or $content -match $query) {
            Write-Host "  • $($f.Name)" -ForegroundColor Green -NoNewLine
            Write-Host " ($($f.FullName.Replace("$SKILLS_DIR\", "")))" -ForegroundColor Gray
            $found++
        }
    }
    if ($found -eq 0) { Write-LogWarn "未找到匹配项。" }
    else { Write-LogInfo "找到 $found 个相关技能。" }
}

function Invoke-DidYouMean($cmd) {
    $commands = @("list", "info", "install", "uninstall", "search", "status", "sync", "init", "help")
    # Simple distance? For now just check common typos
    $typos = @{
        "ls" = "list"; "l" = "list"; "serch" = "search"; "find" = "search";
        "intall" = "install"; "unintall" = "uninstall"; "rm" = "uninstall";
        "stat" = "status"; "st" = "status"
    }
    if ($typos.ContainsKey($cmd)) {
        $suggest = $typos[$cmd]
        Write-LogWarn "未知命令 '$cmd'。您是不是想输入 '$suggest'?"
        return
    }
    Write-LogError "未知命令 '$cmd'。使用 'ash help' 查看帮助。"
}

# Entry Point
$cmd = $args[0]
$param = $args[1]

switch ($cmd) {
    "list"      { Invoke-List }
    "info"      { Invoke-Info $param }
    "install"   { Invoke-Install $param }
    "uninstall" { Invoke-Uninstall $param }
    "search"    { Invoke-Search $param }
    "status"    { Invoke-Status }
    "sync"      { Invoke-Sync }
    "init"      { Invoke-Init }
    "help"      { Show-Help }
    ""          { Show-Help }
    default     { Invoke-DidYouMean $cmd }
}
