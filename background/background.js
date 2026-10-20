/**
 * Reporting Commits Tracker - Background Service Worker
 * Copyright (c) 2026 Zakharii Melnyk (https://github.com/uaoa)
 * Licensed under MIT License
 */

// Background service worker for GitHub API

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_TTL = 2 * 60 * 1000; // revalidate recent days at most every 2 minutes
const MONTH_TTL = 10 * 60 * 1000;
const MAX_CACHED_DAYS = 120;
const CONCURRENCY = 12;

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'about',
    title: 'About Reporting Commits Tracker',
    contexts: ['action']
  });
  // Drop cache keys from older versions
  chrome.storage.local.remove(['cachedCommits', 'cachedDate', 'lastCommitsCount', 'lastFetchDate']);
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'about') {
    chrome.tabs.create({ url: chrome.runtime.getURL('about/about.html') });
  }
});

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
    getCommitsForDate(request.date, request.force)
      .then(commits => sendResponse({ commits }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'fetchMonth') {
    getMonthDays(request.year, request.month, request.force)
      .then(days => sendResponse({ days }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'fetchDevopsTasks') {
    fetchDevopsTasks()
      .then(tasks => sendResponse({ tasks }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'dateSelected') {
    // Get tab ID from sender (works for both main frame and iframes)
    const tabId = sender.tab?.id;

    if (tabId) {
      // Prefetch into cache so the popup opens instantly
      getCommitsForDate(request.date)
        .then(commits => setIcon(commits.length > 0, tabId))
        .catch(() => setIcon(false, tabId));
    }
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'mainPage') {
    // Reset icon when returning to main page (modal closed)
    const tabId = sender.tab?.id;
    if (tabId) {
      setIcon(false, tabId);
    }
    sendResponse({ ok: true });
    return false;
  }
});

// Reset icon when navigating away (tab.url is only visible for our host)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && !tab.url?.includes('rep.smartcloud.com.ua')) {
    setIcon(false, tabId);
  }
});

// ===== Helpers =====

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return settings || {};
}

const pad = (n) => String(n).padStart(2, '0');

function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('.');
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

