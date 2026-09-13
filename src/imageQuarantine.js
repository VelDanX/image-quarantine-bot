import sharp from 'sharp';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ContainerBuilder,
    FileUploadBuilder,
    MentionableSelectMenuBuilder,
    RoleSelectMenuBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    ThumbnailBuilder,
    UserSelectMenuBuilder,
} from 'discord.js';
import { BoundedMap } from './lib/boundedMap.js';

const SIMILARITY_THRESHOLD = 0.80;
const FETCH_TIMEOUT_MS = 30000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const DYNAMIC_COLLECTION = 'quarantine_references';
const DOWNLOAD_CONCURRENCY = 5;

const DHASH_COLS = 33;
const DHASH_ROWS = 32;
const OLD_DHASH_BITS = 16 * 16;

const guildReferences = new Map();
const guildRefsLoading = new Map();
const guildBKTrees = new Map();
const matchResultCache = new BoundedMap({ maxSize: 2000, maxAge: 5 * 60 * 1000 });

export async function fetchImageBuffer(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return null;
        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_IMAGE_SIZE_BYTES) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_SIZE_BYTES) return null;
        return buffer;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function concurrentMap(items, fn, limit = DOWNLOAD_CONCURRENCY) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i], i);
        }
    }
    const workers = Array(Math.min(limit, items.length)).fill().map(() => worker());
    await Promise.all(workers);
    return results;
}

export async function computeHash(imageBuffer) {
    const { data } = await sharp(imageBuffer)
        .resize(DHASH_COLS, DHASH_ROWS, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const bits = [];
    for (let y = 0; y < DHASH_ROWS; y++) {
        const off = y * DHASH_COLS;
        for (let x = 0; x < DHASH_COLS - 1; x++) {
            bits.push(data[off + x] > data[off + x + 1] ? '1' : '0');
        }
    }
    return bits.join('');
}

const PHASH_DCT_SIZE = 32;
const PHASH_BLOCK = 8;
let _dctCosTable = null;

function getDctCosTable() {
    if (_dctCosTable) return _dctCosTable;
    const N = PHASH_DCT_SIZE;
    const table = new Float64Array(N * N);
    for (let k = 0; k < N; k++) {
        const row = k * N;
        for (let n = 0; n < N; n++) {
            table[row + n] = Math.cos((Math.PI / N) * (n + 0.5) * k);
        }
    }
    _dctCosTable = table;
    return table;
}

function dct1D(input, N, table) {
    const output = new Float64Array(N);
    for (let k = 0; k < N; k++) {
        let sum = 0;
        const row = k * N;
        for (let n = 0; n < N; n++) sum += input[n] * table[row + n];
        output[k] = sum;
    }
    return output;
}

function dct2D(pixels) {
    const N = PHASH_DCT_SIZE;
    const table = getDctCosTable();
    const rows = new Float64Array(N * N);
    const tmp = new Float64Array(N);
    for (let y = 0; y < N; y++) {
        const off = y * N;
        for (let x = 0; x < N; x++) tmp[x] = pixels[off + x];
        const d = dct1D(tmp, N, table);
        for (let x = 0; x < N; x++) rows[off + x] = d[x];
    }
    const out = new Float64Array(N * N);
    for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) tmp[y] = rows[y * N + x];
        const d = dct1D(tmp, N, table);
        for (let y = 0; y < N; y++) out[y * N + x] = d[y];
    }
    return out;
}

export async function computePHash(imageBuffer) {
    const { data, info } = await sharp(imageBuffer)
        .resize(PHASH_DCT_SIZE, PHASH_DCT_SIZE, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pixels = new Float64Array(PHASH_DCT_SIZE * PHASH_DCT_SIZE);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = data[i * info.channels] || 0;
    }

    const dct = dct2D(pixels);

    const block = new Float64Array(PHASH_BLOCK * PHASH_BLOCK);
    for (let y = 0; y < PHASH_BLOCK; y++) {
        for (let x = 0; x < PHASH_BLOCK; x++) {
            block[y * PHASH_BLOCK + x] = dct[y * PHASH_DCT_SIZE + x];
        }
    }

    const coeffs = [];
    for (let i = 1; i < block.length; i++) coeffs.push(block[i]);
    coeffs.sort((a, b) => a - b);
    const median = coeffs[Math.floor(coeffs.length / 2)];

    const bits = [];
    for (let i = 1; i < block.length; i++) {
        bits.push(block[i] > median ? '1' : '0');
    }
    return bits.join('');
}

