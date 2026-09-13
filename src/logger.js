export function logInfo(user, message) {
    console.log(`[INFO] ${user ? user.tag + ': ' : ''}${message}`);
}

export function logError(user, error) {
    const msg = error?.message || error?.toString() || 'Unknown error';
    console.error(`[ERROR] ${user ? user.tag + ': ' : ''}${msg}`);
}
