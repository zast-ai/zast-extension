#!/bin/bash

# Zast.ai VSCode Extension Packaging Script
# This script compiles and packages the extension as a .vsix file

set -e

echo "🚀 Starting Zast.ai extension packaging..."

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo "❌ vsce is not installed. Installing vsce globally..."
    npm install -g @vscode/vsce
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf out/
rm -f *.vsix

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Bundle the extension with dependencies
echo "🔨 Bundling extension with dependencies..."
npm run bundle:all

# Package the extension
echo "📦 Packaging extension..."
vsce package

# Get the generated .vsix filename
VSIX_FILE=$(ls *.vsix 2>/dev/null | head -n 1)

if [ -n "$VSIX_FILE" ]; then
    echo "✅ Extension packaged successfully: $VSIX_FILE"
    echo "📁 File size: $(du -h "$VSIX_FILE" | cut -f1)"
    echo ""
    echo "📋 To install this extension:"
    echo "   1. Open VSCode"
    echo "   2. Go to Extensions (Ctrl+Shift+X)"
    echo "   3. Use Command Palette: Ctrl+Shift+P → 'Extensions: Install from VSIX...'"
    echo "   4. Select the file: $VSIX_FILE"
    echo ""
    echo "🔗 Or use command line:"
    echo "   code --install-extension $VSIX_FILE"
else
    echo "❌ Failed to create .vsix file"
    exit 1
fi 