export async function computeFormatsHashes(imageBuffer) {
    const formats = {};
    const tasks = [];

    const addFormat = async (format, convertFn) => {
        try {
            const buf = await convertFn(sharp(imageBuffer)).toBuffer();
            formats[format] = await computeHash(buf);
        } catch (e) {
            console.error(`[ImageQuarantine] convert to ${format} failed:`, e.message);
        }
    };

    tasks.push(addFormat('png', s => s.png()));
    tasks.push(addFormat('jpg', s => s.jpeg({ quality: 100 })));
    tasks.push(addFormat('webp', s => s.webp({ quality: 100 })));
    tasks.push(addFormat('gif', s => s.gif()));

    await Promise.all(tasks);
    return formats;
}

function hashToBytes(hash) {
    const len = Math.ceil(hash.length / 8);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < hash.length; i++) {
        if (hash[i] === '1') bytes[i >> 3] |= 1 << (7 - (i & 7));
    }
    return bytes;
}

function hammingDistanceBytes(a, b) {
    if (a.length !== b.length) return Infinity;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        let x = a[i] ^ b[i];
        while (x) {
            dist += x & 1;
            x >>= 1;
        }
    }
    return dist;
}

class BKTreeNode {
    constructor(hashBytes, fileName) {
        this.hash = hashBytes;
        this.fileName = fileName;
        this.children = new Map();
    }
}

class BKTree {
    constructor() {
        this.root = null;
    }

    insert(hashBytes, fileName) {
        if (!this.root) {
            this.root = new BKTreeNode(hashBytes, fileName);
            return;
        }
        let node = this.root;
        while (true) {
            const dist = hammingDistanceBytes(hashBytes, node.hash);
            if (dist === 0) {
                node.fileName = fileName;
                return;
            }
            const child = node.children.get(dist);
            if (!child) {
                node.children.set(dist, new BKTreeNode(hashBytes, fileName));
                return;
            }
            node = child;
        }
    }

    search(queryBytes, maxDistance) {
        const results = [];
        if (!this.root) return results;
        const stack = [this.root];
        while (stack.length > 0) {
            const node = stack.pop();
            const dist = hammingDistanceBytes(queryBytes, node.hash);
            if (dist <= maxDistance) {
                results.push({ fileName: node.fileName, distance: dist });
            }
            const lo = dist - maxDistance;
            const hi = dist + maxDistance;
            for (const [edgeDist, child] of node.children) {
                if (edgeDist >= lo && edgeDist <= hi) {
                    stack.push(child);
                }
            }
        }
        return results;
    }
}

function buildBKTrees(guildId, refs) {
    const dHashTree = new BKTree();
    const pHashTree = new BKTree();
    const seenDHash = new Set();
    const seenPHash = new Set();

    for (const ref of refs) {
        if (ref.hash) {
            const bytes = hashToBytes(ref.hash);
            const key = ref.hash;
            if (!seenDHash.has(key)) {
                dHashTree.insert(bytes, ref.file);
                seenDHash.add(key);
            }
        }
        if (ref.formats) {
            for (const fmtHash of Object.values(ref.formats)) {
                if (fmtHash && !seenDHash.has(fmtHash)) {
                    dHashTree.insert(hashToBytes(fmtHash), ref.file);
                    seenDHash.add(fmtHash);
                }
            }
        }
        if (ref.pHash) {
            if (!seenPHash.has(ref.pHash)) {
                pHashTree.insert(hashToBytes(ref.pHash), ref.file);
                seenPHash.add(ref.pHash);
            }
        }
    }

    guildBKTrees.set(guildId, { dHashTree, pHashTree });
}

function collectMatchesByFile(tree, hash, threshold) {
    const bitLen = hash.length;
    const maxDist = Math.floor((1 - threshold) * bitLen);
    const bytes = hashToBytes(hash);
    const results = tree.search(bytes, maxDist);
    const map = new Map();
    for (const r of results) {
        const sim = 1 - r.distance / bitLen;
        if (sim < threshold) continue;
        const cur = map.get(r.fileName);
        if (cur === undefined || sim > cur) map.set(r.fileName, sim);
    }
    return map;
}

