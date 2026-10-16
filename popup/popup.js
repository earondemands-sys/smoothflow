// SmoothFlow Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  const btnToggleHud = document.getElementById('btn-toggle-hud');
  const toggleCursor = document.getElementById('toggle-cursor');
  const toggleWheelScroll = document.getElementById('toggle-wheel-scroll');
  const toggleSpotlight = document.getElementById('toggle-spotlight');
  const btnQuickScroll = document.getElementById('btn-quick-scroll');
  const btnQuickRecord = document.getElementById('btn-quick-record');
  const statusBadge = document.getElementById('sf-status');

  // Shortcut labels: ⌘⇧ on macOS, Ctrl+Shift elsewhere
  const isMac = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  document.querySelectorAll('[data-shortcut]').forEach(el => {
    const letter = el.getAttribute('data-shortcut');
    el.textContent = isMac ? `⌘⇧${letter}` : `Ctrl+Shift+${letter}`;
  });

  // Load state from chrome.storage
  chrome.storage.local.get(['cursorEnabled', 'wheelScrollEnabled', 'spotlightEnabled'], (res) => {
    if (res.cursorEnabled !== undefined) toggleCursor.checked = res.cursorEnabled;
    if (res.wheelScrollEnabled !== undefined) toggleWheelScroll.checked = res.wheelScrollEnabled;
    if (res.spotlightEnabled !== undefined) toggleSpotlight.checked = res.spotlightEnabled;
  });

  // Helper to send message to active tab
  async function sendToActiveTab(message) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return null;
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://'))) {
        statusBadge.textContent = 'Not Allowed';
        statusBadge.style.color = '#f87171';
        return null;
      }
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      console.warn('Could not communicate with tab:', err);
      return null;
    }
  }

  // Toggle HUD on page
  btnToggleHud.addEventListener('click', async () => {
    await sendToActiveTab({ action: 'TOGGLE_HUD' });
    window.close(); // Close popup so user interacts with on-page HUD
  });

  // Toggle Cursor
  toggleCursor.addEventListener('change', (e) => {
    const val = e.target.checked;
    chrome.storage.local.set({ cursorEnabled: val });
    sendToActiveTab({ action: 'SET_SETTING', key: 'cursorEnabled', value: val });
  });

  // Toggle Wheel Scroll
  toggleWheelScroll.addEventListener('change', (e) => {
    const val = e.target.checked;
    chrome.storage.local.set({ wheelScrollEnabled: val });
    sendToActiveTab({ action: 'SET_SETTING', key: 'wheelScrollEnabled', value: val });
  });

  // Toggle Spotlight
  toggleSpotlight.addEventListener('change', (e) => {
    const val = e.target.checked;
    chrome.storage.local.set({ spotlightEnabled: val });
    sendToActiveTab({ action: 'SET_SETTING', key: 'spotlightEnabled', value: val });
  });

  // Quick Play Scroll
  btnQuickScroll.addEventListener('click', async () => {
    await sendToActiveTab({ action: 'PLAY_SCROLL' });
    window.close();
  });

  // Quick Record & Scroll
  btnQuickRecord.addEventListener('click', async () => {
    await sendToActiveTab({ action: 'RECORD_AND_SCROLL' });
    window.close();
  });
});
