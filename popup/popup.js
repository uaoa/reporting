/**
 * Reporting Commits Tracker - Popup Script
 * Copyright (c) 2026 Zakharii Melnyk (https://github.com/uaoa)
 * Licensed under MIT License
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEVOPS_TASKS_TTL = 5 * 60 * 1000;

// Escape text for safe use in innerHTML (content and attributes)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Date helpers ("dd.mm.yyyy" is the format used across the extension)
const pad = (n) => String(n).padStart(2, '0');
const formatDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const parseDate = (s) => {
  const [day, month, year] = s.split('.');
  return new Date(year, month - 1, day);
};
const monthKey = (year, month) => `${year}-${pad(month + 1)}`;
const monthKeyOf = (s) => {
  const [, month, year] = s.split('.');
  return `${year}-${month}`;
};

document.addEventListener('DOMContentLoaded', async () => {
  const dateButton = document.getElementById('dateButton');
  const refreshCommits = document.getElementById('refreshCommits');
  const calendar = document.getElementById('calendar');
  const calendarTitle = document.getElementById('calendarTitle');
  const calendarSpinner = document.getElementById('calendarSpinner');
  const calendarGrid = document.getElementById('calendarGrid');
  const prevMonth = document.getElementById('prevMonth');
  const nextMonth = document.getElementById('nextMonth');
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
  const importMappingsBtn = document.getElementById('importMappings');
  const exportMappingsBtn = document.getElementById('exportMappings');
  const importFile = document.getElementById('importFile');

  // DevOps elements
  const devopsLoading = document.getElementById('devopsLoading');
  const devopsEmptyState = document.getElementById('devopsEmptyState');
  const devopsErrorState = document.getElementById('devopsErrorState');
  const devopsErrorMessage = document.getElementById('devopsErrorMessage');
  const tasksList = document.getElementById('tasksList');
  const openDevopsSettings = document.getElementById('openDevopsSettings');
  const projectFilter = document.getElementById('projectFilter');

  // Read everything the popup needs in two parallel storage calls
  const [{ settings, mappings: storedMappings }, local] = await Promise.all([
    chrome.storage.sync.get(['settings', 'mappings']),
    chrome.storage.local.get([
      'selectedDate', 'selectedAt', 'lastActiveTab', 'lastCopied', 'selectedProject',
      'commitsCache', 'monthsCache', 'cachedDevopsTasks', 'cachedDevopsTime'
    ])
  ]);

  const hasGithub = settings?.token && settings?.username && settings?.organization;
  const hasDevops = settings?.devopsToken && settings?.devopsOrganization;

  // If nothing is configured, redirect to options
  if (!hasGithub && !hasDevops) {
    chrome.runtime.openOptionsPage();
    return;
  }

  let mappings = storedMappings || {};
  let lastCopied = local.lastCopied;
  let selectedProject = local.selectedProject;
  let commitsCache = local.commitsCache || {};
  let commitsLoaded = false;
  let devopsTasksLoaded = false;
  let allDevopsTasks = local.cachedDevopsTasks || [];

  // Month -> Set of dates with commits, used to disable empty days in the calendar
  const monthDays = Object.fromEntries(
    Object.entries(local.monthsCache || {}).map(([key, entry]) => [key, new Set(entry.days)])
  );

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

    // Load commits/tasks when their tab is shown for the first time
    if (tabName === 'commits' && !commitsLoaded && canShowCommits) {
      loadCommits(currentDate);
    }
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
    lastCopied = text;
    chrome.storage.local.set({ lastCopied: text });
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
  const populateTicketDatalist = () => {
    const datalist = document.getElementById('ticketOptions');
    if (!datalist || !hasDevops || !allDevopsTasks.length) return;

    datalist.innerHTML = allDevopsTasks.map(task => {
      const title = task.title.length > 50 ? `${task.title.substring(0, 50)}...` : task.title;
      return `<option value="${esc(task.id)}">${esc(task.id)} - ${esc(title)}</option>`;
    }).join('');
  };

  // Save mappings
  const saveMappings = async () => {
    await chrome.storage.sync.set({ mappings });
    renderMappings();
    if (commitsLoaded) renderCommits(commitsCache[currentDate]?.commits || []);
  };

  // Render mappings - grouped by ticket
  const renderMappings = () => {
    const entries = Object.entries(mappings);
    if (!entries.length) {
      mappingsList.innerHTML = '<p class="empty-mappings">No mappings yet</p>';
      return;
    }

    // Group by ticket: { ticket: [slug1, slug2, ...] }
    const byTicket = {};
    for (const [slug, tickets] of entries) {
      for (const ticket of tickets) {
        if (!byTicket[ticket]) byTicket[ticket] = [];
        byTicket[ticket].push(slug);
      }
    }

    mappingsList.innerHTML = Object.entries(byTicket).map(([ticket, slugs]) => `
      <div class="mapping-item" data-ticket="${esc(ticket)}">
        <div class="mapping-info">
          <span class="mapping-ticket">${esc(ticket)}</span>
          <span class="mapping-arrow">→</span>
          <div class="mapping-slugs">
            ${slugs.map(s => `<span class="mapping-slug" data-slug="${esc(s)}">${esc(s)} <button class="delete-slug-btn" title="Remove slug">×</button></span>`).join('')}
          </div>
        </div>
        <button class="delete-btn" title="Delete all">×</button>
      </div>
    `).join('');
  };

  mappingsList.addEventListener('click', (e) => {
    const item = e.target.closest('.mapping-item');
    if (!item) return;
    const ticket = item.dataset.ticket;

    // Delete single slug from ticket
    if (e.target.closest('.delete-slug-btn')) {
      const slug = e.target.closest('.mapping-slug').dataset.slug;
      mappings[slug] = mappings[slug].filter(t => t !== ticket);
      if (!mappings[slug].length) delete mappings[slug];
      saveMappings();
      return;
    }

    // Delete all slugs for ticket
    if (e.target.closest('.delete-btn')) {
      for (const slug of Object.keys(mappings)) {
        mappings[slug] = mappings[slug].filter(t => t !== ticket);
        if (!mappings[slug].length) delete mappings[slug];
      }
      saveMappings();
    }
  });

  // Add mapping
  mappingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const ticket = ticketInput.value.trim();
    const slug = slugInput.value.trim().toLowerCase();
    if (!ticket || !slug) return;

    if (!mappings[slug]) mappings[slug] = [];
    if (!mappings[slug].includes(ticket)) {
      mappings[slug].push(ticket);
    }
    saveMappings();
    slugInput.value = '';
    slugInput.focus();
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
    errorState.style.display = 'none';

    if (!commits.length) {
      emptyState.style.display = 'block';
      commitsList.innerHTML = '';
      return;
    }
    emptyState.style.display = 'none';

    commitsList.innerHTML = commits.map(c => {
      const msg = (c.message || '').split('\n')[0];
      const tickets = getTicketsForCommit(msg);
      const sourceBadge = c.source === 'devops'
        ? `<span class="source-badge source-devops">DevOps</span>`
        : `<span class="source-badge source-github">GitHub</span>`;
      return `
        <li class="commit-item${msg === lastCopied ? ' copied' : ''}" data-message="${esc(msg)}">
          <div class="commit-main">
            <div class="commit-message">${esc(msg)}</div>
            <div class="commit-meta">
              ${sourceBadge}
              ${tickets.map(t => `<span class="ticket-badge${t === lastCopied ? ' copied' : ''}" data-ticket="${esc(t)}">${esc(t)}</span>`).join('')}
            </div>
          </div>
        </li>
      `;
    }).join('');

    const copied = commitsList.querySelector('.copied');
    if (copied) lastCopiedElement = copied;
  };

  commitsList.addEventListener('click', (e) => {
    const badge = e.target.closest('.ticket-badge');
    if (badge) {
      copyToClipboard(badge.dataset.ticket, badge);
      return;
    }
    const item = e.target.closest('.commit-item');
    if (item) copyToClipboard(item.dataset.message, item);
  });

  // Show error
  const showError = (msg) => {
    loading.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'block';
    errorMessage.textContent = msg;
    commitsList.innerHTML = '';
  };

  const sameCommits = (a, b) => a.length === b.length && a.every((c, i) => c.sha === b[i].sha);

  // Render cached commits instantly, then let the background revalidate
  let commitsRequest = 0;
  let firstCommitsLoad = null;
  const loadCommits = (date, forceRefresh = false) => {
    const promise = fetchCommits(date, forceRefresh);
    if (!commitsLoaded) firstCommitsLoad = promise;
    commitsLoaded = true;
    return promise;
  };

  const fetchCommits = async (date, forceRefresh) => {
    const request = ++commitsRequest;
    const cached = !forceRefresh && commitsCache[date];

    if (cached) {
      renderCommits(cached.commits);
    } else {
      loading.style.display = 'flex';
      emptyState.style.display = 'none';
      errorState.style.display = 'none';
      commitsList.innerHTML = '';
    }

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchCommits', date, force: forceRefresh });
      if (request !== commitsRequest) return;
      if (response.error) {
        if (!cached) showError(response.error);
        return;
      }
      const commits = response.commits || [];
      commitsCache[date] = { commits };

      const days = monthDays[monthKeyOf(date)];
      if (days) {
        if (commits.length) days.add(date); else days.delete(date);
        if (calendar.matches(':popover-open')) renderCalendar();
      }

      if (!cached || !sameCommits(cached.commits, commits)) renderCommits(commits);
    } catch {
      if (request === commitsRequest && !cached) showError('Failed to fetch commits. Check your settings.');
    }
  };

  // ===== Calendar =====

  let currentDate = local.selectedDate || formatDate(new Date());
  let viewYear;
  let viewMonth;
  const requestedMonths = new Set();

  const updateDateButton = () => {
    const weekday = parseDate(currentDate).toLocaleDateString('en-GB', { weekday: 'short' });
    dateButton.textContent = `${weekday} ${currentDate}`;
  };

  // Ask background for days with commits (cached there); never blocks the UI
  const loadMonth = async (year, month) => {
    const key = monthKey(year, month);
    if (requestedMonths.has(key)) return;
    requestedMonths.add(key);
    if (calendar.matches(':popover-open')) renderCalendar();

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchMonth', year, month });
      if (response.error) {
        requestedMonths.delete(key);
      } else {
        monthDays[key] = new Set(response.days);
        // Month fetch also warmed the per-day cache in storage
        const { commitsCache: fresh } = await chrome.storage.local.get('commitsCache');
        commitsCache = fresh || commitsCache;
      }
    } catch {
      requestedMonths.delete(key);
    }
    if (calendar.matches(':popover-open')) renderCalendar();
  };

  const renderCalendar = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = formatDate(today);
    const key = monthKey(viewYear, viewMonth);
    const active = monthDays[key];

    calendarTitle.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    calendarSpinner.hidden = !(requestedMonths.has(key) && !active);
    nextMonth.disabled = viewYear * 12 + viewMonth >= today.getFullYear() * 12 + today.getMonth();

    // Monday-first offset
    const offset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    let html = '<span></span>'.repeat(offset);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(viewYear, viewMonth, day);
      const value = formatDate(date);
      const hasCommits = active?.has(value);
      // Today and the selected day stay clickable: their data may be newer than the month cache
      const disabled = date > today || (active && !hasCommits && value !== todayStr && value !== currentDate);
      const classes = [
        'calendar-day',
        hasCommits && 'has-commits',
        value === todayStr && 'today',
        value === currentDate && 'selected'
      ].filter(Boolean).join(' ');
      html += `<button type="button" class="${classes}" data-date="${value}"${disabled ? ' disabled' : ''}>${day}</button>`;
    }
    calendarGrid.innerHTML = html;
  };

  const showMonth = (year, month) => {
    viewYear = year;
    viewMonth = month;
    renderCalendar();
    loadMonth(year, month);
  };

  calendar.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const d = parseDate(currentDate);
    showMonth(d.getFullYear(), d.getMonth());
  });

  prevMonth.addEventListener('click', () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    showMonth(d.getFullYear(), d.getMonth());
  });

  nextMonth.addEventListener('click', () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    showMonth(d.getFullYear(), d.getMonth());
  });

  calendarGrid.addEventListener('click', (e) => {
    const day = e.target.closest('.calendar-day');
    if (!day || day.disabled) return;
    calendar.hidePopover();
    if (day.dataset.date === currentDate) return;

    currentDate = day.dataset.date;
    updateDateButton();
    // Remember manual choice so the popup reopens on this day
    chrome.storage.local.set({ selectedDate: currentDate });
    loadCommits(currentDate);
  });

  refreshCommits.addEventListener('click', () => loadCommits(currentDate, true));

  // ===== DevOps Tasks =====

  // Populate project filter dropdown
  const populateProjectFilter = (tasks) => {
    const projects = [...new Set(tasks.map(t => t.project))].sort();
    projectFilter.innerHTML = '<option value="">All Projects</option>' +
      projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  };

  // Filter and render tasks
  const filterAndRenderTasks = () => {
    const project = projectFilter.value;
    const filteredTasks = project
      ? allDevopsTasks.filter(t => t.project === project)
      : allDevopsTasks;
    renderTasksList(filteredTasks);
  };

  const renderTasksList = (tasks) => {
    if (!tasks.length) {
      devopsEmptyState.style.display = 'block';
      tasksList.innerHTML = '';
      return;
    }
    devopsEmptyState.style.display = 'none';
    devopsErrorState.style.display = 'none';

    tasksList.innerHTML = tasks.map(task => `
      <li class="task-item" data-id="${esc(task.id)}">
        <div class="task-main">
          <span class="task-id${String(task.id) === lastCopied ? ' copied' : ''}" data-id="${esc(task.id)}" title="Click to copy">${esc(task.id)}</span>
          <span class="task-title">${esc(task.title)}</span>
        </div>
        <div class="task-meta">
          <span class="task-project">${esc(task.project)}</span>
          <span class="task-type task-type-${esc(String(task.type).toLowerCase().replace(/\s+/g, '-'))}">${esc(task.type)}</span>
          <a href="${esc(task.url)}" target="_blank" class="task-link" title="Open in DevOps">↗</a>
        </div>
      </li>
    `).join('');

    const copied = tasksList.querySelector('.task-id.copied');
    if (copied) lastCopiedElement = copied;
  };

  // Click to copy task ID
  tasksList.addEventListener('click', (e) => {
    const el = e.target.closest('.task-id');
    if (el) copyToClipboard(el.dataset.id, el);
  });

  const renderDevopsTasks = (tasks) => {
    devopsLoading.style.display = 'none';
    allDevopsTasks = tasks;
    populateProjectFilter(tasks);

    // Restore saved project filter
    if (selectedProject && [...projectFilter.options].some(o => o.value === selectedProject)) {
      projectFilter.value = selectedProject;
    }
    filterAndRenderTasks();
  };

  // Project filter change handler
  projectFilter.addEventListener('change', () => {
    selectedProject = projectFilter.value;
    chrome.storage.local.set({ selectedProject });
    filterAndRenderTasks();
  });

  const showDevopsError = (msg) => {
    devopsLoading.style.display = 'none';
    devopsEmptyState.style.display = 'none';
    devopsErrorState.style.display = 'block';
    devopsErrorMessage.textContent = msg;
  };

  // Show cached tasks instantly, refresh in background when older than TTL
  const fetchDevopsTasks = async () => {
    devopsTasksLoaded = true;
    const cached = local.cachedDevopsTasks;

    if (cached) {
      renderDevopsTasks(cached);
      if (Date.now() - (local.cachedDevopsTime || 0) < DEVOPS_TASKS_TTL) return;
    } else {
      devopsLoading.style.display = 'flex';
      devopsEmptyState.style.display = 'none';
      devopsErrorState.style.display = 'none';
      tasksList.innerHTML = '';
    }

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetchDevopsTasks' });
      if (response.error) {
        if (!cached) showDevopsError(response.error);
        return;
      }
      const tasks = response.tasks || [];
      chrome.storage.local.set({ cachedDevopsTasks: tasks, cachedDevopsTime: Date.now() });
      if (JSON.stringify(tasks) !== JSON.stringify(cached)) renderDevopsTasks(tasks);
    } catch {
      if (!cached) showDevopsError('Failed to fetch tasks. Check your settings.');
    }
  };

  // Event handlers
  openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  openDevopsSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Export mappings
  exportMappingsBtn.addEventListener('click', () => {
    const data = JSON.stringify(mappings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mappings.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported!');
  });

  // Import mappings
  importMappingsBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (typeof imported === 'object' && imported !== null) {
        // Merge with existing mappings
        for (const [slug, tickets] of Object.entries(imported)) {
          if (Array.isArray(tickets)) {
            if (!mappings[slug]) mappings[slug] = [];
            for (const ticket of tickets) {
              if (!mappings[slug].includes(ticket)) {
                mappings[slug].push(ticket);
              }
            }
          }
        }
        await saveMappings();
        showToast('Imported!');
      }
    } catch {
      showToast('Invalid file');
    }
    importFile.value = '';
  });

  // Initialize
  renderMappings();
  updateDateButton();

  // Check if date was recently selected from rep.smartcloud.com.ua
  const dateSelectedRecently = local.selectedAt && (Date.now() - local.selectedAt < 10000); // within 10 seconds

  let initialTab = local.lastActiveTab;

  // If date was selected recently, force commits tab
  if (dateSelectedRecently && canShowCommits) {
    initialTab = 'commits';
  }

  // Validate that the tab is available
  if (initialTab === 'commits' && !canShowCommits) initialTab = null;
  if (initialTab === 'devops' && !hasDevops) initialTab = null;

  if (!initialTab) {
    initialTab = canShowCommits ? 'commits' : (hasDevops ? 'devops' : 'mappings');
  }

  if (initialTab !== 'commits') {
    loading.style.display = 'none';
  }

  switchTab(initialTab);

  // Warm up calendar data once the day's commits are loaded, so it doesn't compete with them
  if (canShowCommits) {
    const d = parseDate(currentDate);
    Promise.resolve(firstCommitsLoad).then(() => loadMonth(d.getFullYear(), d.getMonth()));
  }
});
