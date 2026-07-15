const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'README.MD',
  'src/index.html',
  'src/main.js',
  'src/preload.js',
  'src/renderer.js',
  'src/style.css'
];
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

for (const relativePath of sourceFiles) {
  const content = read(relativePath);
  expect(!content.includes('\uFFFD'), `${relativePath} contains a Unicode replacement character.`);
  expect(!/[ÃÂ]|â(?:”|€|™)|Ä(?:‘|ƒ)|á»/.test(content), `${relativePath} appears to contain mojibake.`);
}

const main = read('src/main.js');
expect(!/\b(?:readFileSync|writeFileSync|readdirSync|statSync)\b/.test(main), 'main.js contains synchronous file I/O.');
expect(/webSecurity:\s*true/.test(main), 'The main reader window must enable webSecurity.');
expect((main.match(/webSecurity:\s*false/g) || []).length === 1, 'Only the isolated scraper may disable webSecurity.');
expect(/validateWebUrl\(rawUrl\)/.test(main), 'Web chapter URLs must be validated in the main process.');

const preload = read('src/preload.js');
for (const channel of ['read-cbz-page', 'close-cbz-session', 'get-source-status']) {
  expect(preload.includes(`'${channel}'`), `preload.js does not expose ${channel}.`);
}

const html = read('src/index.html');
expect(/<html\s+lang="en">/.test(html), 'index.html must declare English content.');
expect(/Content-Security-Policy/.test(html), 'index.html is missing a Content Security Policy.');

const packageJson = JSON.parse(read('package.json'));
expect(Boolean(packageJson.author), 'package.json is missing author metadata.');
expect(packageJson.build?.win?.icon === 'assets/icon.ico', 'The Windows build icon is not configured.');
expect(fs.existsSync(path.join(root, 'assets', 'icon.ico')), 'assets/icon.ico is missing.');

if (failures.length) {
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Project checks passed.');
