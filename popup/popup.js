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

  // DevOps elements
  const devopsLoading = document.getElementById('devopsLoading');
  const devopsEmptyState = document.getElementById('devopsEmptyState');
  const devopsErrorState = document.getElementById('devopsErrorState');
  const devopsErrorMessage = document.getElementById('devopsErrorMessage');
  const tasksList = document.getElementById('tasksList');
  const openDevopsSettings = document.getElementById('openDevopsSettings');

  let mappings = {};
  let devopsTasksLoaded = false;

  // Check if settings are configured
  const { settings } = await chrome.storage.sync.get('settings');
  const hasGithub = settings?.token && settings?.username && settings?.organization;
  const hasDevops = settings?.devopsToken && settings?.devopsOrganization;

  // If nothing is configured, redirect to options
  if (!hasGithub && !hasDevops) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Hide tabs based on configuration
  const tabsContainer = document.getElementById('tabsContainer');
  const commitsTab = tabsContainer.querySelector('[data-tab="commits"]');
  const devopsTab = tabsContainer.querySelector('[data-tab="devops"]');

  // Get commits source setting
  const commitsSource = settings?.commitsSource || 'both';
  const canShowCommits = (commitsSource === 'github' && hasGithub) ||
                         (commitsSource === 'devops' && hasDevops) ||
                         (commitsSource === 'both' && (hasGithub || hasDevops));

  if (!canShowCommits) {
    commitsTab.style.display = 'none';
  }
  if (!hasDevops) {
    devopsTab.style.display = 'none';
  }

  // Tab switching with persistence
  const switchTab = (tabName) => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); });
    const tab = tabsContainer.querySelector(`[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    document.getElementById('commitsTab').style.display = tabName === 'commits' ? 'block' : 'none';
    document.getElementById('devopsTab').style.display = tabName === 'devops' ? 'block' : 'none';
    document.getElementById('mappingsTab').style.display = tabName === 'mappings' ? 'block' : 'none';

    // Save last active tab
    chrome.storage.local.set({ lastActiveTab: tabName });

    // Load DevOps tasks when tab is clicked for the first time
    if (tabName === 'devops' && !devopsTasksLoaded && hasDevops) {
      fetchDevopsTasks();
    }

    // Populate ticket datalist when mappings tab is opened
    if (tabName === 'mappings' && hasDevops) {
      populateTicketDatalist();
    }
  };

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Toast
  const showToast = (msg = 'Copied!') => {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  };

  // Copy to clipboard and highlight
  let lastCopiedElement = null;

  const copyToClipboard = async (text, element) => {
    await navigator.clipboard.writeText(text);
    await chrome.storage.local.set({ lastCopied: text });
    if (lastCopiedElement) {
      lastCopiedElement.classList.remove('copied');
    }
    if (element) {
      element.classList.add('copied');
      lastCopiedElement = element;
    }
    showToast();
  };

  // Populate ticket input datalist with DevOps tasks
  const populateTicketDatalist = async () => {
    const datalist = document.getElementById('ticketOptions');
    if (!datalist || !hasDevops) return;

    // Use cached tasks if available
    const { cachedDevopsTasks } = await chrome.storage.local.get('cachedDevopsTasks');
    if (cachedDevopsTasks?.length) {
      datalist.innerHTML = cachedDevopsTasks.map(task =>
        `<option value="${task.id}">${task.id} - ${task.title.substring(0, 50)}${task.title.length > 50 ? '...' : ''}</option>`
      ).join('');
    }
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
      const sourceBadge = c.source === 'devops'
        ? `<span class="source-badge source-devops">DevOps</span>`
        : `<span class="source-badge source-github">GitHub</span>`;
      return `
        <li class="commit-item" data-message="${msg.replace(/"/g, '&quot;')}">
          <div class="commit-main">
            <div class="commit-message">${msg.replace(/</g, '&lt;')}</div>
            <div class="commit-meta">
              ${sourceBadge}
              ${tickets.length ? tickets.map(t => `<span class="ticket-badge" data-ticket="${t}">${t}</span>`).join('') : ''}
            </div>
          </div>
        </li>
      `;
    }).join('');

    // Restore last copied highlight
    chrome.storage.local.get('lastCopied').then(({ lastCopied }) => {
      if (lastCopied) {
        commitsList.querySelectorAll('.commit-item').forEach(item => {
          if (item.dataset.message === lastCopied) {
            item.classList.add('copied');
            lastCopiedElement = item;
          }
        });
        commitsList.querySelectorAll('.ticket-badge').forEach(badge => {
          if (badge.dataset.ticket === lastCopied) {
            badge.classList.add('copied');
            lastCopiedElement = badge;
          }
        });
      }
    });

    commitsList.querySelectorAll('.commit-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('ticket-badge')) copyToClipboard(item.dataset.message, item);
      });
    });

    commitsList.querySelectorAll('.ticket-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(badge.dataset.ticket, badge);
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

  // Fetch commits with caching
  const fetchCommits = async (date, forceRefresh = false) => {
    if (!forceRefresh) {
      const { cachedCommits, cachedDate } = await chrome.storage.local.get(['cachedCommits', 'cachedDate']);
      if (cachedDate === date && cachedCommits) {
        loading.style.display = 'none';
        renderCommits(cachedCommits);
        return;
      }
    }

    loading.style.display = 'flex';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    commitsList.innerHTML = '';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchCommits', date });
      if (response.error) {
        showError(response.error);
      } else {
        const commits = response.commits || [];
        await chrome.storage.local.set({ cachedCommits: commits, cachedDate: date });
        renderCommits(commits);
      }
    } catch {
      showError('Failed to fetch commits. Check your settings.');
    }
  };

  // ===== DevOps Tasks =====

  const renderDevopsTasks = (tasks) => {
    devopsLoading.style.display = 'none';
    if (!tasks.length) {
      devopsEmptyState.style.display = 'block';
      return;
    }
    devopsEmptyState.style.display = 'none';
    devopsErrorState.style.display = 'none';

    tasksList.innerHTML = tasks.map(task => `
      <li class="task-item" data-id="${task.id}">
        <div class="task-main">
          <span class="task-id" data-id="${task.id}" title="Click to copy">${task.id}</span>
          <span class="task-title">${task.title.replace(/</g, '&lt;')}</span>
        </div>
        <div class="task-meta">
          <span class="task-project">${task.project}</span>
          <span class="task-type task-type-${task.type.toLowerCase().replace(/\s+/g, '-')}">${task.type}</span>
          <a href="${task.url}" target="_blank" class="task-link" title="Open in DevOps">↗</a>
        </div>
      </li>
    `).join('');

    // Restore last copied highlight
    chrome.storage.local.get('lastCopied').then(({ lastCopied }) => {
      if (lastCopied) {
        tasksList.querySelectorAll('.task-id').forEach(el => {
          if (el.dataset.id === lastCopied) {
            el.classList.add('copied');
            lastCopiedElement = el;
          }
        });
      }
    });

    // Click to copy task ID
    tasksList.querySelectorAll('.task-id').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(el.dataset.id, el);
      });
    });
  };

  const showDevopsError = (msg) => {
    devopsLoading.style.display = 'none';
    devopsEmptyState.style.display = 'none';
    devopsErrorState.style.display = 'block';
    devopsErrorMessage.textContent = msg;
  };

  const fetchDevopsTasks = async (forceRefresh = false) => {
    devopsTasksLoaded = true;

    // Check cache first
    if (!forceRefresh) {
      const { cachedDevopsTasks, cachedDevopsTime } = await chrome.storage.local.get(['cachedDevopsTasks', 'cachedDevopsTime']);
      // Cache for 5 minutes
      if (cachedDevopsTasks && cachedDevopsTime && (Date.now() - cachedDevopsTime < 5 * 60 * 1000)) {
        devopsLoading.style.display = 'none';
        renderDevopsTasks(cachedDevopsTasks);
        return;
      }
    }

    devopsLoading.style.display = 'flex';
    devopsEmptyState.style.display = 'none';
    devopsErrorState.style.display = 'none';
    tasksList.innerHTML = '';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchDevopsTasks' });
      if (response.error) {
        showDevopsError(response.error);
      } else {
        const tasks = response.tasks || [];
        await chrome.storage.local.set({ cachedDevopsTasks: tasks, cachedDevopsTime: Date.now() });
        renderDevopsTasks(tasks);
      }
    } catch {
      showDevopsError('Failed to fetch tasks. Check your settings.');
    }
  };

  // Date helpers
  const toPickerFormat = (d) => d.split('.').reverse().join('-');
  const toDisplayFormat = (d) => d.split('-').reverse().join('.');

  // Event handlers
  openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  openDevopsSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  datePicker.addEventListener('change', () => datePicker.value && fetchCommits(toDisplayFormat(datePicker.value)));

  // Initialize
  await loadMappings();

  // Restore last active tab or select first available
  const { lastActiveTab } = await chrome.storage.local.get('lastActiveTab');
  let initialTab = lastActiveTab;

  // Validate that the tab is available
  if (initialTab === 'commits' && !canShowCommits) initialTab = null;
  if (initialTab === 'devops' && !hasDevops) initialTab = null;

  if (!initialTab) {
    initialTab = canShowCommits ? 'commits' : (hasDevops ? 'devops' : 'mappings');
  }

  switchTab(initialTab);

  if (canShowCommits && initialTab === 'commits') {
    const { selectedDate } = await chrome.storage.local.get('selectedDate');
    if (selectedDate) {
      datePicker.value = toPickerFormat(selectedDate);
      fetchCommits(selectedDate);
    } else {
      const today = new Date();
      datePicker.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      loading.style.display = 'none';
    }
  } else {
    loading.style.display = 'none';
  }
});
