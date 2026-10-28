const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'data') continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      checkDir(full);
    } else if (f.endsWith('.js')) {
      try {
        execSync(`node --check "${full}"`);
        console.log(`[PASS] ${full}`);
      } catch (err) {
        console.error(`[FAIL] ${full}:`, err.message);
        process.exit(1);
      }
    }
  }
}

console.log('Running node --check on all JavaScript files...');
checkDir('.');
console.log('🎉 All JavaScript files successfully passed node --check!');
