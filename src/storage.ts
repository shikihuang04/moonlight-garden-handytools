import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function writeTextAtomic(file: string, text: string, backup = false): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (backup) {
    try { await copyFile(file, `${file}.bak`); } catch (error) { if (!isMissing(error)) throw error; }
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch (error) {
    if (!isExists(error)) throw error;
    const info = await stat(lock);
    if (Date.now() - info.mtimeMs <= 5 * 60_000) throw new Error("daily_routine is already running in another process.");
    await unlink(lock);
    handle = await open(lock, "wx", 0o600);
  }
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
    return await task();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => undefined);
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