// "27.01.2026" -> "2026-01"
function monthKeyOf(dateStr) {
  const [, month, year] = dateStr.split('.');
  return `${year}-${month}`;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Commits for a period can still show up later (late pushes), so a period is
// final only when it was fetched more than a day after it ended
function isFresh(entry, rangeEnd, ttl) {
  if (!entry?.time) return false;
  return entry.time - rangeEnd.getTime() > DAY_MS || Date.now() - entry.time < ttl;
}

// Run async fn over items with limited parallelism
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Share one request between concurrent callers (popup + content script prefetch)
const inflight = new Map();
function dedupe(key, fn) {
  if (!inflight.has(key)) {
    inflight.set(key, fn().finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

// ===== Cache =====

let cacheQueue = Promise.resolve();

// Serialize read-modify-write cycles so parallel fetches don't overwrite each other
function updateCache(mutate) {
  cacheQueue = cacheQueue.then(async () => {
    const data = await chrome.storage.local.get(['commitsCache', 'monthsCache']);
    const commitsCache = data.commitsCache || {};
    const monthsCache = data.monthsCache || {};
    mutate(commitsCache, monthsCache);

    const keys = Object.keys(commitsCache);
    if (keys.length > MAX_CACHED_DAYS) {
      keys.sort((a, b) => commitsCache[b].time - commitsCache[a].time)
        .slice(MAX_CACHED_DAYS)
        .forEach(k => delete commitsCache[k]);
    }

    await chrome.storage.local.set({ commitsCache, monthsCache });
  }).catch(e => console.error('Failed to update cache:', e));
  return cacheQueue;
}

// Incomplete results (some repos failed) are stored with time 0 so they get refetched
function saveDays(byDay, complete) {
  const time = complete ? Date.now() : 0;
  return updateCache((commitsCache, monthsCache) => {
    for (const [date, commits] of Object.entries(byDay)) {
      commitsCache[date] = { commits, time };
      // Keep calendar activity in sync with the freshest day data
      const month = monthsCache[monthKeyOf(date)];
      if (month) {
        const days = new Set(month.days);
        if (commits.length) days.add(date); else days.delete(date);
        month.days = [...days];
      }
    }
  });
}

async function getCommitsForDate(dateStr, force = false) {
  const start = parseDate(dateStr);
  const end = addDays(start, 1);

  if (!force) {
    const { commitsCache } = await chrome.storage.local.get('commitsCache');
    const entry = commitsCache?.[dateStr];
    if (isFresh(entry, end, DAY_TTL)) return entry.commits;
  }

  return dedupe(`day:${dateStr}`, async () => {
    const { commits, complete } = await fetchCommitsRange(start, end);
    await saveDays({ [dateStr]: commits }, complete);
    return commits;
  });
}

// Returns dates ("dd.mm.yyyy") of the month that have commits; month is 0-based
async function getMonthDays(year, month, force = false) {
  const key = `${year}-${pad(month + 1)}`;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);

  if (!force) {
    const { monthsCache } = await chrome.storage.local.get('monthsCache');
    const entry = monthsCache?.[key];
    if (isFresh(entry, end, MONTH_TTL)) return entry.days;
  }

  return dedupe(`month:${key}`, async () => {
    const { commits, complete } = await fetchCommitsRange(start, end);

    // Split by local day; this also warms the per-day cache for the whole month
    const now = new Date();
    const byDay = {};
    for (let d = start; d < end && d <= now; d = addDays(d, 1)) {
      byDay[formatDate(d)] = [];
    }
    for (const c of commits) {
      byDay[formatDate(new Date(c.date))]?.push(c);
    }
    const days = Object.keys(byDay).filter(date => byDay[date].length);

    await updateCache((_, monthsCache) => {
      monthsCache[key] = { days, time: complete ? Date.now() : 0 };
    });
    await saveDays(byDay, complete);
    return days;
  });
}

// ===== Commits =====

async function fetchCommitsRange(since, until) {
  const settings = await getSettings();
  const commitsSource = settings.commitsSource || 'both';

  const hasGithub = settings.token && settings.username && settings.organization;
  const hasDevops = settings.devopsToken && settings.devopsOrganization && settings.devopsAuthor;

  const sources = [];
  if ((commitsSource === 'github' || commitsSource === 'both') && hasGithub) {
    sources.push(fetchGithubCommits(settings, since, until));
  }
  if ((commitsSource === 'devops' || commitsSource === 'both') && hasDevops) {
    sources.push(fetchDevopsCommits(settings, since, until));
  }

  if (!sources.length) {
    throw new Error('Please configure GitHub or DevOps settings');
  }

  const results = await Promise.all(sources);

  const seen = new Set();
  const commits = results.flatMap(r => r.commits)
    .filter(c => !seen.has(c.sha) && seen.add(c.sha))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return { commits, complete: results.every(r => r.complete) };
}

async function fetchGithubCommits(settings, since, until) {
  const headers = { 'Authorization': `Bearer ${settings.token}`, 'Accept': 'application/vnd.github.v3+json' };
  const org = encodeURIComponent(settings.organization);

  // Repos sorted by last push: once we reach repos pushed before the range,
  // neither they nor the following ones can contain commits from it
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=all&sort=pushed&direction=desc`, { headers });
    if (!res.ok) {
      if (res.status === 401) throw new Error('GitHub: Invalid token');
      if (res.status === 404) throw new Error('GitHub: Organization not found');
      throw new Error(`GitHub API error: ${res.status}`);
    }
    const data = await res.json();
    const active = data.filter(r => r.pushed_at && new Date(r.pushed_at) >= since);
    repos.push(...active);
    if (data.length < 100 || active.length < data.length) break;
  }

  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  const results = await mapLimit(repos, CONCURRENCY, async repo => {
    const commits = [];
    try {
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({ author: settings.username, since: sinceIso, until: untilIso, per_page: '100', page: String(page) });
        const res = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?${params}`, { headers });
        if (!res.ok) return res.status === 409 ? commits : null; // 409 = empty repository
        const data = await res.json();
        commits.push(...data);
        if (data.length < 100) return commits;
      }
    } catch {
      return null;
    }
  });

  return {
    commits: results.flatMap(r => r || []).map(c => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.committer?.date || c.commit.author?.date,
      source: 'github'
    })),
    complete: results.every(Boolean)
  };
}

