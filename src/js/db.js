// ===== DEEPAGENT DB — IndexedDB storage utility =====
// Replaces localStorage for session data to support projects of any size.
// IndexedDB has no practical per-origin quota limit (usually hundreds of MB to GB),
// unlike localStorage which is capped at ~5-10 MB.

(function (global) {
    const DB_NAME = 'DeepAgentDB';
    const DB_VERSION = 1;
    const SESSIONS_STORE = 'sessions';
    const CHANGES_STORE = 'changes';
    const META_STORE = 'meta';

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
                    database.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
                }
                if (!database.objectStoreNames.contains(CHANGES_STORE)) {
                    database.createObjectStore(CHANGES_STORE, { keyPath: 'sessionId' });
                }
                if (!database.objectStoreNames.contains(META_STORE)) {
                    database.createObjectStore(META_STORE, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => {
                dbPromise = null; // allow retry
                reject(new Error('Error abriendo IndexedDB: ' + event.target.error));
            };
        });

        return dbPromise;
    }

    // Persist a session (project content + metadata)
    async function saveSession(sessionId, content, metadata) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(SESSIONS_STORE, 'readwrite');
            const request = tx.objectStore(SESSIONS_STORE).put({
                sessionId,
                content,
                metadata,
                timestamp: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Load a session by ID; returns {sessionId, content, metadata} or null
    async function loadSession(sessionId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(SESSIONS_STORE, 'readonly');
            const request = tx.objectStore(SESSIONS_STORE).get(sessionId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    // Persist file changes for a session
    async function saveChanges(sessionId, changes) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(CHANGES_STORE, 'readwrite');
            const request = tx.objectStore(CHANGES_STORE).put({
                sessionId,
                changes,
                timestamp: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Load file changes for a session; returns array of changes or null
    async function loadChanges(sessionId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(CHANGES_STORE, 'readonly');
            const request = tx.objectStore(CHANGES_STORE).get(sessionId);
            request.onsuccess = () => resolve(request.result ? request.result.changes : null);
            request.onerror = () => reject(request.error);
        });
    }

    // Set a generic key-value metadata entry (e.g. 'currentSession')
    async function setMeta(key, value) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE, 'readwrite');
            const request = tx.objectStore(META_STORE).put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Get a generic key-value metadata entry; returns the value or null
    async function getMeta(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE, 'readonly');
            const request = tx.objectStore(META_STORE).get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    }

    // Delete all data for a session
    async function deleteSession(sessionId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([SESSIONS_STORE, CHANGES_STORE], 'readwrite');
            tx.objectStore(SESSIONS_STORE).delete(sessionId);
            tx.objectStore(CHANGES_STORE).delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    global.DeepAgentDB = {
        saveSession,
        loadSession,
        saveChanges,
        loadChanges,
        setMeta,
        getMeta,
        deleteSession
    };
})(window);
