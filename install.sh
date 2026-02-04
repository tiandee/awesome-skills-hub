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

# 5. 配置 Shell 环境 (PATH & Autocompletion)
USER_SHELL=$(basename "$SHELL")
RC_FILE=""

case "$USER_SHELL" in
    zsh)
        RC_FILE="$HOME/.zshrc"
        
        # Install Zsh completion
        ZSH_COMP_DIR="$HOME/.ash/completions"
        mkdir -p "$ZSH_COMP_DIR"
        cp "$PROJECT_ROOT/bin/_ash" "$ZSH_COMP_DIR/"
        
        log_info "正在配置 Zsh 自动补全..."
        if [ -f "$RC_FILE" ]; then
            if ! grep -q "fpath+=($ZSH_COMP_DIR)" "$RC_FILE"; then
                echo  >> "$RC_FILE"
                echo "# ASH Autocompletion" >> "$RC_FILE"
                echo "fpath+=($ZSH_COMP_DIR)" >> "$RC_FILE"
                echo "autoload -U compinit && compinit" >> "$RC_FILE"
                log_success "Zsh 补全已配置。"
            else
                log_info "Zsh 补全已存在，跳过。"
            fi
        fi
        ;;
    bash)
        RC_FILE="$HOME/.bashrc"
        [ -f "$HOME/.bash_profile" ] && RC_FILE="$HOME/.bash_profile"
        
        # Install Bash completion
        cp "$PROJECT_ROOT/bin/ash.bash" "$HOME/.ash/"
        
        log_info "正在配置 Bash 自动补全..."
        if [ -f "$RC_FILE" ]; then
            if ! grep -q "source $HOME/.ash/ash.bash" "$RC_FILE"; then
                echo >> "$RC_FILE"
                echo "# ASH Autocompletion" >> "$RC_FILE"
                echo "source $HOME/.ash/ash.bash" >> "$RC_FILE"
                log_success "Bash 补全已配置。"
            else
                log_info "Bash 补全已存在，跳过。"
            fi
        fi
        ;;
    fish)
        RC_FILE="$HOME/.config/fish/config.fish"
        log_warn "暂未支持 Fish 自动补全，请等待后续更新。"
        ;;
    *)
        log_warn "未识别的 Shell: $USER_SHELL，请手动配置环境变量。"
        exit 0
        ;;
esac

# 配置 PATH (如果未配置)
if [ -n "$RC_FILE" ] && [ -f "$RC_FILE" ]; then
    if ! grep -q "$ASH_BIN" "$RC_FILE"; then
        echo "export PATH=\"\$PATH:$(dirname "$ASH_BIN")\"" >> "$RC_FILE"
        log_success "PATH 变量已添加到 $RC_FILE"
    else
        log_info "PATH 变量已存在于 $RC_FILE，跳过。"
    fi
fi

echo ""
log_success "安装完成！"
if command -v ash >/dev/null 2>&1; then
    log_success "验证成功: 'ash' 命令现在已全局可用。"
else
    log_info "提示: 如果 'ash' 命令不可用，请尝试运行 'source ~/.zshrc' (或您对应的 Shell 配置文件)。"
fi
echo ""
