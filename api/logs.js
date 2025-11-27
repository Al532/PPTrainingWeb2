const LOG_API_ENDPOINT = "/api/logs";

function buildHeaders(userToken) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-User-Token": userToken,
  };
}

async function fetchEntries(userToken) {
  const response = await fetch(`${LOG_API_ENDPOINT}?user=${encodeURIComponent(userToken)}`, {
    method: "GET",
    headers: buildHeaders(userToken),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.entries)) return payload.entries;
  throw new Error("Unexpected log payload");
}

async function appendEntries(userToken, entries) {
  const response = await fetch(LOG_API_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(userToken),
    body: JSON.stringify({ entries }),
  });

  if (!response.ok) {
    throw new Error(`Failed to persist logs: ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

window.logApi = {
  fetchEntries,
  appendEntries,
  LOG_API_ENDPOINT,
};
