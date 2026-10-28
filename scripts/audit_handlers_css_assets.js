const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 1. Audit Event Handlers
console.log('=== TASK 5 AUDIT: EVENT HANDLERS ===');

const pages = [
  { file: 'index.html', js: ['config.js', 'script.js'] },
  { file: 'dashboard.html', js: ['config.js', 'dashboard.js'] },
  { file: 'signup.html', js: ['config.js', 'signup.js'] }
];

let handlerErrors = 0;

pages.forEach(({ file, js }) => {
  const htmlContent = fs.readFileSync(path.join(rootDir, file), 'utf8');
  const jsContent = js.map(j => fs.readFileSync(path.join(rootDir, j), 'utf8')).join('\n');

  // Match onclick="func(...)", onsubmit="func(...)", oninput="func(...)", onchange="func(...)"
  const handlerRegex = /\b(onclick|onsubmit|onchange|oninput)=["']([^"']+)["']/gi;
  let match;
  const handlersFound = new Set();

  while ((match = handlerRegex.exec(htmlContent)) !== null) {
    const expr = match[2].trim();
    // Extract base function name before '(' or '.'
    const funcMatch = expr.match(/^([a-zA-Z0-9_$]+)/);
    if (funcMatch) {
      handlersFound.add(funcMatch[1]);
    }
  }

  console.log(`\nPage: ${file}`);
  console.log(`Handlers found (${handlersFound.size}):`, Array.from(handlersFound).join(', '));

  handlersFound.forEach(handler => {
    // Check if defined as function handler(...) or window.handler = ... or handler = ...
    const defRegex = new RegExp(`(function\\s+${handler}\\b|\\bwindow\\.${handler}\\s*=|\\b${handler}\\s*=\\s*(async\\s+)?function|\\b${handler}\\s*=\\s*\\()`, 'm');
    const isDefined = defRegex.test(jsContent);
    if (isDefined) {
      console.log(`  [OK] ${handler} is defined in ${js.join(' / ')}`);
    } else {
      console.error(`  [FAIL] ${handler} is NOT defined in ${js.join(' / ')}`);
      handlerErrors++;
    }
  });
});

// 2. Audit Assets Referenced
console.log('\n=== TASK 5 AUDIT: ASSETS REFERENCED ===');
let assetErrors = 0;
const allHtml = ['index.html', 'dashboard.html', 'signup.html', 'terms.html', 'privacy.html', 'refund.html', 'contact.html'];
const assetRegex = /(?:src|href)=["'](assets\/[^"']+)["']/gi;

const referencedAssets = new Set();
allHtml.forEach(f => {
  const content = fs.readFileSync(path.join(rootDir, f), 'utf8');
  let m;
  while ((m = assetRegex.exec(content)) !== null) {
    // clean any ?query param
    const assetPath = m[1].split('?')[0];
    referencedAssets.add(assetPath);
  }
});

console.log(`Referenced local assets (${referencedAssets.size}):`);
referencedAssets.forEach(a => {
  const fullPath = path.join(rootDir, a);
  const exists = fs.existsSync(fullPath);
  if (exists) {
    const stat = fs.statSync(fullPath);
    console.log(`  [OK] ${a} (Size: ${stat.size} bytes)`);
  } else {
    console.error(`  [FAIL] Missing asset: ${a}`);
    assetErrors++;
  }
});

// 3. Audit CSS Classes
console.log('\n=== TASK 5 AUDIT: CSS CLASSES ===');
function auditCss(htmlFile, cssFile) {
  const html = fs.readFileSync(path.join(rootDir, htmlFile), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, cssFile), 'utf8');

  const classMatches = html.matchAll(/class=["']([^"']+)["']/g);
  const classes = new Set();
  for (const m of classMatches) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  }
  let missing = [];
  for (const c of classes) {
    const escaped = c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp('\\.' + escaped + '\\b');
    if (!regex.test(css)) {
      missing.push(c);
    }
  }
  console.log(`${htmlFile} vs ${cssFile}: Total classes = ${classes.size}, unstyled/utility = ${missing.length}`);
  if (missing.length > 0 && missing.length <= 15) {
    console.log(`  Unstyled/utility list: ${missing.join(', ')}`);
  }
}

auditCss('index.html', 'styles.css');
auditCss('dashboard.html', 'dashboard.css');
auditCss('signup.html', 'signup.css');

console.log(`\nHandler errors: ${handlerErrors}, Asset errors: ${assetErrors}`);
if (handlerErrors === 0 && assetErrors === 0) {
  console.log('🎉 AUDIT PASSED: Zero missing handlers, Zero missing assets!');
} else {
  process.exit(1);
}
