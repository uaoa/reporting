document.addEventListener('DOMContentLoaded', async () => {
  const tabs = document.querySelectorAll('.tab');
  const commitsTab = document.getElementById('commitsTab');
  const mappingsTab = document.getElementById('mappingsTab');
  const datePicker = document.getElementById('datePicker');
  const loadBtn = document.getElementById('loadBtn');
  const loading = document.getElementById('loading');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const commitsList = document.getElementById('commitsList');
  const mappingForm = document.getElementById('mappingForm');
  const mappingsList = document.getElementById('mappingsList');
  const ticketInput = document.getElementById('ticketInput');
  const slugInput = document.getElementById('slugInput');
  const openSettings = document.getElementById('openSettings');
  const toast = document.getElementById('toast');

  let mappings = {};

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      commitsTab.style.display = tabName === 'commits' ? 'block' : 'none';
      mappingsTab.style.display = tabName === 'mappings' ? 'block' : 'none';
    });
  });

  // Toast notification
  function showToast(message = 'Copied!') {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // Copy to clipboard
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast();
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  // Load mappings from storage
  async function loadMappings() {
    const result = await chrome.storage.sync.get('mappings');
    mappings = result.mappings || {};
    renderMappings();
  }

  // Save mappings to storage
  async function saveMappings() {
    await chrome.storage.sync.set({ mappings });
    renderMappings();
  }

  // Render mappings list
  function renderMappings() {
    const entries = Object.entries(mappings);

    if (entries.length === 0) {
      mappingsList.innerHTML = '<p class="empty-mappings">No mappings yet</p>';
      return;
    }

    mappingsList.innerHTML = entries.flatMap(([slug, tickets]) =>
      tickets.map(ticket => `
        <div class="mapping-item" data-ticket="${ticket}" data-slug="${slug}">
          <div class="mapping-info">
            <span class="mapping-ticket">${ticket}</span>
            <span class="mapping-arrow">→</span>
            <span class="mapping-slug">${slug}</span>
          </div>
          <button class="delete-btn" title="Delete">×</button>
        </div>
      `)
    ).join('');

    // Add delete handlers
    mappingsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = e.target.closest('.mapping-item');
        const ticket = item.dataset.ticket;
        const slug = item.dataset.slug;

        mappings[slug] = mappings[slug].filter(t => t !== ticket);
        if (mappings[slug].length === 0) {
          delete mappings[slug];
        }
        saveMappings();
      });
    });
  }

  // Add mapping form handler
  mappingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const ticket = ticketInput.value.trim();
    const slug = slugInput.value.trim().toLowerCase();

    if (!ticket || !slug) return;

    if (!mappings[slug]) {
      mappings[slug] = [];
    }

    if (!mappings[slug].includes(ticket)) {
      mappings[slug].push(ticket);
      saveMappings();
    }

    ticketInput.value = '';
    slugInput.value = '';
    ticketInput.focus();
  });

  // Get tickets for commit message
  function getTicketsForCommit(message) {
    const tickets = [];
    const messageLower = message.toLowerCase();

    for (const [slug, ticketList] of Object.entries(mappings)) {
      if (messageLower.includes(slug.toLowerCase())) {
        tickets.push(...ticketList);
      }
    }

    return [...new Set(tickets)];
  }

  // Render commits list
  function renderCommits(commits) {
    if (commits.length === 0) {
      loading.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    loading.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';

    commitsList.innerHTML = commits.map(commit => {
      const message = commit.commit.message.split('\n')[0];
      const tickets = getTicketsForCommit(message);

      const ticketsHtml = tickets.length > 0
        ? `<div class="commit-tickets">
            ${tickets.map(t => `<span class="ticket-badge" data-ticket="${t}">${t}</span>`).join('')}
           </div>`
        : '';

      return `
        <li class="commit-item" data-message="${message.replace(/"/g, '&quot;')}">
          <div class="commit-message">${escapeHtml(message)}</div>
          ${ticketsHtml}
        </li>
      `;
    }).join('');

    // Add click handlers for commit messages
    commitsList.querySelectorAll('.commit-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('ticket-badge')) return;
        copyToClipboard(item.dataset.message);
      });
    });

    // Add click handlers for tickets
    commitsList.querySelectorAll('.ticket-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(badge.dataset.ticket);
      });
    });
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Reset state
  function resetState() {
    loading.style.display = 'flex';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    commitsList.innerHTML = '';
  }

  // Show error
  function showError(message) {
    loading.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'block';
    errorMessage.textContent = message;
  }

  // Open settings
  openSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Convert date picker value (yyyy-mm-dd) to dd.mm.yyyy format
  function datePickerToFormat(dateValue) {
    if (!dateValue) return null;
    const [year, month, day] = dateValue.split('-');
    return `${day}.${month}.${year}`;
  }

  // Convert dd.mm.yyyy to date picker format (yyyy-mm-dd)
  function formatToDatePicker(dateStr) {
    if (!dateStr) return null;
    const [day, month, year] = dateStr.split('.');
    return `${year}-${month}-${day}`;
  }

  // Fetch commits
  async function fetchCommits(date) {
    resetState();

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'fetchCommits',
        date: date
      });

      if (response.error) {
        showError(response.error);
        return;
      }

      renderCommits(response.commits || []);
    } catch (err) {
      console.error('Failed to fetch commits:', err);
      showError('Failed to fetch commits. Check your settings.');
    }
  }

  // Load button handler
  loadBtn.addEventListener('click', () => {
    const dateValue = datePicker.value;
    if (!dateValue) {
      showError('Please select a date');
      return;
    }
    const formattedDate = datePickerToFormat(dateValue);
    fetchCommits(formattedDate);
  });

  // Auto-load on date change
  datePicker.addEventListener('change', () => {
    loadBtn.click();
  });

  // Initialize
  await loadMappings();

  // Hide loading initially
  loading.style.display = 'none';

  // Set today's date as default
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  datePicker.value = `${yyyy}-${mm}-${dd}`;
});
