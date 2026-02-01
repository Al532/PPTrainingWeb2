const DEFAULT_PROGRESS_INTERVAL = 250;

export function openDb(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB."));
    };

    request.onupgradeneeded = () => {
      const message = "IndexedDB schema mismatch. No upgrade performed.";
      reject(new Error(message));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export function readAllFromStore(db, storeName, onProgress) {
  return new Promise((resolve, reject) => {
    const records = [];
    let count = 0;

    let transaction;
    let request;

    try {
      transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      request = store.openCursor();
    } catch (error) {
      reject(error);
      return;
    }

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Failed to read from IndexedDB."));
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to read from IndexedDB."));
    };

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        records.push(cursor.value);
        count += 1;
        if (onProgress && count % DEFAULT_PROGRESS_INTERVAL === 0) {
          onProgress(count);
        }
        cursor.continue();
      } else {
        if (onProgress) {
          onProgress(count);
        }
        resolve(records);
      }
    };
  });
}

export function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function padTimestamp(value) {
  return String(value).padStart(2, "0");
}

function buildTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = padTimestamp(date.getMonth() + 1);
  const day = padTimestamp(date.getDate());
  const hours = padTimestamp(date.getHours());
  const minutes = padTimestamp(date.getMinutes());
  const seconds = padTimestamp(date.getSeconds());

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export async function exportLogs({ dbName, storeName, onProgress } = {}) {
  const safeDbName = dbName ?? "ppt-training";
  const safeStoreName = storeName ?? "trial-log";
  const db = await openDb(safeDbName);

  try {
    const records = await readAllFromStore(db, safeStoreName, onProgress);
    const filename = `${safeStoreName}_${buildTimestamp()}.json`;
    downloadJson(filename, records);
    return records.length;
  } finally {
    db.close();
  }
}
