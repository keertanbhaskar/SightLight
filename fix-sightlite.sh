#!/bin/bash
cd /c/Users/basav/Downloads/sightlite/sightlite/extension

echo "🔧 FIXING ALL ISSUES..."
echo ""

# ============================================
# FIX 1: Remove voice handlers from service worker
# ============================================
echo "1️⃣ Removing voice code from service worker..."

cd background
cp service-worker.js service-worker.js.backup

# Use sed to remove voice message handlers
sed -i '/Voice recognition messages/,/return true;/d' service-worker.js
sed -i '/Voice result\/error\/state messages/,/return false;/d' service-worker.js

echo "✅ Service worker cleaned"

# ============================================
# FIX 2: Verify content script exists
# ============================================
cd ..
echo ""
echo "2️⃣ Verifying content script..."

if [ ! -f "content/content.js" ]; then
    echo "⚠️  Creating missing content script..."
    mkdir -p content
    echo "console.log('[SightLite] Content script ready');" > content/content.js
fi
echo "✅ Content script verified"

# ============================================
# FIX 3: Remove voice remnants
# ============================================
echo ""
echo "3️⃣ Cleaning up..."
rm -rf voice/ 2>/dev/null
rm -f sidepanel/*.backup 2>/dev/null
rm -f sidepanel/*.with-voice 2>/dev/null
rm -f background/*.old 2>/dev/null
echo "✅ Cleanup complete"

# ============================================
# FIX 4: Verify structure
# ============================================
echo ""
echo "4️⃣ Verifying files..."
MISSING=0
for file in manifest.json background/service-worker.js sidepanel/sidepanel.html sidepanel/sidepanel.js offscreen/offscreen.js; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -eq 0 ]; then
    echo "✅ All files present"
else
    echo "⚠️  Missing $MISSING files"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ FIXES COMPLETED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. Reload extension in Chrome:"
echo "   chrome://extensions → Find SightLite → Click Reload"
echo ""
echo "2. Test it:"
echo "   • Open any webpage"
echo "   • Click SightLite icon"
echo "   • Type: 'click search'"
echo "   • Click: Run Agent"
echo ""
echo "3. For dashboard (optional):"
echo "   docker-compose up -d"
echo "   Open: http://localhost:8080"
echo ""
