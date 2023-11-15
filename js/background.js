const App = {
  tabs: Object.create(null),
  options: Object.create(null),

  recentlyClosedTabUrl: undefined,

  initialize(tabs) {
    tabs.forEach(this.addTab.bind(this));
  },

  initializeOptions(data) {
    try {
      this.options = JSON.parse(data.options);
    } catch (e) {
      this.options = {};
    }
  },

  updateOrCloseTab(tabId, changeInfo, tab) {
    if (
      !tab.url ||
      this.tabs[tabId].kicked ||
      tab.url.indexOf('chrome://') === 0 ||
      this.tabs[tabId].preventFromClosing
    ) {
      return;
    }

    // pendingUrl available only from Chrome v79
    const pendingUrl =
      this.tabs[tabId] &&
      this.tabs[tabId].tab &&
      this.tabs[tabId].tab.pendingUrl;
    const existedTabs = this.getTabsByUrlInSameWindow(
      pendingUrl || tab.url,
      tab.windowId,
    );

    const anotherTabs = existedTabs.filter(
      (existedTab) => existedTab.id !== tab.id,
    );

    if (anotherTabs.length) {
      this.tabs[tabId].kicked = true;
      chrome.tabs.executeScript(tabId, {
        code: 'window.stop()',
        runAt: 'document_start',
      });
      this.recentlyClosedTabUrl = tab.url;
      this.highlightTab(anotherTabs[0].id, {
        kickedUrl: tab.url,
        kickedTabIndex: tab.index,
      });
      this.closeTab(tabId);
    }

    this.tabs[tabId].tab = tab;
  },

  listenReplaceTab(newTabId, oldTabId) {
    this.tabs[newTabId] = this.tabs[oldTabId];
    this.removeTabWatching(oldTabId);

    chrome.tabs.get(newTabId, (tab) => {
      this.tabs[newTabId].tab = tab;
      this.updateOrCloseTab(newTabId, {}, tab);
    });
  },

  listenBeforeRequest(details) {
    if (
      details.tabId &&
      details.tabId > 0 &&
      this.tabs[details.tabId] &&
      this.tabs[details.tabId].kicked
    ) {
      return {
        cancel: true,
      };
    }

    return {};
  },

  addTab(tab) {
    this.tabs[tab.id] = {
      tab,
      preventFromClosing: this.urlMatch(tab.url, this.recentlyClosedTabUrl),
    };
  },

  removeTabWatching(tabId) {
    delete this.tabs[tabId];
  },

  highlightTab(tabId, options) {
    const { kickedUrl, kickedTabIndex } = options;
    const { replace_hash_for_old_tab, move_tab } = this.options;

    chrome.tabs.update(tabId, {
      highlighted: true,
    });

    if (move_tab) {
      chrome.tabs.move(tabId, {
        index: kickedTabIndex,
      });
    }

    if (replace_hash_for_old_tab && kickedUrl) {
      const url = new URL(kickedUrl);
      if (url.hash) {
        chrome.tabs.executeScript(tabId, {
          code: `location.hash = "${url.hash}";`,
        });
      }
    }
    chrome.tabs.reload(tabId);
  },

  closeTab(tabId) {
    chrome.tabs.remove(tabId, () => {
      this.removeTabWatching(tabId);
    });
  },

  urlMatch(url1, url2) {
    const { ignore_hash } = this.options;

    if (ignore_hash) {
      url1 = url1 && url1.split('#')[0];
      url2 = url2 && url2.split('#')[0];
    }

    return url1 === url2;
  },

  getTabsByUrlInSameWindow(url, windowId) {
    const result = [];
    for (const tabId in this.tabs) {
      const tab = this.tabs[tabId];

      if (
        this.urlMatch(tab.tab.url, url) &&
        !tab.kicked &&
        tab.tab.windowId === windowId
      ) {
        result.push(this.tabs[tabId].tab);
      }
    }
    return result;
  },
};

chrome.tabs.query({}, App.initialize.bind(App));
chrome.storage.sync.get('options', App.initializeOptions.bind(App));
chrome.storage.onChanged.addListener(() => {
  chrome.storage.sync.get('options', App.initializeOptions.bind(App));
});

chrome.tabs.onCreated.addListener(App.addTab.bind(App));
chrome.tabs.onUpdated.addListener(App.updateOrCloseTab.bind(App));
chrome.tabs.onRemoved.addListener(App.removeTabWatching.bind(App));
chrome.tabs.onReplaced.addListener(App.listenReplaceTab.bind(App));

chrome.webRequest.onBeforeRequest.addListener(
  App.listenBeforeRequest.bind(App),
  {
    urls: ['http://*/*', 'https://*/*'],
    types: [
      'sub_frame',
      'stylesheet',
      'script',
      'image',
      'object',
      'xmlhttprequest',
      'other',
    ],
  },
  ['blocking'],
);
