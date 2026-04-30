#!/bin/bash
# Bump patch version when Claude stops with uncommitted source changes.
# Skips if tree is clean or only package.json/Settings.tsx changed.

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

CHANGED=$(git status --short 2>/dev/null | grep -vE '^\?\?' | grep -v 'package\.json\|Settings\.tsx')
[ -z "$CHANGED" ] && exit 0

CURRENT=$(node -p "require('./package.json').version" 2>/dev/null)
[ -z "$CURRENT" ] && exit 0

NEW=$(echo "$CURRENT" | awk -F. '{print $1"."$2"."$3+1}')
[ "$CURRENT" = "$NEW" ] && exit 0

sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" package.json
sed -i "s/const APP_VERSION = '$CURRENT'/const APP_VERSION = '$NEW'/" src/pages/Settings.tsx

echo "{\"systemMessage\": \"Version bumped $CURRENT → $NEW\"}"
