# SightLite Testing Guide

## 🚀 Quick Start (5 Minutes)

### Step 1: Reload the Extension
1. Open Chrome browser
2. Go to `chrome://extensions`
3. Find **SightLite** in the list
4. Click the **Reload** button (circular arrow icon)
5. ✓ Verify: No errors shown on the extension card

### Step 2: Open Test Page
1. In Chrome, press `Ctrl+O` (or `Cmd+O` on Mac)
2. Navigate to: `C:\Users\basav\Downloads\sightlite\sightlite\test-page.html`
3. Or right-click the file → "Open with Chrome"

### Step 3: Open SightLite Extension
1. Click the **SightLite icon** in Chrome toolbar (top-right)
2. Side panel opens on the right side
3. You should see the SightLite interface with:
   - Text input box for goals
   - "Run Agent" button
   - Empty timeline section

### Step 4: Run First Test
1. In the goal input box, type: `click Submit`
2. Click **Run Agent** button
3. Watch the side panel timeline

**Expected Result:**
```
Goal: "click Submit"
1 step(s) planned

Step 1/1: click "Submit"
Scanning page…
🔍 DOM — 25 elements | dom | 0ms
Looking for: "Submit"
Target: "Submit" | Confidence: 100% | dom
CLICK → "Submit"
✓ CLICK done
✓ Task complete
```

4. Check the test page - you should see:
   - Green success box: "✓ Submit clicked successfully!"
   - Status log shows: "[time] ✓ Submit button clicked"

---

## 📋 Full Test Suite

### Test 1: Basic Click ✓
**Goal:** `click Submit`  
**Expected:** Green box appears, log shows click  
**Tests:** Basic button detection and clicking

---

### Test 2: Link Detection ✓
**Goal:** `click Documentation`  
**Expected:** Documentation link highlighted, result box shows success  
**Tests:** Link (`<a href>`) element detection

---

### Test 3: Text Input ✓
**Goal:** `type hello@example.com in email`  
**Expected:** Email field populated with "hello@example.com"  
**Tests:** Input field detection and typing

---

### Test 4: Chain Commands ✓
**Goal:** `type testing in search then click Search`  
**Expected:** 
1. "testing" appears in search box
2. Search button is clicked
3. Result box shows "Searched for: testing"  
**Tests:** Multi-step command execution

---

### Test 5: Select Dropdown ✓
**Goal:** `click country dropdown`  
**Expected:** Dropdown opens  
**Tests:** `<select>` element detection

---

### Test 6: Clickable Divs (Advanced) ✓
**Goal:** `click Action`  
**Expected:** Orange "Action" div is clicked, result appears  
**Tests:** Non-standard clickable elements (divs with onclick)

---

### Test 7: ARIA Roles ✓
**Goal:** `click Confirm`  
**Expected:** Green "Confirm" button is clicked  
**Tests:** ARIA role="button" detection

---

### Test 8: Visibility Filtering ✓
**Goal:** `click Visible Button`  
**Expected:** Button is found and clicked  
**Tests:** 
- Hidden buttons (display:none) should NOT be detected
- Invisible buttons (visibility:hidden) should NOT be detected
- Transparent buttons (opacity:0) should NOT be detected
- Only visible button should be clickable

---

### Test 9: Scroll ✓
**Goal:** `scroll down`  
**Expected:** Page scrolls down smoothly  
**Tests:** Scroll action

---

## 🔍 Debugging Steps

### If Agent Can't Find Elements (0 elements detected)

#### Check Service Worker Console:
1. Go to `chrome://extensions`
2. Under SightLite, click **"Service Worker"** (blue link)
3. DevTools window opens
4. Run agent again and look for logs:

**Good Output:**
```javascript
[SL] Layer1 DOM scan: 25/27 elements on file:///C:/Users/...test-page.html
```

**Bad Output:**
```javascript
[SL] Layer1 returned 0 elements (total nodes: 0)
[SL] Layer2 failed: [error message]
[SL] Layer3 failed: [error message]
[SL] All perception layers failed for tabId=123
```

#### Check Content Script Console:
1. On the test page, press `F12` (open DevTools)
2. Go to **Console** tab
3. Run agent and look for:

**Good Output:**
```javascript
[SightLite/content] DOM scan: 25 elements
```

**Bad Output:**
```javascript
[SightLite/content] DOM scan error: [error message]
```

#### Manual Element Count:
In the test page console, run:
```javascript
document.querySelectorAll('a[href], button, input, select, [role="button"]').length
```

If this returns > 0 but extension finds 0, there's a bug in the visibility filter.

---

## 🌐 Testing on Real Websites

### Test Site 1: Google.com (Simple)
1. Navigate to: `https://google.com`
2. Goal: `click Gmail`
3. **Expected:** Finds and clicks Gmail link in top-right
4. **Difficulty:** Easy - simple, stable layout

---

### Test Site 2: GitHub.com (Medium)
1. Navigate to: `https://github.com`
2. Goal: `click Sign up`
3. **Expected:** Finds and clicks Sign up button
4. **Difficulty:** Medium - dynamic elements

---