function searchBKTrees(guildId, queries, threshold) {
    const trees = guildBKTrees.get(guildId);
    if (!trees) return null;

    const dHashQuery = queries.find(q => q.type === 'dhash');
    const pHashQuery = queries.find(q => q.type === 'phash');
    if (!dHashQuery) return null;

    const dHashMatches = collectMatchesByFile(trees.dHashTree, dHashQuery.hash, threshold);
    if (dHashMatches.size === 0) return null;

    if (!pHashQuery) {
        let best = null;
        for (const [file, sim] of dHashMatches) {
            if (!best || sim > best.similarity) best = { matchedFile: file, similarity: sim };
        }
        return best;
    }

    const pHashMatches = collectMatchesByFile(trees.pHashTree, pHashQuery.hash, threshold);
    if (pHashMatches.size === 0) return null;

    let best = null;
    for (const [file, dSim] of dHashMatches) {
        const pSim = pHashMatches.get(file);
        if (pSim === undefined) continue;
        const sim = Math.min(dSim, pSim);
        if (!best || sim > best.similarity) {
            best = { matchedFile: file, similarity: sim };
        }
    }
    return best;
}

export async function initImageQuarantine() {
    try {
        const { getDb } = await import('./mongo.js');
        const db = getDb();
        if (db) {
            await db.collection(DYNAMIC_COLLECTION).createIndex({ guildId: 1, hash: 1 }, { unique: true });
        }
    } catch (err) {
        console.error('[ImageQuarantine] createIndex error:', err.message);
    }
    await loadAllDynamicReferences();
}

async function migrateLegacyHashes(docs, scope) {
    const legacy = docs.filter(d => d.hash && d.hash.length === OLD_DHASH_BITS);
    if (legacy.length === 0) return;
    const { getDb } = await import('./mongo.js');
    const db = getDb();
    if (!db) return;
    let migrated = 0, skipped = 0;
    for (const doc of legacy) {
        if (!doc.imageData) { skipped++; continue; }
        try {
            const buf = Buffer.from(doc.imageData.buffer ?? doc.imageData);
            const [newHash, newFormats] = await Promise.all([
                computeHash(buf),
                computeFormatsHashes(buf),
            ]);
            await db.collection(DYNAMIC_COLLECTION).updateOne(
                { _id: doc._id },
                { $set: { hash: newHash, formats: newFormats } }
            );
            doc.hash = newHash;
            doc.formats = newFormats;
            migrated++;
        } catch (e) {
            console.error(`[ImageQuarantine] migrate failed for ${doc.fileName}:`, e.message);
            skipped++;
        }
    }
    console.log(`[ImageQuarantine] Migration ${scope}: ${migrated} rehashed, ${skipped} skipped (no imageData)`);
}

async function loadAllDynamicReferences() {
    try {
        const { getDb } = await import('./mongo.js');
        const db = getDb();
        if (!db) return;

        const docs = await db.collection(DYNAMIC_COLLECTION).find({}).toArray();
        await migrateLegacyHashes(docs, 'global');
        const grouped = {};
        for (const doc of docs) {
            const gId = doc.guildId;
            if (!gId) continue;
            if (!grouped[gId]) grouped[gId] = [];
            if (doc.hash && !grouped[gId].some(r => r.file === doc.fileName)) {
                grouped[gId].push({ file: doc.fileName, hash: doc.hash, formats: doc.formats || null, pHash: doc.pHash || null });
            }
        }
        for (const [gId, refs] of Object.entries(grouped)) {
            guildReferences.set(gId, refs);
            buildBKTrees(gId, refs);
        }

        const totalRefs = docs.length;
        if (totalRefs > 0) {
            console.log(`[ImageQuarantine] Загружено ${totalRefs} референсов из БД (${guildReferences.size} серверов)`);
        } else {
            console.log('[ImageQuarantine] Нет референсных изображений');
        }
    } catch (err) {
        console.error('[ImageQuarantine] Ошибка загрузки референсов из БД:', err.message);
    }
}

