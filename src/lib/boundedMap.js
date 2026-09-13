export class BoundedMap {
  #map = new Map()
  #maxSize
  #maxAge
  #cleanupInterval

  constructor({ maxSize = 10000, maxAge = null, cleanupIntervalMs = 60000 } = {}) {
    this.#maxSize = maxSize
    this.#maxAge = maxAge
    if (maxAge) {
      this.#cleanupInterval = setInterval(() => this.#evictExpired(), cleanupIntervalMs)
      if (this.#cleanupInterval.unref) this.#cleanupInterval.unref()
    }
  }

  get(key) {
    const entry = this.#map.get(key)
    if (!entry) return undefined
    if (this.#maxAge && Date.now() - entry.ts > this.#maxAge) {
      this.#map.delete(key)
      return undefined
    }
    return entry.v
  }

  set(key, value) {
    if (this.#map.size >= this.#maxSize && !this.#map.has(key)) {
      this.#evictOldest()
    }
    this.#map.set(key, { v: value, ts: Date.now() })
    return this
  }

  has(key) {
    const entry = this.#map.get(key)
    if (!entry) return false
    if (this.#maxAge && Date.now() - entry.ts > this.#maxAge) {
      this.#map.delete(key)
      return false
    }
    return true
  }

  delete(key) {
    return this.#map.delete(key)
  }

  get size() {
    return this.#map.size
  }

  clear() {
    this.#map.clear()
  }

  entries() {
    const inner = this.#map
    return {
      *[Symbol.iterator]() {
        for (const [key, entry] of inner) {
          yield [key, entry.v]
        }
      }
    }
  }

  keys() {
    return this.#map.keys()
  }

  values() {
    const inner = this.#map
    return {
      *[Symbol.iterator]() {
        for (const entry of inner.values()) {
          yield entry.v
        }
      }
    }
  }

  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]()
  }

  forEach(callback) {
    this.#map.forEach((entry, key) => callback(entry.v, key, this))
  }

  #evictOldest() {
    let oldestKey = null
    let oldestTs = Infinity
    for (const [key, entry] of this.#map) {
      if (entry.ts < oldestTs) {
        oldestTs = entry.ts
        oldestKey = key
      }
    }
    if (oldestKey !== null) this.#map.delete(oldestKey)
  }

  #evictExpired() {
    const now = Date.now()
    for (const [key, entry] of this.#map) {
      if (now - entry.ts > this.#maxAge) this.#map.delete(key)
    }
  }

  destroy() {
    if (this.#cleanupInterval) clearInterval(this.#cleanupInterval)
    this.#map.clear()
  }
}
