/* ---------------------------------------------------------------------------
   Inline the whole app into one self-contained .html file.

   A single file is the easiest thing to get onto a phone: AirDrop it, email it
   to yourself, or drop it in iCloud/Drive and open it. No server, no hosting,
   and nothing to keep in sync. The multi-file version is still the one to host.
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

// Every replacement below passes a FUNCTION rather than a string. With a
// string, `$&`, `$\`` and `$'` are substitution patterns — and app.js is full
// of `$('#id')` selectors, so `$'` would splice the rest of the document back
// in. A function replacer disables that interpretation entirely.
const lit = str => () => str;

// Inline the stylesheet.
html = html.replace('<link rel="stylesheet" href="styles.css">',
  lit('<style>\n' + read('styles.css') + '\n</style>'));

// Inline each script in the order the page lists them.
const scripts = ['js/util.js', 'js/store.js', 'js/calc.js', 'js/charts.js',
                 'js/csv.js', 'js/demo.js', 'js/app.js'];
scripts.forEach(src => {
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) throw new Error(`index.html no longer loads ${src}`);
  // A literal </script> inside the source would close the tag early.
  html = html.replace(tag,
    lit('<script>\n' + read(src).replace(/<\/script>/gi, '<\\/script>') + '\n</script>'));
});

// Drop the pieces that only work when the app is served over http(s).
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '');
html = html.replace(/<script>\s*\/\/ Offline support[\s\S]*?<\/script>/, '');

// Inline the touch icon so the file stays genuinely standalone.
const icon = fs.readFileSync(path.join(root, 'icons/icon-180.png')).toString('base64');
html = html.replace('<link rel="apple-touch-icon" href="icons/icon-180.png">',
  lit(`<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">`));

const stray = html.match(/<(script|link)[^>]+(src|href)="(?!data:|https?:)[^"]*"/);
if (stray) throw new Error('a local asset reference survived inlining: ' + stray[0]);

// Each script must appear exactly once; a `$'` style splice would duplicate them.
scripts.forEach(src => {
  const marker = 'js/' + path.basename(src);
  const hits = html.split('src="' + marker + '"').length - 1;
  if (hits) throw new Error(`${src} is still referenced ${hits}x after inlining`);
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'trading-journal.html');
fs.writeFileSync(out, html);

const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`✓ dist/trading-journal.html — ${kb} KB, no external references`);