function devopsHeaders(settings) {
  return {
    'Authorization': `Basic ${btoa(`:${settings.devopsToken}`)}`,
    'Content-Type': 'application/json'
  };
}

async function fetchDevopsCommits(settings, since, until) {
  const headers = devopsHeaders(settings);
  const org = encodeURIComponent(settings.devopsOrganization);

  // Single org-level call instead of one repositories request per project
  const reposRes = await fetch(`https://dev.azure.com/${org}/_apis/git/repositories?api-version=7.0`, { headers });

  if (!reposRes.ok) {
    if (reposRes.status === 401 || reposRes.status === 403) {
      throw new Error('DevOps: Invalid token or insufficient permissions');
    }
    throw new Error(`DevOps API error: ${reposRes.status}`);
  }

  // Empty repos have no default branch; disabled repos reject requests
  const repos = ((await reposRes.json()).value || []).filter(r => r.defaultBranch && !r.isDisabled);

  const fromDate = since.toISOString();
  const toDate = until.toISOString();
  const top = 1000;

  const results = await mapLimit(repos, CONCURRENCY, async repo => {
    const commits = [];
    try {
      for (let skip = 0; ; skip += top) {
        const params = new URLSearchParams({
          'searchCriteria.fromDate': fromDate,
          'searchCriteria.toDate': toDate,
          'searchCriteria.author': settings.devopsAuthor,
          'searchCriteria.$top': String(top),
          'searchCriteria.$skip': String(skip),
          'api-version': '7.0'
        });
        const res = await fetch(
          `https://dev.azure.com/${org}/${encodeURIComponent(repo.project.name)}/_apis/git/repositories/${repo.id}/commits?${params}`,
          { headers }
        );
        if (!res.ok) return null;
        const data = (await res.json()).value || [];
        commits.push(...data.map(c => ({
          sha: c.commitId,
          message: c.comment,
          date: c.committer?.date || c.author.date,
          source: 'devops'
        })));
        if (data.length < top) return commits;
      }
    } catch {
      return null;
    }
  });

  return { commits: results.flatMap(r => r || []), complete: results.every(Boolean) };
}

// ===== Azure DevOps Tasks =====

async function fetchDevopsTasks() {
  const settings = await getSettings();
  if (!settings.devopsToken || !settings.devopsOrganization) {
    throw new Error('Please configure DevOps settings');
  }

  const headers = devopsHeaders(settings);
  const org = encodeURIComponent(settings.devopsOrganization);

  // Org-level WIQL already covers all projects, so one query is enough
  const wiqlQuery = {
    query: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC"
  };

  const wiqlRes = await fetch(`https://dev.azure.com/${org}/_apis/wit/wiql?api-version=7.0`, {
    method: 'POST',
    headers,
    body: JSON.stringify(wiqlQuery)
  });

  if (!wiqlRes.ok) {
    if (wiqlRes.status === 401 || wiqlRes.status === 403) {
      throw new Error('Invalid token or insufficient permissions');
    }
    throw new Error(`DevOps API error: ${wiqlRes.status}`);
  }

  const workItemIds = ((await wiqlRes.json()).workItems || []).map(wi => wi.id);

  // Fetch work item details in parallel batches of 200
  const batches = [];
  for (let i = 0; i < workItemIds.length; i += 200) {
    batches.push(workItemIds.slice(i, i + 200));
  }

  const results = await Promise.all(batches.map(async ids => {
    try {
      const res = await fetch(
        `https://dev.azure.com/${org}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.TeamProject&api-version=7.0`,
        { headers }
      );
      return res.ok ? (await res.json()).value || [] : [];
    } catch {
      return [];
    }
  }));

  return results.flat().map(wi => {
    const project = wi.fields['System.TeamProject'];
    return {
      id: wi.id,
      title: wi.fields['System.Title'],
      state: wi.fields['System.State'],
      type: wi.fields['System.WorkItemType'],
      project,
      url: `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_workitems/edit/${wi.id}`
    };
  });
}