async function ensureGuildRefs(guildId) {
    if (guildReferences.has(guildId)) return;
    if (guildRefsLoading.has(guildId)) {
        await guildRefsLoading.get(guildId);
        return;
    }
    const promise = (async () => {
        try {
            const { getDb } = await import('./mongo.js');
            const db = getDb();
            if (!db) { guildReferences.set(guildId, []); return; }
            const docs = await db.collection(DYNAMIC_COLLECTION).find({ guildId }).toArray();
            await migrateLegacyHashes(docs, `guild ${guildId}`);
            const refs = [];
            for (const doc of docs) {
                if (doc.hash && !refs.some(r => r.file === doc.fileName)) {
                    refs.push({ file: doc.fileName, hash: doc.hash, formats: doc.formats || null, pHash: doc.pHash || null });
                }
            }
            guildReferences.set(guildId, refs);
            buildBKTrees(guildId, refs);
        } catch (err) {
            console.error(`[ImageQuarantine] Ошибка загрузки референсов для ${guildId}:`, err.message);
            guildReferences.set(guildId, []);
        }
    })();
    guildRefsLoading.set(guildId, promise);
    await promise;
    guildRefsLoading.delete(guildId);
}

export async function checkImageMatch(imageUrl, guildId, threshold = SIMILARITY_THRESHOLD) {
    await ensureGuildRefs(guildId);
    const refs = guildReferences.get(guildId) || [];
    if (refs.length === 0) return null;

    const cacheKey = `${guildId}:${threshold}:${imageUrl}`;
    const cached = matchResultCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
        const buffer = await fetchImageBuffer(imageUrl);
        if (!buffer) { matchResultCache.set(cacheKey, null); return null; }

        const [hash, pHash] = await Promise.all([
            computeHash(buffer),
            computePHash(buffer).catch(() => null),
        ]);

        const queries = [{ hash, type: 'dhash' }];
        if (pHash) queries.push({ hash: pHash, type: 'phash' });

        const best = searchBKTrees(guildId, queries, threshold);
        matchResultCache.set(cacheKey, best);
        return best;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[ImageQuarantine] Таймаут загрузки изображения');
        } else {
            console.error('[ImageQuarantine] Ошибка проверки:', error.message);
        }
        return null;
    }
}

export async function addDynamicReference(imageBuffer, fileName, addedBy, imageUrl, guildId) {
    const [hash, formats, pHash] = await Promise.all([
        computeHash(imageBuffer),
        computeFormatsHashes(imageBuffer),
        computePHash(imageBuffer).catch(() => null),
    ]);

    const { getDb } = await import('./mongo.js');
    const db = getDb();

    const existing = await db.collection(DYNAMIC_COLLECTION).findOne({ guildId, hash });
    if (existing) {
        const err = new Error('Duplicate hash');
        err.code = 11000;
        throw err;
    }

    try {
        await db.collection(DYNAMIC_COLLECTION).insertOne({
            guildId, fileName, hash, formats, pHash,
            imageUrl: imageUrl || null,
            addedAt: new Date(),
            addedBy,
            imageData: imageBuffer
        });
    } catch (err) {
        if (err.code === 11000) throw err;
        throw err;
    }

    if (!guildReferences.has(guildId)) {
        guildReferences.set(guildId, []);
    }
    const refs = guildReferences.get(guildId);
    const idx = refs.findIndex(r => r.file === fileName);
    if (idx >= 0) {
        refs[idx].hash = hash;
        refs[idx].formats = formats;
        refs[idx].pHash = pHash;
    } else {
        refs.push({ file: fileName, hash, formats, pHash });
    }
    buildBKTrees(guildId, refs);
    return { fileName, hash, pHash, imageUrl };
}

export async function removeDynamicReference(fileName, guildId) {
    const { getDb } = await import('./mongo.js');
    const db = getDb();
    await db.collection(DYNAMIC_COLLECTION).deleteOne({ fileName, guildId });
    const refs = guildReferences.get(guildId) || [];
    const idx = refs.findIndex(r => r.file === fileName);
    if (idx >= 0) refs.splice(idx, 1);
    buildBKTrees(guildId, refs);
}

export async function getAllDynamicReferences(guildId) {
    const { getDb } = await import('./mongo.js');
    const db = getDb();
    return db.collection(DYNAMIC_COLLECTION).find({ guildId }).sort({ addedAt: -1 }).toArray();
}

