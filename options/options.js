document.addEventListener('DOMContentLoaded', async () => {
  // GitHub elements
  const githubForm = document.getElementById('githubForm');
  const tokenInput = document.getElementById('token');
  const usernameInput = document.getElementById('username');
  const organizationInput = document.getElementById('organization');
  const testGithubBtn = document.getElementById('testGithubBtn');
  const githubStatus = document.getElementById('githubStatus');

  // DevOps elements
  const devopsForm = document.getElementById('devopsForm');
  const devopsTokenInput = document.getElementById('devopsToken');
  const devopsOrganizationInput = document.getElementById('devopsOrganization');
  const testDevopsBtn = document.getElementById('testDevopsBtn');
  const devopsStatus = document.getElementById('devopsStatus');

  // Commits source elements
  const commitsSourceForm = document.getElementById('commitsSourceForm');
  const sourceGithub = document.getElementById('sourceGithub');
  const sourceDevops = document.getElementById('sourceDevops');
  const sourceBoth = document.getElementById('sourceBoth');
  const sourceStatus = document.getElementById('sourceStatus');

  // Load existing settings
  const result = await chrome.storage.sync.get('settings');
  const settings = result.settings || {};

  // Populate GitHub fields
  if (settings.token) tokenInput.value = settings.token;
  if (settings.username) usernameInput.value = settings.username;
  if (settings.organization) organizationInput.value = settings.organization;

  // Populate DevOps fields
  if (settings.devopsToken) devopsTokenInput.value = settings.devopsToken;
  if (settings.devopsOrganization) devopsOrganizationInput.value = settings.devopsOrganization;

  // Populate commits source
  const commitsSource = settings.commitsSource || 'both';
  if (commitsSource === 'github') sourceGithub.checked = true;
  else if (commitsSource === 'devops') sourceDevops.checked = true;
  else sourceBoth.checked = true;

  // Show status message
  function showStatus(element, message, isError = false) {
    element.textContent = message;
    element.className = `status ${isError ? 'error' : 'success'}`;
  }

  // Save GitHub settings
  githubForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await chrome.storage.sync.get('settings');
    const currentSettings = result.settings || {};

    const newSettings = {
      ...currentSettings,
      token: tokenInput.value.trim(),
      username: usernameInput.value.trim(),
      organization: organizationInput.value.trim()
    };

    await chrome.storage.sync.set({ settings: newSettings });
    showStatus(githubStatus, 'GitHub settings saved!');
  });

  // Save DevOps settings
  devopsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await chrome.storage.sync.get('settings');
    const currentSettings = result.settings || {};

    const newSettings = {
      ...currentSettings,
      devopsToken: devopsTokenInput.value.trim(),
      devopsOrganization: devopsOrganizationInput.value.trim()
    };

    await chrome.storage.sync.set({ settings: newSettings });
    showStatus(devopsStatus, 'DevOps settings saved!');
  });

  // Test GitHub connection
  testGithubBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const username = usernameInput.value.trim();
    const organization = organizationInput.value.trim();

    if (!token || !username || !organization) {
      showStatus(githubStatus, 'Please fill in all GitHub fields', true);
      return;
    }

    testGithubBtn.disabled = true;
    testGithubBtn.textContent = 'Testing...';

    try {
      const userResponse = await fetch(`https://api.github.com/users/${username}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!userResponse.ok) {
        if (userResponse.status === 401) throw new Error('Invalid token');
        if (userResponse.status === 404) throw new Error('User not found');
        throw new Error('Failed to verify user');
      }

      const orgResponse = await fetch(`https://api.github.com/orgs/${organization}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!orgResponse.ok) {
        if (orgResponse.status === 404) throw new Error('Organization not found');
        throw new Error('Failed to verify organization');
      }

      const reposResponse = await fetch(`https://api.github.com/orgs/${organization}/repos?per_page=1`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!reposResponse.ok) {
        throw new Error('Cannot access organization repositories');
      }

      showStatus(githubStatus, 'GitHub connection successful!');
    } catch (error) {
      showStatus(githubStatus, `Connection failed: ${error.message}`, true);
    } finally {
      testGithubBtn.disabled = false;
      testGithubBtn.textContent = 'Test';
    }
  });

  // Test DevOps connection
  testDevopsBtn.addEventListener('click', async () => {
    const token = devopsTokenInput.value.trim();
    const organization = devopsOrganizationInput.value.trim();

    if (!token || !organization) {
      showStatus(devopsStatus, 'Please fill in all DevOps fields', true);
      return;
    }

    testDevopsBtn.disabled = true;
    testDevopsBtn.textContent = 'Testing...';

    try {
      // Test by fetching projects
      const response = await fetch(`https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`, {
        headers: {
          'Authorization': `Basic ${btoa(':' + token)}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid token or insufficient permissions');
        }
        if (response.status === 404) {
          throw new Error('Organization not found');
        }
        throw new Error('Failed to connect to DevOps');
      }

      const data = await response.json();
      showStatus(devopsStatus, `DevOps connection successful! Found ${data.count} projects.`);
    } catch (error) {
      showStatus(devopsStatus, `Connection failed: ${error.message}`, true);
    } finally {
      testDevopsBtn.disabled = false;
      testDevopsBtn.textContent = 'Test';
    }
  });

  // Save commits source
  commitsSourceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await chrome.storage.sync.get('settings');
    const currentSettings = result.settings || {};

    let selectedSource = 'both';
    if (sourceGithub.checked) selectedSource = 'github';
    else if (sourceDevops.checked) selectedSource = 'devops';

    const newSettings = {
      ...currentSettings,
      commitsSource: selectedSource
    };

    await chrome.storage.sync.set({ settings: newSettings });
    showStatus(sourceStatus, 'Commits source saved!');
  });
});
