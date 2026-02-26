const DB_NAME = "backing-track-maker.sessions.db";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeSessionRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const id = String(record.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    name: String(record.name || "Untitled Session").trim() || "Untitled Session",
    createdAt: Number(record.createdAt) || Date.now(),
    updatedAt: Number(record.updatedAt) || Date.now(),
    snapshot: cloneJson(record.snapshot, {})
  };
}

function readLegacySessions(legacyStorageKey) {
  if (!legacyStorageKey) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(legacyStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return sessions
      .map((session) => normalizeSessionRecord(session))
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error || new Error("Failed to open session database."));
    };
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Database transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error || new Error("Database transaction aborted."));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Database request failed."));
  });
}

async function readAllRecordsFromStore(store) {
  if (typeof store.getAll === "function") {
    return requestToPromise(store.getAll());
  }

  return new Promise((resolve, reject) => {
    const results = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("Failed to read sessions."));
  });
}

export async function readSessionsFromDatabase({ legacyStorageKey } = {}) {
  let db = null;
  try {
    db = await openDatabase();
    const readTx = db.transaction(STORE_NAME, "readonly");
    const readStore = readTx.objectStore(STORE_NAME);
    const records = await readAllRecordsFromStore(readStore);
    await transactionComplete(readTx);

    const normalized = records
      .map((record) => normalizeSessionRecord(record))
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);

    if (normalized.length > 0) {
      return normalized;
    }

    const legacy = readLegacySessions(legacyStorageKey);
    if (!legacy.length) {
      return [];
    }

    const migrateTx = db.transaction(STORE_NAME, "readwrite");
    const migrateStore = migrateTx.objectStore(STORE_NAME);
    for (const session of legacy) {
      migrateStore.put(session);
    }
    await transactionComplete(migrateTx);
    return legacy;
  } catch {
    return readLegacySessions(legacyStorageKey);
  } finally {
    if (db) {
      db.close();
    }
  }
}

export async function writeSessionsToDatabase(sessions) {
  const normalized = Array.isArray(sessions)
    ? sessions.map((session) => normalizeSessionRecord(session)).filter(Boolean)
    : [];

  let db = null;
  try {
    db = await openDatabase();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const session of normalized) {
      store.put(session);
    }
    await transactionComplete(tx);
    return true;
  } catch {
    return false;
  } finally {
    if (db) {
      db.close();
    }
  }
}
