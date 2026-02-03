# Privacy Policy for Reporting Commits Tracker

**Last updated:** February 2026

## Overview

Reporting Commits Tracker is a browser extension that helps developers track their commits from GitHub and Azure DevOps for daily reporting purposes. This privacy policy explains what data the extension accesses and how it is used.

## Data Collection

### What We Do NOT Collect
- We do NOT collect any personal information
- We do NOT track your browsing activity
- We do NOT send any data to our servers
- We do NOT use analytics or tracking services
- We do NOT share any data with third parties

### What Data Is Stored Locally
The extension stores the following data locally in your browser using Chrome's storage API:

1. **Settings** (stored in `chrome.storage.sync`):
   - GitHub Personal Access Token (encrypted by Chrome)
   - GitHub username
   - GitHub organization name
   - Azure DevOps Personal Access Token (encrypted by Chrome)
   - Azure DevOps organization name
   - Commits source preference

2. **Cache** (stored in `chrome.storage.local`):
   - Cached commits for the last selected date
   - Cached DevOps tasks (expires after 5 minutes)
   - Last selected date
   - Last active tab
   - Selected project filter
   - Last copied item

3. **Mappings** (stored in `chrome.storage.sync`):
   - User-defined ticket-to-keyword mappings

All this data is stored locally in your browser and synced across your Chrome browsers if you're signed in to Chrome. Google handles the synchronization securely.

## External Services

The extension connects to the following external services:

### 1. GitHub API (api.github.com)
- **Purpose**: Fetch your commits from GitHub repositories
- **Data sent**: Your Personal Access Token (for authentication), organization name, username, date range
- **Data received**: List of commits matching your criteria
- **Privacy policy**: [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)

### 2. Azure DevOps API (dev.azure.com)
- **Purpose**: Fetch your commits and work items from Azure DevOps
- **Data sent**: Your Personal Access Token (for authentication), organization name, date range
- **Data received**: List of commits and work items assigned to you
- **Privacy policy**: [Microsoft Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement)

### 3. rep.smartcloud.com.ua
- **Purpose**: Detect selected reporting date
- **Data sent**: None (content script only reads the page)
- **Data received**: Selected date from the page

## Permissions

The extension requests only the minimum permissions necessary:

- **storage**: Required to save your settings and cached data locally
- **contextMenus**: Required to add "About" option to the extension icon menu
- **Host permissions for api.github.com**: Required to fetch commits from GitHub
- **Host permissions for dev.azure.com**: Required to fetch commits and tasks from Azure DevOps
- **Host permissions for rep.smartcloud.com.ua**: Required to detect the selected reporting date

## Data Security

- Personal Access Tokens are stored using Chrome's built-in storage API, which encrypts sensitive data
- All API communications use HTTPS encryption
- Tokens are only sent to their respective services (GitHub token to GitHub, DevOps token to Azure DevOps)
- No data is transmitted to any other servers

## Your Control

You have full control over your data:

- **View settings**: Open extension options page
- **Delete all data**: Remove the extension from Chrome, or clear extension data in Chrome settings
- **Revoke access**: Delete your Personal Access Tokens from GitHub/Azure DevOps settings

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository:
https://github.com/uaoa

## Open Source

This extension is open source. You can review the complete source code to verify our privacy practices.
