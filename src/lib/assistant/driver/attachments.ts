/** Files the user attached in the widget. The bytes stay in this tab; the agent only sees an id and a name. */

const files = new Map<string, File>();

export function rememberFile(file: File): { id: string; name: string } {
  const id = `file-${Math.random().toString(36).slice(2, 10)}`;
  files.set(id, file);
  return { id, name: file.name };
}

export function getAttachedFile(id: string): File | undefined {
  return files.get(id);
}

export function forgetFile(id: string) {
  files.delete(id);
}
