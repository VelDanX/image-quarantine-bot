import { readFileSync } from 'node:fs';

const DEFAULT_REPO = 'VelDanX/image-quarantine-bot';
const CHECK_TIMEOUT_MS = 5000;
const API_HEADERS = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'image-quarantine-bot'
};

export function getLocalVersion() {
    try {
        const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

function normalizeTag(tag) {
    return String(tag || '').replace(/^v/i, '').trim();
}

function parseVersion(value) {
    const parts = normalizeTag(value).split('.');
    if (parts.length === 0 || parts.some(p => p === '' || Number.isNaN(Number(p)))) return null;
    return parts.map(Number);
}

export function isNewerVersion(latest, current) {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    if (!a || !b) return false;
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff > 0;
    }
    return false;
}

function isCheckEnabled() {
    return !['0', 'false', 'no', 'off'].includes(String(process.env.UPDATE_CHECK ?? '').toLowerCase());
}

export function getRepoSlug() {
    return process.env.GITHUB_REPO?.trim() || DEFAULT_REPO;
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    return res.json();
}

export async function fetchLatestRelease() {
    const repo = getRepoSlug();
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (release?.tag_name) {
        return { version: normalizeTag(release.tag_name), url: release.html_url || `https://github.com/${repo}/releases` };
    }

    const tags = await fetchJson(`https://api.github.com/repos/${repo}/tags`);
    if (Array.isArray(tags) && tags.length > 0) {
        const newest = tags.reduce((best, tag) => (isNewerVersion(tag.name, best) ? tag.name : best), tags[0].name);
        return { version: normalizeTag(newest), url: `https://github.com/${repo}/releases/tag/${normalizeTag(newest)}` };
    }

    return null;
}

export function printLocalVersion() {
    console.log(`[MAIN] Версия бота: ${getLocalVersion()} (${getRepoSlug()})`);
}

export async function checkForUpdateNotice() {
    if (!isCheckEnabled()) return;

    const current = getLocalVersion();
    let latest = null;
    try {
        latest = await fetchLatestRelease();
    } catch {
        return;
    }
    if (!latest?.version) return;

    if (isNewerVersion(latest.version, current)) {
        console.log(`[MAIN] ⚠️ Доступна новая версия: ${latest.version} (установлена ${current}) → ${latest.url}`);
    } else {
        console.log(`[MAIN] Установлена актуальная версия. Последняя на GitHub: ${latest.version} → ${latest.url}`);
    }
}
