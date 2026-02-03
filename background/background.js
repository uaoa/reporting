// Background service worker for GitHub API interactions

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchCommits') {
    fetchCommitsForDate(request.date)
      .then(commits => sendResponse({ commits }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Parse date from dd.MM.yyyy to Date object
function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('.');
  return new Date(year, month - 1, day);
}

// Format date to ISO string for GitHub API
function toISODate(date) {
  return date.toISOString();
}

// Get settings from storage
async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  return result.settings || {};
}

// Fetch all repositories for organization
async function fetchOrgRepos(settings) {
  const { token, organization } = settings;

  if (!token || !organization) {
    throw new Error('Please configure GitHub token and organization in settings');
  }

  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `https://api.github.com/orgs/${organization}/repos?per_page=${perPage}&page=${page}&type=all`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid GitHub token. Please check your settings.');
      }
      if (response.status === 404) {
        throw new Error('Organization not found. Please check your settings.');
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    repos.push(...data);

    if (data.length < perPage) break;
    page++;
  }

  return repos;
}

// Fetch commits for a specific repo and date
async function fetchRepoCommits(settings, repo, since, until) {
  const { token, username } = settings;

  const params = new URLSearchParams({
    author: username,
    since: since,
    until: until,
    per_page: '100'
  });

  const response = await fetch(
    `https://api.github.com/repos/${repo.full_name}/commits?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  if (!response.ok) {
    // Skip repos without commits access
    if (response.status === 409 || response.status === 404) {
      return [];
    }
    console.error(`Failed to fetch commits for ${repo.full_name}:`, response.status);
    return [];
  }

  return response.json();
}

// Main function to fetch all commits for a date
async function fetchCommitsForDate(dateStr) {
  const settings = await getSettings();

  if (!settings.token) {
    throw new Error('GitHub token not configured. Open settings to add it.');
  }

  if (!settings.username) {
    throw new Error('GitHub username not configured. Open settings to add it.');
  }

  if (!settings.organization) {
    throw new Error('GitHub organization not configured. Open settings to add it.');
  }

  const date = parseDate(dateStr);
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);

  const since = toISODate(date);
  const until = toISODate(nextDate);

  // Fetch all repos
  const repos = await fetchOrgRepos(settings);

  // Fetch commits from all repos in parallel
  const commitPromises = repos.map(repo =>
    fetchRepoCommits(settings, repo, since, until)
  );

  const results = await Promise.all(commitPromises);

  // Flatten and deduplicate commits
  const allCommits = results.flat();

  // Deduplicate by SHA (in case of forks)
  const uniqueCommits = [];
  const seenShas = new Set();

  for (const commit of allCommits) {
    if (!seenShas.has(commit.sha)) {
      seenShas.add(commit.sha);
      uniqueCommits.push(commit);
    }
  }

  // Sort by date (newest first)
  uniqueCommits.sort((a, b) =>
    new Date(b.commit.author.date) - new Date(a.commit.author.date)
  );

  return uniqueCommits;
}
