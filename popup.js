// Popup script - manages widget settings

const toggleVisible = document.getElementById("toggleVisible");
const toggleN12 = document.getElementById("toggleN12");
const toggleYnet = document.getElementById("toggleYnet");
const statusText = document.getElementById("statusText");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");

// Load current settings
chrome.storage.local.get(["widgetVisible", "sources", "scrollSpeed"], (data) => {
  toggleVisible.checked = data.widgetVisible !== false;
  if (typeof data.scrollSpeed === "number") {
    speedSlider.value = data.scrollSpeed;
  }
  speedValue.textContent = speedSlider.value;
  const sources = data.sources || { n12: true, ynet: true };
  toggleN12.checked = sources.n12 !== false;
  toggleYnet.checked = sources.ynet !== false;

  // If already enabled, inject into the active tab (covers new tabs)
  if (toggleVisible.checked) {
    chrome.runtime.sendMessage({ type: "INJECT_ACTIVE_TAB" });
  }
});

// Load news count
chrome.runtime.sendMessage({ type: "GET_NEWS" }, (resp) => {
  if (resp && resp.items) {
    statusText.textContent = `מחובר | ${resp.items.length} עדכונים`;
  }
});

// Event listeners
toggleVisible.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    settings: { widgetVisible: toggleVisible.checked }
  });
});

speedSlider.addEventListener("input", () => {
  speedValue.textContent = speedSlider.value;
  chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    settings: { scrollSpeed: Number(speedSlider.value) }
  });
});

toggleN12.addEventListener("change", updateSources);
toggleYnet.addEventListener("change", updateSources);

function updateSources() {
  chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    settings: {
      sources: {
        n12: toggleN12.checked,
        ynet: toggleYnet.checked
      }
    }
  });
}
