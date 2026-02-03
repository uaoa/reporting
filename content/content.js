/**
 * Reporting Commits Tracker - Content Script
 * Copyright (c) 2026 Zakharii Melnyk (https://github.com/uaoa)
 * Licensed under MIT License
 */

// Content script for rep.smartcloud.com.ua
// Tracks date selection and stores it for the popup

// Parse date from "27.01.26, Tuesday" format to "27.01.2026"
function parseDateFromText(text) {
  // 4-digit year first: "27.01.2026"
  let match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) {
    return `${match[1]}.${match[2]}.${match[3]}`;
  }
  // 2-digit year: "27.01.26"
  match = text.match(/(\d{2})\.(\d{2})\.(\d{2})(?!\d)/);
  if (match) {
    return `${match[1]}.${match[2]}.20${match[3]}`;
  }
  return null;
}

// Check if extension context is still valid
function isExtensionValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// Save date and notify background
function saveDate(date) {
  if (!isExtensionValid()) return;
  chrome.storage.local.set({ selectedDate: date, selectedAt: Date.now() });
  chrome.runtime.sendMessage({ action: 'dateSelected', date }).catch(() => {});
}

// Notify when navigating to main page (no date selected)
function notifyMainPage() {
  if (!isExtensionValid()) return;
  chrome.runtime.sendMessage({ action: 'mainPage' }).catch(() => {});
}

// Track clicks on date links
document.addEventListener('click', (e) => {
  let el = e.target;
  for (let i = 0; i < 5 && el; i++) {
    if (el.tagName === 'A') {
      const date = parseDateFromText(el.title || el.textContent || '');
      if (date) {
        saveDate(date);
        return;
      }
    }
    el = el.parentElement;
  }
}, true);

// Poll for date input changes (works in iframe)
let lastDate = null;
setInterval(() => {
  if (!isExtensionValid()) return;
  const input = document.getElementById('bpfee') || document.querySelector('input[title*="date"]');
  if (input?.value) {
    const date = parseDateFromText(input.value);
    if (date && date !== lastDate) {
      lastDate = date;
      saveDate(date);
    }
  }
}, 500);

// Detect main page (no modal/iframe with date) - only in top frame
if (window === window.top) {
  // Check on page load
  const isMainPage = () => {
    const url = window.location.href;
    return url === 'https://rep.smartcloud.com.ua/' ||
           url.startsWith('https://rep.smartcloud.com.ua/?') ||
           url === 'https://rep.smartcloud.com.ua';
  };

  if (isMainPage()) {
    notifyMainPage();
  }

  // Watch for URL changes (SPA navigation)
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (isMainPage()) {
        notifyMainPage();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
