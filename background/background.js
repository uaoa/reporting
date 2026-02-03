// Background service worker for GitHub API

// Helper to set icon safely using absolute paths
async function setIcon(active, tabId) {
  const suffix = active ? '-active' : '';
  const path = {
    16: `/icons/icon16${suffix}.png`,
    48: `/icons/icon48${suffix}.png`,
    128: `/icons/icon128${suffix}.png`
  };
  try {
    await chrome.action.setIcon({ path, tabId });
  } catch (e) {
    console.error('Failed to set icon:', e);
  }
}

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchCommits') {
    fetchCommitsForDate(request.date)
      .then(commits => sendResponse({ commits }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'dateSelected') {
    // Get tab ID from sender (works for both main frame and iframes)
    const tabId = sender.tab?.id;

    if (tabId) {
      fetchCommitsForDate(request.date)
        .then(commits => {
          chrome.storage.local.set({ lastCommitsCount: commits.length, lastFetchDate: request.date });
          setIcon(commits.length > 0, tabId);
        })
        .catch(() => setIcon(false, tabId));
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'mainPage') {
    // Reset icon when returning to main page (modal closed)
    const tabId = sender.tab?.id;
    if (tabId) {
      setIcon(false, tabId);
    }
    sendResponse({ ok: true });
    return true;
  }
});

// Reset icon when navigating away
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url && !tab.url.includes('rep.smartcloud.com.ua')) {
    setIcon(false, tabId);
  }
});

// GitHub API functions
async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return settings || {};
}

function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('.');
  return new Date(year, month - 1, day);
}

async function fetchCommitsForDate(dateStr) {
  const settings = await getSettings();
  if (!settings.token || !settings.username || !settings.organization) {
    throw new Error('Please configure GitHub settings');
  }

  const date = parseDate(dateStr);
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);

  const headers = { 'Authorization': `Bearer ${settings.token}`, 'Accept': 'application/vnd.github.v3+json' };

  // Fetch repos
  const repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/orgs/${settings.organization}/repos?per_page=100&page=${page}&type=all`, { headers });
    if (!res.ok) throw new Error(res.status === 401 ? 'Invalid token' : res.status === 404 ? 'Organization not found' : `API error: ${res.status}`);
    const data = await res.json();
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }

  // Fetch commits from all repos
  const since = date.toISOString();
  const until = nextDate.toISOString();
  const results = await Promise.all(repos.map(async repo => {
    const params = new URLSearchParams({ author: settings.username, since, until, per_page: '100' });
    const res = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?${params}`, { headers });
    return res.ok ? res.json() : [];
  }));

  // Deduplicate and sort
  const seen = new Set();
  return results.flat()
    .filter(c => !seen.has(c.sha) && seen.add(c.sha))
    .sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date));
}
