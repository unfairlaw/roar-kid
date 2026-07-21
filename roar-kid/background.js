// Click-to-disable: while a tab's audio is actually routed through the
// processing chain, that tab's toolbar icon gets its popup cleared, so a
// click lands on onClicked and switches the extension off. Everywhere
// else — other tabs, or once disabled — the click opens the popup as
// usual, which is where re-enabling lives. The content script reports
// routing transitions from applySettings, the one place routing changes.
// Both overrides are tab-scoped, so Chrome resets them on navigation and
// tab close without any bookkeeping here. Chrome cannot pin the icon to
// the toolbar programmatically (that is the user's choice in the
// extensions menu); this only governs what a click does.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "roar-active" || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  if (msg.active) {
    chrome.action.setPopup({ tabId, popup: "" });
    chrome.action.setTitle({ tabId, title: "Roar, kid! — on (click to turn off)" });
  } else {
    chrome.action.setPopup({ tabId, popup: "popup.html" });
    chrome.action.setTitle({ tabId, title: "Roar, kid! audiogram" });
  }
});

// Only reachable on a tab whose popup was cleared above, i.e. while
// active. `enabled` is a global setting: every wired tab bypasses, each
// reports inactive, and the listener above restores its popup.
chrome.action.onClicked.addListener(() => {
  chrome.storage.sync.set({ enabled: false });
});