### Test Site 3: vtucircle.com (Original Bug Site)
1. Navigate to: `https://vtucircle.com/vtu-question-paper/`
2. Goal: `click BAI702`
3. **Expected:** Finds element with "BAI702" text and clicks it
4. **Difficulty:** Hard - complex layout, possible dynamic loading

**How to Debug vtucircle.com:**

If still failing:

1. **Check total elements found:**
   - Service Worker console should show: `Layer1 DOM scan: X/Y elements`
   - If Y = 0, the page has no standard interactive elements
   - If X = 0 but Y > 0, visibility filtering is too aggressive

2. **Inspect the target element:**
   - On vtucircle.com, open DevTools (F12)
   - Use Element Inspector (Ctrl+Shift+C)
   - Click on the "BAI702" element
   - Check its HTML structure:
     - Is it inside a `<button>`, `<a>`, or `<div onclick>`?
     - Does it have `role="button"`?
     - Is it a plain `<div>` or `<span>` with no onclick?

3. **Check if element is in Shadow DOM:**
   ```javascript
   // In page console:
   document.querySelector('BAI702')  // null = not in main DOM
   ```
   If null, it might be in Shadow DOM (not currently supported)

4. **Check element visibility:**
   ```javascript
   // In page console, after selecting element with inspector:
   const el = $0;  // Chrome DevTools stores selected element as $0
   const style = window.getComputedStyle(el);
   console.log({
     display: style.display,
     visibility: style.visibility,
     opacity: style.opacity,
     rect: el.getBoundingClientRect()
   });
   ```
   If `display: none` or `visibility: hidden`, the fix should catch it.

---

## ✅ Success Criteria

### Extension is Working Correctly If:

1. ✓ Test page finds 20-30 elements
2. ✓ Can click buttons, links, and divs
3. ✓ Can type into input fields
4. ✓ Hidden elements are NOT detected
5. ✓ Visible elements ARE detected
6. ✓ Works on google.com, github.com
7. ✓ Service Worker logs show `Layer1 DOM scan: X/Y elements` with X > 0

---

## 🐛 Known Limitations

### Will NOT Work On:
- **Shadow DOM elements** - not traversed in current version
- **Elements inside iframes** - cross-origin restriction
- **Dynamic elements that load after 2+ seconds** - perception happens immediately
- **Canvas-based UI** - no DOM elements to detect
- **Password fields** - intentionally blocked for security

### Workarounds:
- **Dynamic loading:** Use `scroll down` to trigger lazy loading, then retry
- **Shadow DOM:** Need code update to traverse shadowRoot
- **Iframes:** Need separate content script injection per iframe

---

## 📊 Performance Benchmarks

### Expected Performance:

| Action | Time |
|---|---|
| DOM Scan | 2-10ms |
| Element Matching | < 1ms |
| Click Action | 5-20ms |
| Type Action | 10-50ms |
| Scroll Action | 5-10ms |
| **Total per Step** | **20-100ms** |

### On Test Page:
- Should find 25-30 elements
- Should complete "click Submit" in < 500ms total
- Service Worker logs should show `0ms` for DOM scan

---

## 🆘 Emergency Troubleshooting

### Extension Won't Load:
1. Check `chrome://extensions` for error messages
2. Verify `manifest.json` is valid JSON
3. Try: Remove extension → Reload → Re-add

### Service Worker Not Starting:
1. Click "Service Worker" link on `chrome://extensions`
2. If it says "inactive", click to activate
3. Check for errors in red

### Content Script Not Injecting:
1. Test page console should show `window.__sightliteLoaded === true`
2. If undefined, content script didn't load
3. Check manifest's `content_scripts` section
4. Check for CSP errors in page console

### Still Getting 0 Elements:
1. Share Service Worker console output (full log)
2. Share test page console output
3. Share screenshot of side panel during failed run
4. Try different browser (Edge, Chromium)

---

## 📝 Reporting Results

### What to Share:

1. **Test Results:**
   ```
   ✓ Test 1: Basic Click - PASS
   ✓ Test 2: Link Detection - PASS
   ✗ Test 3: vtucircle.com - FAIL (0 elements)
   ```

2. **Console Logs:**
   - Service Worker output (from "Service Worker" DevTools)
   - Page console output (from page F12 → Console)

3. **Screenshots:**
   - Side panel showing error
   - Service Worker console
   - Element inspector showing target element structure

4. **Browser Info:**
   - Chrome version: `chrome://version`
   - OS: Windows/Mac/Linux
   - Extension version: 1.0.0

---

## 🎯 Next Steps After Testing

### If All Tests Pass:
1. Extension is working correctly
2. Ready for real-world use
3. Consider adding ONNX model for vision mode

### If Some Tests Fail:
1. Document which tests fail
2. Share debug logs (see above)
3. We'll investigate specific edge cases

### If All Tests Fail:
1. Extension has a critical bug
2. Share ALL logs and screenshots
3. May need to revert to previous version

---

**Testing Checklist:**

- [ ] Extension reloaded in Chrome
- [ ] Test page opens correctly
- [ ] Service Worker console is open
- [ ] Test 1-9 completed
- [ ] vtucircle.com tested
- [ ] Logs captured for any failures
- [ ] Results documented

**Good luck! 🚀**