export function getReferenceCount(guildId) {
    const refs = guildReferences.get(guildId);
    return refs ? refs.length : 0;
}

function createComponent(data) {
    if (!data || typeof data.type === 'undefined') return null;

    switch (data.type) {
        case 17: {
            const container = new ContainerBuilder();
            if (data.accent_color) container.setAccentColor(data.accent_color);
            if (data.spoiler) container.setSpoiler(data.spoiler);
            if (data.components) {
                for (const child of data.components) {
                    const comp = createComponent(child);
                    if (!comp) continue;
                    if (comp instanceof TextDisplayBuilder) container.addTextDisplayComponents(comp);
                    else if (comp instanceof SectionBuilder) container.addSectionComponents(comp);
                    else if (comp instanceof SeparatorBuilder) container.addSeparatorComponents(comp);
                    else if (comp instanceof ActionRowBuilder) container.addActionRowComponents(comp);
                }
            }
            return container;
        }
        case 9: {
            const section = new SectionBuilder();
            if (data.components) {
                for (const child of data.components) {
                    const comp = createComponent(child);
                    if (comp instanceof TextDisplayBuilder) section.addTextDisplayComponents(comp);
                }
            }
            if (data.accessory) {
                const acc = createComponent(data.accessory);
                if (acc instanceof ButtonBuilder) section.setButtonAccessory(acc);
                else if (acc instanceof ThumbnailBuilder) section.setThumbnailAccessory(acc);
                else if (acc instanceof StringSelectMenuBuilder) section.setStringSelectAccessory(acc);
                else if (acc instanceof UserSelectMenuBuilder) section.setUserSelectAccessory(acc);
                else if (acc instanceof RoleSelectMenuBuilder) section.setRoleSelectAccessory(acc);
                else if (acc instanceof MentionableSelectMenuBuilder) section.setMentionableSelectAccessory(acc);
                else if (acc instanceof ChannelSelectMenuBuilder) section.setChannelSelectAccessory(acc);
            }
            return section;
        }
        case 10:
            return new TextDisplayBuilder().setContent(typeof data.content === 'string' ? data.content : '');
        case 1: {
            const row = new ActionRowBuilder();
            if (data.components) {
                for (const child of data.components) {
                    const comp = createComponent(child);
                    if (comp) row.addComponents(comp);
                }
            }
            return row;
        }
        case 2: {
            const btn = new ButtonBuilder()
                .setLabel(data.label || '')
                .setStyle(data.style || ButtonStyle.Secondary);
            if (data.custom_id && data.style !== 5) btn.setCustomId(data.custom_id);
            else if (!data.url && !data.sku_id) btn.setCustomId(`btn_${Date.now()}`);
            if (data.url) btn.setURL(data.url);
            if (data.emoji) btn.setEmoji(data.emoji);
            if (data.disabled) btn.setDisabled(true);
            if (data.sku_id) btn.setSKU(data.sku_id);
            return btn;
        }
        case 3: {
            const menu = new StringSelectMenuBuilder()
                .setCustomId(data.custom_id || `select_${Date.now()}`)
                .setPlaceholder(data.placeholder || '');
            if (data.min_values) menu.setMinValues(data.min_values);
            if (data.max_values) menu.setMaxValues(data.max_values);
            if (data.disabled) menu.setDisabled(true);
            if (data.options) {
                for (const opt of data.options) {
                    const option = new StringSelectMenuOptionBuilder()
                        .setLabel(opt.label || '')
                        .setValue(opt.value || '');
                    if (opt.description) option.setDescription(opt.description);
                    if (opt.emoji) option.setEmoji(opt.emoji);
                    menu.addOptions(option);
                }
            }
            return menu;
        }
        case 14:
            return new SeparatorBuilder()
                .setSpacing(data.spacing ?? SeparatorSpacingSize.Small)
                .setDivider(data.divider ?? true);
        case 15:
            return new FileUploadBuilder().setCustomId(data.custom_id || `file_${Date.now()}`);
        default:
            return null;
    }
}

export function buildComponentsFromJSON(jsonData) {
    if (!Array.isArray(jsonData)) return [];
    const builders = [];
    for (const item of jsonData) {
        const comp = createComponent(item);
        if (comp) builders.push(comp);
    }
    return builders;
}
