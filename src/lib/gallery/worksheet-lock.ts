const locks = new Map<string, Promise<void>>();

/** Serialize worksheet read/modify/write for one gallery session on this process. */
export async function withGalleryWorksheetLock<T>(
  workspaceId: string,
  sessionId: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = `${workspaceId}:${sessionId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  locks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
