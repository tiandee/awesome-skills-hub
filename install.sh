#!/bin/bash
# One-step installer for Awesome-Skills-Hub (ASH)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[信息]${NC} $1"; }
log_success() { echo -e "${GREEN}[成功]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[警告]${NC} $1"; }

log_info "正在安装 Awesome-Skills-Hub (ASH)..."

# 1. 自动检测项目 root 目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
ASH_BIN="$PROJECT_ROOT/bin/ash"

# 2. 赋予执行权限
chmod +x "$ASH_BIN"

# 3. 初始化环境
"$ASH_BIN" init

# 4. 自动配置环境变量 (PATH)
SHELL_CONFIG=""
if [[ "$SHELL" == */zsh ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [[ "$SHELL" == */bash ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
fi

if [ -n "$SHELL_CONFIG" ]; then
    if ! grep -q "awesome-skills-hub/bin" "$SHELL_CONFIG"; then
        log_info "正在添加 ash 到 $SHELL_CONFIG..."
        echo "" >> "$SHELL_CONFIG"
        echo "# Awesome-Skills-Hub (ASH) PATH" >> "$SHELL_CONFIG"
        echo "export PATH=\"\$PATH:$PROJECT_ROOT/bin\"" >> "$SHELL_CONFIG"
        log_success "环境变量已配置。"
        log_warn "请运行 'source $SHELL_CONFIG' 或重启终端以生效。"
    else
        log_success "环境变量已在 $SHELL_CONFIG 中配置。"
    fi
else
    log_warn "未识别到 Shell 配置文件，请手动将以下路径添加到 PATH:"
    echo "export PATH=\"\$PATH:$PROJECT_ROOT/bin\""
fi

echo ""
log_success "安装完成！现在你可以直接运行 'ash' 命令了。"
echo ""
