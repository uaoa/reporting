document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settingsForm');
  const tokenInput = document.getElementById('token');
  const usernameInput = document.getElementById('username');
  const organizationInput = document.getElementById('organization');
  const testBtn = document.getElementById('testBtn');
  const status = document.getElementById('status');

  // Load existing settings
  const result = await chrome.storage.sync.get('settings');
  const settings = result.settings || {};

  if (settings.token) tokenInput.value = settings.token;
  if (settings.username) usernameInput.value = settings.username;
  if (settings.organization) organizationInput.value = settings.organization;

  // Show status message
  function showStatus(message, isError = false) {
    status.textContent = message;
    status.className = `status ${isError ? 'error' : 'success'}`;
  }

  // Save settings
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newSettings = {
      token: tokenInput.value.trim(),
      username: usernameInput.value.trim(),
      organization: organizationInput.value.trim()
    };

    await chrome.storage.sync.set({ settings: newSettings });
    showStatus('Settings saved successfully!');
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const username = usernameInput.value.trim();
    const organization = organizationInput.value.trim();

    if (!token || !username || !organization) {
      showStatus('Please fill in all fields', true);
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    try {
      // Test user
      const userResponse = await fetch(`https://api.github.com/users/${username}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!userResponse.ok) {
        if (userResponse.status === 401) {
          throw new Error('Invalid token');
        }
        if (userResponse.status === 404) {
          throw new Error('User not found');
        }
        throw new Error('Failed to verify user');
      }

      // Test organization
      const orgResponse = await fetch(`https://api.github.com/orgs/${organization}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!orgResponse.ok) {
        if (orgResponse.status === 404) {
          throw new Error('Organization not found');
        }
        throw new Error('Failed to verify organization');
      }

      // Test repos access
      const reposResponse = await fetch(`https://api.github.com/orgs/${organization}/repos?per_page=1`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!reposResponse.ok) {
        throw new Error('Cannot access organization repositories');
      }

      showStatus('Connection successful! All settings are valid.');

    } catch (error) {
      showStatus(`Connection failed: ${error.message}`, true);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });
});
