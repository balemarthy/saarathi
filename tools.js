// The only three things Saarathi can do. Claude picks a tool and its
// arguments; everything executed here is validated or looked up locally.
const { shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Friendly app name -> launch target. Edit apps.json to add apps on this
// machine. Values come from this trusted local file, never from Claude.
function loadApps() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'apps.json'), 'utf8'));
  } catch (err) {
    console.error('[warn] could not read apps.json:', err.message);
    return {};
  }
}

function toolDefinitions() {
  const names = Object.keys(loadApps()).join(', ');
  return [
    {
      name: 'open_website',
      description: 'Open a website in the default browser.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Site to open, e.g. "youtube.com" or "https://github.com".' } },
        required: ['url'],
      },
    },
    {
      name: 'open_app',
      description: `Launch an installed desktop app. Known apps: ${names}.`,
      input_schema: {
        type: 'object',
        properties: { app_name: { type: 'string', description: 'Friendly app name from the known list.' } },
        required: ['app_name'],
      },
    },
    {
      name: 'search_web',
      description: 'Search the web for a query, showing results in the default browser.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to search for.' } },
        required: ['query'],
      },
    },
  ];
}

async function openWebsite(input) {
  let raw = String(input.url || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `Sorry, ${input.url} isn't a valid address.`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Sorry, I only open web addresses.';
  if (!url.hostname.includes('.')) return `Sorry, ${url.hostname} doesn't look like a website.`;
  await shell.openExternal(url.href);
  return `Opening ${url.hostname.replace(/^www\./, '')}.`;
}

async function searchWeb(input) {
  const query = String(input.query || '').trim().slice(0, 200);
  if (!query) return 'Sorry, what should I search for?';
  await shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(query));
  return `Searching for ${query}.`;
}

function openApp(input) {
  const name = String(input.app_name || '').trim().toLowerCase();
  const apps = loadApps();
  if (!Object.prototype.hasOwnProperty.call(apps, name)) {
    return Promise.resolve(`Sorry, I don't have ${input.app_name || 'that app'} set up.`);
  }
  return new Promise((resolve) => {
    // Fixed launcher, target from apps.json only, passed as an argument.
    const child = spawn('cmd.exe', ['/c', 'start', '', apps[name]], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => resolve(`Sorry, I couldn't open ${name}.`));
    child.unref();
    resolve(`Opening ${name}.`);
  });
}

const EXECUTORS = { open_website: openWebsite, open_app: openApp, search_web: searchWeb };

// Returns the sentence to speak. Unknown tool names are refused.
async function executeTool(name, input) {
  const run = Object.prototype.hasOwnProperty.call(EXECUTORS, name) ? EXECUTORS[name] : null;
  if (!run) return "Sorry, I can't do that.";
  try {
    return await run(input && typeof input === 'object' ? input : {});
  } catch (err) {
    console.error(`[error] tool ${name}:`, err.message);
    return 'Sorry, that did not work.';
  }
}

module.exports = { toolDefinitions, executeTool };
