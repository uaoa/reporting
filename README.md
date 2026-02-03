# Reporting Commits Tracker

A Chrome extension to track commits from GitHub and Azure DevOps for daily reporting.

## Features

### Commits Tracking
- Fetch commits from GitHub organizations
- Fetch commits from Azure DevOps projects
- Filter by source (GitHub only, DevOps only, or both)
- Click to copy commit messages
- Automatic date detection from rep.smartcloud.com.ua

### DevOps Tasks
- View work items assigned to you
- Filter tasks by project
- See task type (Bug, Task, User Story, Feature, Epic)
- Click to copy task ID
- Quick link to open in Azure DevOps

### Ticket Mappings
- Create mappings between keywords and ticket numbers
- Automatic ticket detection in commit messages
- Auto-suggest tickets from DevOps tasks

### Smart Integration
- Automatic date detection when selecting a day on rep.smartcloud.com.ua
- Icon turns green when commits are found for the selected date
- Caching for faster repeated access
- Remembers last active tab and filters

## Installation

### From Chrome Web Store
*(Coming soon)*

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Configuration

### GitHub Setup
1. Create a Personal Access Token at [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
2. Select the `repo` scope (Full control of private repositories)
3. Enter the token, your username, and organization name in extension settings

### Azure DevOps Setup
1. Create a Personal Access Token at [dev.azure.com/_usersSettings/tokens](https://dev.azure.com/_usersSettings/tokens)
2. Select your organization or "All accessible organizations"
3. Under Scopes, select "Custom defined" and check:
   - Work Items: Read
   - Code: Read
4. Enter the token and organization name in extension settings

## Usage

1. Configure your GitHub and/or Azure DevOps credentials in Settings
2. Select which source to use for commits
3. Go to rep.smartcloud.com.ua and click on a reporting day
4. Click the extension icon to see your commits
5. Click on a commit message to copy it
6. Use the Mappings tab to link tickets to keywords in commit messages

## Privacy

This extension:
- Only stores data locally in your browser
- Only connects to GitHub API, Azure DevOps API, and rep.smartcloud.com.ua
- Does not collect any analytics or personal data
- Does not share data with third parties

See [PRIVACY.md](PRIVACY.md) for full privacy policy.

## Permissions

The extension requires minimal permissions:
- **storage**: Save your settings and cached data locally
- **contextMenus**: Add "About" option to extension icon menu
- **Host permissions**: Connect to GitHub API, Azure DevOps API, and rep.smartcloud.com.ua

## Author

**Zakharii Melnyk**
- GitHub: [@uaoa](https://github.com/uaoa)

## License

MIT License - Copyright (c) 2026 Zakharii Melnyk

See [LICENSE](LICENSE) for details.
