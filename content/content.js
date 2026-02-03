// Content script for rep.smartcloud.com.ua
// Reads the date from the input field

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getDate') {
    const dateInput = document.getElementById('bpfee');

    if (dateInput && dateInput.value) {
      // Date format: dd.MM.yyyy
      sendResponse({ date: dateInput.value });
    } else {
      // Try to find by other selectors as fallback
      const altInput = document.querySelector('input[title*="date"]');
      if (altInput && altInput.value) {
        sendResponse({ date: altInput.value });
      } else {
        sendResponse({ date: null });
      }
    }
  }
  return true;
});
