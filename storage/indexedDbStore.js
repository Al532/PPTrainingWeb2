const DB_NAME = "ppt-training";
const DB_VERSION = 2;
const SETTINGS_STORE = "settings";
const TRIAL_LOG_STORE = "trial-log";
const SERIES_STORE = "series";

let dbPromise = null;
let useMemoryFallback = false;
const memorySettings = new Map();
let memoryTrialLog = [];
const memorySeries = new Map();

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(TRIAL_LOG_STORE)) {
        const store = db.createObjectStore(TRIAL_LOG_STORE, { autoIncrement: true });
        store.createIndex("trialNumber", "trialNumber", { unique: false });
        store.createIndex("trialDate", "trialDate", { unique: false });
      }
      if (!db.objectStoreNames.contains(SERIES_STORE)) {
        const store = db.createObjectStore(SERIES_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withDb(operation) {
  if (useMemoryFallback) return null;
  try {
    const db = await openDb();
    if (!db) return null;
    return await operation(db);
  } catch (error) {
    useMemoryFallback = true;
    return null;
  }
}

export async function getSetting(key) {
  if (useMemoryFallback) {
    return memorySettings.get(key) ?? null;
  }

  const result = await withDb(async (db) => {
    const transaction = db.transaction(SETTINGS_STORE, "readonly");
    const store = transaction.objectStore(SETTINGS_STORE);
    const value = await requestToPromise(store.get(key));
    await transactionToPromise(transaction);
    return value?.value ?? null;
  });

  if (result === null || result === undefined) {
    return memorySettings.get(key) ?? null;
  }
  return result;
}

export async function setSetting(key, value) {
  memorySettings.set(key, value);
  if (useMemoryFallback) return;

  await withDb(async (db) => {
    const transaction = db.transaction(SETTINGS_STORE, "readwrite");
    const store = transaction.objectStore(SETTINGS_STORE);
    store.put({ key, value });
    await transactionToPromise(transaction);
  });
}

export async function getTrialLog() {
  if (useMemoryFallback) return [...memoryTrialLog];

  const result = await withDb(async (db) => {
    const transaction = db.transaction(TRIAL_LOG_STORE, "readonly");
    const store = transaction.objectStore(TRIAL_LOG_STORE);
    const entries = await requestToPromise(store.getAll());
    await transactionToPromise(transaction);
    return entries ?? [];
  });

  if (Array.isArray(result)) {
    memoryTrialLog = [...result];
    return result;
  }

  return [...memoryTrialLog];
}

export async function appendTrialLog(entry) {
  memoryTrialLog.push(entry);
  if (useMemoryFallback) return;

  await withDb(async (db) => {
    const transaction = db.transaction(TRIAL_LOG_STORE, "readwrite");
    const store = transaction.objectStore(TRIAL_LOG_STORE);
    store.add(entry);
    await transactionToPromise(transaction);
  });
}

export async function replaceTrialLog(entries = []) {
  memoryTrialLog = Array.isArray(entries) ? [...entries] : [];
  if (useMemoryFallback) return;

  await withDb(async (db) => {
    const transaction = db.transaction(TRIAL_LOG_STORE, "readwrite");
    const store = transaction.objectStore(TRIAL_LOG_STORE);
    store.clear();
    memoryTrialLog.forEach((entry) => {
      store.add(entry);
    });
    await transactionToPromise(transaction);
  });
}

export async function getSeriesList() {
  if (useMemoryFallback) return Array.from(memorySeries.values());

  const result = await withDb(async (db) => {
    const transaction = db.transaction(SERIES_STORE, "readonly");
    const store = transaction.objectStore(SERIES_STORE);
    const entries = await requestToPromise(store.getAll());
    await transactionToPromise(transaction);
    return entries ?? [];
  });

  if (Array.isArray(result)) {
    memorySeries.clear();
    result.forEach((entry) => {
      if (entry?.id) {
        memorySeries.set(entry.id, entry);
      }
    });
    return result;
  }

  return Array.from(memorySeries.values());
}

export async function getSeriesById(id) {
  if (!id) return null;
  if (useMemoryFallback) {
    return memorySeries.get(id) ?? null;
  }

  const result = await withDb(async (db) => {
    const transaction = db.transaction(SERIES_STORE, "readonly");
    const store = transaction.objectStore(SERIES_STORE);
    const entry = await requestToPromise(store.get(id));
    await transactionToPromise(transaction);
    return entry ?? null;
  });

  if (result && result.id) {
    memorySeries.set(result.id, result);
    return result;
  }

  return memorySeries.get(id) ?? null;
}

export async function saveSeries(series) {
  if (!series?.id) return null;
  memorySeries.set(series.id, series);
  if (useMemoryFallback) return series;

  await withDb(async (db) => {
    const transaction = db.transaction(SERIES_STORE, "readwrite");
    const store = transaction.objectStore(SERIES_STORE);
    store.put(series);
    await transactionToPromise(transaction);
  });
  return series;
}

export async function deleteSeries(id) {
  if (!id) return;
  memorySeries.delete(id);
  if (useMemoryFallback) return;

  await withDb(async (db) => {
    const transaction = db.transaction(SERIES_STORE, "readwrite");
    const store = transaction.objectStore(SERIES_STORE);
    store.delete(id);
    await transactionToPromise(transaction);
  });
}
