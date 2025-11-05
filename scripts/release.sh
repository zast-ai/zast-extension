#!/bin/bash

# Zast.ai VSCode Extension Release Script
# This script helps create a new release by updating version and creating a git tag

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Zast.ai Extension Release Script${NC}"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Not in a git repository${NC}"
    exit 1
fi

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    echo "Please commit or stash your changes before creating a release."
    echo ""
    read -p "Do you want to continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}📦 Current version: ${CURRENT_VERSION}${NC}"

# Ask for new version
echo ""
echo "Enter the new version (e.g., 0.0.2, 1.0.0):"
read -p "New version: " NEW_VERSION

if [[ -z "$NEW_VERSION" ]]; then
    echo -e "${RED}❌ Version cannot be empty${NC}"
    exit 1
fi

# Validate version format (simple check)
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${YELLOW}⚠️  Warning: Version format should be x.y.z (e.g., 1.0.0)${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}🔄 Updating version to ${NEW_VERSION}...${NC}"

# Update version in package.json
npm version "$NEW_VERSION" --no-git-tag-version

# Build and package the extension
echo -e "${GREEN}🔨 Building and packaging extension...${NC}"
npm run package

# Commit the version change
echo -e "${GREEN}📝 Committing version change...${NC}"
git add package.json
git commit -m "chore: bump version to ${NEW_VERSION}"

# Create and push tag
echo -e "${GREEN}🏷️  Creating git tag v${NEW_VERSION}...${NC}"
git tag "v${NEW_VERSION}"

echo ""
echo -e "${GREEN}✅ Release preparation complete!${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Review the changes:"
echo "   git log --oneline -5"
echo ""
echo "2. Push the changes and tag:"
echo "   git push origin main"
echo "   git push origin v${NEW_VERSION}"
echo ""
echo "3. If you have GitHub Actions set up, the release will be created automatically"
echo ""
echo -e "${GREEN}📦 Extension package: $(ls *.vsix 2>/dev/null | head -n 1)${NC}" 