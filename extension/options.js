const baseUrl = document.getElementById("baseUrl");
const apiKey = document.getElementById("apiKey");
const status = document.getElementById("status");

chrome.storage.sync.get(["baseUrl", "apiKey"]).then((saved) => {
  baseUrl.value = saved.baseUrl || "";
  apiKey.value = saved.apiKey || "";
});

document.getElementById("save").onclick = async () => {
  const address = baseUrl.value.trim();
  // A hosted app needs permission for its own address, which the browser asks the user for.
  if (address && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(address)) {
    const granted = await chrome.permissions.request({ origins: [`${new URL(address).origin}/*`] });
    if (!granted) {
      status.textContent = "Permission for that address was refused.";
      return;
    }
  }
  await chrome.storage.sync.set({ baseUrl: address, apiKey: apiKey.value });
  status.textContent = "Saved.";
};
