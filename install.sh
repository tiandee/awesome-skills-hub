#!/bin/bash
# One-step installer for Awesome-Skills-Hub

echo "🚀 Installing Awesome-Skills-Hub (ASH)..."

# 1. 确保目录存在 (如果是 git clone 下来的，这一步其实是冗余的，但在 curl | bash 场景下有用)
INSTALL_DIR="$HOME/TianProjects/awesome-skills-hub"
mkdir -p "$INSTALL_DIR"

# 2. 赋予 CLI 执行权限
chmod +x "$INSTALL_DIR/bin/ash"

# 3. 初始化环境
"$INSTALL_DIR/bin/ash" init

# 4. 设置别名 (可选，打印出来让用户自己加)
echo ""
echo "✅ Installation Complete!"
echo "Add the following line to your ~/.zshrc or ~/.bashrc to use 'ash' globally:"
echo ""
echo "export PATH=\"\$PATH:$INSTALL_DIR/bin\""
echo ""
echo "Then run: source ~/.zshrc"
