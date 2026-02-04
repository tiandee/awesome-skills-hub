#!/bin/bash
# One-step installer for Awesome-Skills-Hub (ASH) v1.1.0

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[信息]${NC} $1"; }
log_success() { echo -e "${GREEN}[成功]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[警告]${NC} $1"; }
log_error() { echo -e "${RED}[错误]${NC} $1"; }

log_info "正在安装 Awesome-Skills-Hub (ASH)..."

# 1. 自动检测项目 root 目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
ASH_BIN="$PROJECT_ROOT/bin/ash"

# 2. 赋予执行权限
chmod +x "$ASH_BIN"

# 3. 初始化全局环境
log_info "正在初始化全局配置目录 (~/.ash)..."
mkdir -p "$HOME/.ash/skills"
cp -r "$PROJECT_ROOT/skills/"* "$HOME/.ash/skills/"
"$ASH_BIN" init

# 4. 尝试创建系统软链接 (免 source 方案)
log_info "尝试创建系统级软链接 (可能需要 sudo)..."
if [ -w "/usr/local/bin" ]; then
    ln -sf "$ASH_BIN" "/usr/local/bin/ash"
    log_success "已成功创建软链接: /usr/local/bin/ash"
else
    log_warn "/usr/local/bin 不可写，跳过软链接创建。将尝试配置 Shell 环境变量。"
fi

# 5. 自动配置环境变量 (PATH)
configure_path() {
    local shell_type="$1"
    local config_file="$2"
    local export_cmd="$3"

    if [ -f "$config_file" ]; then
        if ! grep -q "awesome-skills-hub/bin" "$config_file"; then
            log_info "正在为 $shell_type 配置环境变量 ($config_file)..."
            echo "" >> "$config_file"
            echo "# Awesome-Skills-Hub (ASH) PATH" >> "$config_file"
            echo "$export_cmd" >> "$config_file"
            log_success "$shell_type 环境变量已配置。"
            return 0
        else
            log_success "$shell_type 变量已在 $config_file 中配置。"
            return 1
        fi
    fi
    return 2
}

# 检测并配置常用 Shell
PATH_INJECTED=0

# ZSH
if configure_path "Zsh" "$HOME/.zshrc" "export PATH=\"\$PATH:$PROJECT_ROOT/bin\""; then PATH_INJECTED=1; fi

# Bash
if configure_path "Bash" "$HOME/.bashrc" "export PATH=\"\$PATH:$PROJECT_ROOT/bin\""; then PATH_INJECTED=1; fi
if [ -f "$HOME/.bash_profile" ]; then
    if configure_path "Bash (Profile)" "$HOME/.bash_profile" "export PATH=\"\$PATH:$PROJECT_ROOT/bin\""; then PATH_INJECTED=1; fi
fi

# Fish
if [ -d "$HOME/.config/fish" ]; then
    if configure_path "Fish" "$HOME/.config/fish/config.fish" "set -gx PATH \$PATH $PROJECT_ROOT/bin"; then PATH_INJECTED=1; fi
fi

if [ $PATH_INJECTED -eq 1 ]; then
    log_warn "提示: 请重启终端或运行 'source' 命令使配置生效。"
fi

echo ""
log_success "安装完成！"
if command -v ash >/dev/null 2>&1; then
    log_success "验证成功: 'ash' 命令现在已全局可用。"
else
    log_info "提示: 如果 'ash' 命令不可用，请尝试运行 'source ~/.zshrc' (或您对应的 Shell 配置文件)。"
fi
echo ""
