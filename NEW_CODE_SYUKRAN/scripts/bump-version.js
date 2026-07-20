const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const pkgPath = path.join(__dirname, '..', 'package.json');

const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const version = app.expo.version.replace(/^v/, '');
const parts = version.split('.').map(Number);
const [major = 0, minor = 0, patch = 0] = parts;

const bump = process.argv[2] || 'patch';
let next;
if (bump === 'major') {
  next = [major + 1, 0, 0];
} else if (bump === 'minor') {
  next = [major, minor + 1, 0];
} else {
  next = [major, minor, patch + 1];
}

const nextVersion = next.join('.');

app.expo.version = nextVersion;
fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

process.stdout.write(nextVersion);