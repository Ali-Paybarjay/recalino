/** Reserve the new tab during the click, before an asynchronous private-file lookup. */
export async function openOriginalTab(resolveUrl: () => Promise<string>) {
  const tab = window.open("about:blank", "_blank");
  try {
    if (tab) {
      tab.opener = null;
      const referrer = tab.document.createElement("meta");
      referrer.name = "referrer";
      referrer.content = "no-referrer";
      tab.document.head.append(referrer);
      tab.document.title = "Opening original";
      tab.document.body.textContent = "Opening original…";
    }
    const url = await resolveUrl();
    if (tab && !tab.closed) {
      tab.location.replace(url);
      return { url, opened: true };
    }
    return { url, opened: false };
  } catch (error) {
    tab?.close();
    throw error;
  }
}
