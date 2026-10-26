// Tiny in-process cache helpers (no model imports here, so models can use it
// without import cycles).
//
// Every write to Employee / Role / Group / Section bumps the version, which
// instantly invalidates the auth + visibility caches below. The short TTLs
// are only a safety net for writes made outside this process (scripts).

let version = 0;

export function cacheVersion() {
  return version;
}

export function bumpCacheVersion() {
  version += 1;
}

const WRITE_HOOKS = [
  "save",
  "insertMany",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
];

// call on a schema BEFORE mongoose.model(...)
export function invalidateCachesOnWrite(schema) {
  for (const hook of WRITE_HOOKS) {
    schema.post(hook, () => bumpCacheVersion());
  }
}

// small TTL cache with in-flight de-duplication
export function createCache(ttlMs, maxEntries = 2000) {
  const store = new Map();
  return async function cached(key, load) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.ver === version && now - hit.at < ttlMs) return hit.value;
    const ver = version;
    // wrap in a real Promise: a Mongoose Query is only a thenable and can be
    // executed ONCE — awaiting the same Query from a 2nd request throws
    const value = Promise.resolve().then(load);
    if (store.size >= maxEntries) store.clear();
    store.set(key, { at: now, ver, value });
    try {
      return await value;
    } catch (err) {
      store.delete(key); // never cache a failure
      throw err;
    }
  };
}
