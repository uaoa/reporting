document.addEventListener('DOMContentLoaded', async () => {
  const datePicker = document.getElementById('datePicker');
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
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('commitsTab').style.display = tab.dataset.tab === 'commits' ? 'block' : 'none';
      document.getElementById('mappingsTab').style.display = tab.dataset.tab === 'mappings' ? 'block' : 'none';
    });
  });

  // Toast
  const showToast = (msg = 'Copied!') => {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  };

  // Copy to clipboard
  const copyToClipboard = async (text) => {
    await navigator.clipboard.writeText(text);
    showToast();
  };

  // Load/save mappings
  const loadMappings = async () => {
    const { mappings: m } = await chrome.storage.sync.get('mappings');
    mappings = m || {};
    renderMappings();
  };

  const saveMappings = async () => {
    await chrome.storage.sync.set({ mappings });
    renderMappings();
  };

  // Render mappings
  let editingItem = null;

  const renderMappings = () => {
    const entries = Object.entries(mappings);
    if (!entries.length) {
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
          <div class="mapping-actions">
            <button class="edit-btn" title="Edit">✎</button>
            <button class="delete-btn" title="Delete">×</button>
          </div>
        </div>
      `)
    ).join('');

    mappingsList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = e.target.closest('.mapping-item');
        const { ticket, slug } = item.dataset;
        ticketInput.value = ticket;
        slugInput.value = slug;
        editingItem = { ticket, slug };
        ticketInput.focus();
      });
    });

    mappingsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = e.target.closest('.mapping-item');
        const { ticket, slug } = item.dataset;
        mappings[slug] = mappings[slug].filter(t => t !== ticket);
        if (!mappings[slug].length) delete mappings[slug];
        saveMappings();
      });
    });
  };

  // Add/edit mapping
  mappingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const ticket = ticketInput.value.trim();
    const slug = slugInput.value.trim().toLowerCase();
    if (!ticket || !slug) return;

    // If editing, remove old mapping first
    if (editingItem) {
      mappings[editingItem.slug] = mappings[editingItem.slug].filter(t => t !== editingItem.ticket);
      if (!mappings[editingItem.slug].length) delete mappings[editingItem.slug];
      editingItem = null;
    }

    if (!mappings[slug]) mappings[slug] = [];
    if (!mappings[slug].includes(ticket)) {
      mappings[slug].push(ticket);
    }
    saveMappings();
    ticketInput.value = '';
    slugInput.value = '';
    ticketInput.focus();
  });

  // Get tickets for commit
  const getTicketsForCommit = (message) => {
    const msgLower = message.toLowerCase();
    const tickets = [];
    for (const [slug, ticketList] of Object.entries(mappings)) {
      if (msgLower.includes(slug.toLowerCase())) tickets.push(...ticketList);
    }
    return [...new Set(tickets)];
  };

  // Render commits
  const renderCommits = (commits) => {
    loading.style.display = 'none';
    if (!commits.length) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    errorState.style.display = 'none';

    commitsList.innerHTML = commits.map(c => {
      const msg = c.commit.message.split('\n')[0];
      const tickets = getTicketsForCommit(msg);
      return `
        <li class="commit-item" data-message="${msg.replace(/"/g, '&quot;')}">
          <div class="commit-message">${msg.replace(/</g, '&lt;')}</div>
          ${tickets.length ? `<div class="commit-tickets">${tickets.map(t => `<span class="ticket-badge" data-ticket="${t}">${t}</span>`).join('')}</div>` : ''}
        </li>
      `;
    }).join('');

    commitsList.querySelectorAll('.commit-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('ticket-badge')) copyToClipboard(item.dataset.message);
      });
    });

    commitsList.querySelectorAll('.ticket-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(badge.dataset.ticket);
      });
    });
  };

  // Show error
  const showError = (msg) => {
    loading.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'block';
    errorMessage.textContent = msg;
  };

  // Fetch commits
  const fetchCommits = async (date) => {
    loading.style.display = 'flex';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    commitsList.innerHTML = '';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchCommits', date });
      if (response.error) {
        showError(response.error);
      } else {
        renderCommits(response.commits || []);
      }
    } catch {
      showError('Failed to fetch commits. Check your settings.');
    }
  };

  // Date helpers
  const toPickerFormat = (d) => d.split('.').reverse().join('-');
  const toDisplayFormat = (d) => d.split('-').reverse().join('.');

  // Event handlers
  openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  datePicker.addEventListener('change', () => datePicker.value && fetchCommits(toDisplayFormat(datePicker.value)));

  // Initialize
  await loadMappings();
  const { selectedDate } = await chrome.storage.local.get('selectedDate');

  if (selectedDate) {
    datePicker.value = toPickerFormat(selectedDate);
    fetchCommits(selectedDate);
  } else {
    const today = new Date();
    datePicker.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    loading.style.display = 'none';
  }
});
