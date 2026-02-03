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
      fetchCommitsForDate(request.date)
        .then(commits => {
          // Cache commits for popup
          chrome.storage.local.set({
            lastCommitsCount: commits.length,
            lastFetchDate: request.date,
            cachedCommits: commits,
            cachedDate: request.date
          });
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

// Azure DevOps API functions
async function fetchDevopsTasks() {
  const settings = await getSettings();
  if (!settings.devopsToken || !settings.devopsOrganization) {
    throw new Error('Please configure DevOps settings');
  }

  const headers = {
    'Authorization': `Basic ${btoa(`:${settings.devopsToken}`)}`,
    'Content-Type': 'application/json'
  };

  // First, get all projects
  const projectsRes = await fetch(
    `https://dev.azure.com/${settings.devopsOrganization}/_apis/projects?api-version=7.0`,
    { headers }
  );

  if (!projectsRes.ok) {
    if (projectsRes.status === 401 || projectsRes.status === 403) {
      throw new Error('Invalid token or insufficient permissions');
    }
    throw new Error(`DevOps API error: ${projectsRes.status}`);
  }

  const projectsData = await projectsRes.json();
  const projects = projectsData.value || [];

  // WIQL query to get work items assigned to current user
  const wiqlQuery = {
    query: "SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.TeamProject] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC"
  };

  // Query each project for work items
  const allTasks = [];

  for (const project of projects) {
    try {
      const wiqlRes = await fetch(
        `https://dev.azure.com/${settings.devopsOrganization}/${project.name}/_apis/wit/wiql?api-version=7.0`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(wiqlQuery)
        }
      );

      if (!wiqlRes.ok) continue;

      const wiqlData = await wiqlRes.json();
      const workItemIds = (wiqlData.workItems || []).map(wi => wi.id);

      if (workItemIds.length === 0) continue;

      // Fetch work item details in batches of 200
      for (let i = 0; i < workItemIds.length; i += 200) {
        const batchIds = workItemIds.slice(i, i + 200).join(',');
        const detailsRes = await fetch(
          `https://dev.azure.com/${settings.devopsOrganization}/_apis/wit/workitems?ids=${batchIds}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.TeamProject&api-version=7.0`,
          { headers }
        );

        if (detailsRes.ok) {
          const detailsData = await detailsRes.json();
          allTasks.push(...(detailsData.value || []).map(wi => ({
            id: wi.id,
            title: wi.fields['System.Title'],
            state: wi.fields['System.State'],
            type: wi.fields['System.WorkItemType'],
            project: wi.fields['System.TeamProject'] || project.name,
            url: `https://dev.azure.com/${settings.devopsOrganization}/${project.name}/_workitems/edit/${wi.id}`
          })));
        }
      }
    } catch {
      // Skip project on error
    }
  }

  // Deduplicate by ID
  const seen = new Set();
  return allTasks.filter(task => !seen.has(task.id) && seen.add(task.id));
}
