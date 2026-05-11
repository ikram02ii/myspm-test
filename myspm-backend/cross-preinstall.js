// cross-preinstall.js
const fs = require('fs');

// Remove lock files if they exist
['package-lock.json', 'yarn.lock'].forEach((file) => {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
});

// Check if using pnpm
const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('Use pnpm instead');
  process.exit(1);
}
