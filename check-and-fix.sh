#!/bin/bash
echo "🔍 CHECKING SIGHTLITE EXTENSION..."
echo ""

cd extension || exit 1

# Check 1: Service Worker
echo "1️⃣ Service Worker..."
if grep -q "voice_start\|voice_stop" background/service-worker.js 2>/dev/null; then
    echo "   ❌ Contains voice handlers - NEEDS FIX"
    NEEDS_FIX=1
else
    echo "   ✅ Clean (no voice code)"
fi

# Check 2: Manifest
echo ""
echo "2️⃣ Manifest..."
if grep -q '"type": "module"' manifest.json 2>/dev/null; then
    echo "   ❌ Has 'type: module' - NEEDS FIX"
    NEEDS_FIX=1
else
    echo "   ✅ Valid"
fi

# Check 3: Content Script
echo ""
echo "3️⃣ Content Script..."
if [ -f "content/content.js" ] && [ -s "content/content.js" ]; then
    echo "   ✅ Exists and not empty"
else
    echo "   ❌ Missing or empty - NEEDS FIX"
    NEEDS_FIX=1
fi

# Check 4: Sidepanel
echo ""
echo "4️⃣ Sidepanel..."
if [ -f "sidepanel/sidepanel.js" ] && ! grep -q "^import " sidepanel/sidepanel.js; then
    echo "   ✅ No ES6 imports"
else
    echo "   ❌ Has ES6 imports or missing - NEEDS FIX"
    NEEDS_FIX=1
fi

# Check 5: Files exist
echo ""
echo "5️⃣ Required Files..."
ALL_GOOD=1
for f in manifest.json background/service-worker.js sidepanel/sidepanel.html sidepanel/sidepanel.js sidepanel/sidepanel.css offscreen/offscreen.html offscreen/offscreen.js content/content.js; do
    if [ ! -f "$f" ]; then
        echo "   ❌ Missing: $f"
        ALL_GOOD=0
    fi
done
if [ $ALL_GOOD -eq 1 ]; then
    echo "   ✅ All present"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -z "${NEEDS_FIX}" ]; then
    echo "✅ EXTENSION IS READY!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📋 NEXT STEPS:"
    echo ""
    echo "1. Reload extension:"
    echo "   • chrome://extensions"
    echo "   • Find SightLite → Click 🔄 Reload"
    echo ""
    echo "2. Test it:"
    echo "   • Open any webpage"
    echo "   • Click SightLite icon"
    echo "   • Type: click search"
    echo "   • Click: Run Agent"
    echo ""
    echo "3. For dashboard history:"
    echo "   cd /c/Users/basav/Downloads/sightlite/sightlite"
    echo "   docker-compose up -d"
    echo "   Open: http://localhost:8080"
else
    echo "⚠️  ISSUES FOUND"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Extension needs fixes. Please report the issues above."
fi
echo ""
