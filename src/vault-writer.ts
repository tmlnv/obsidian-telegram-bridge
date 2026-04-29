import { normalizePath, TFile, type Vault } from "obsidian";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureFolderExists(vault: Vault, filePath: string): Promise<void> {
  const parts = normalizePath(filePath).split("/");
  parts.pop();

  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!vault.getAbstractFileByPath(currentPath)) {
      await vault.createFolder(currentPath);
    }
  }
}

function buildBlockRegex(marker: string, blockEndMarker: string): RegExp {
  return new RegExp(
    `${escapeRegExp(marker)}[\\s\\S]*?${escapeRegExp(blockEndMarker)}\\n?`,
    "g",
  );
}

function appendBlock(existingContent: string, blockContent: string): string {
  if (!existingContent.trim()) {
    return blockContent;
  }

  return `${existingContent.trimEnd()}\n\n${blockContent}`;
}

export async function upsertMessageBlock(
  vault: Vault,
  notePath: string,
  marker: string,
  blockEndMarker: string,
  blockContent: string,
): Promise<void> {
  const normalizedPath = normalizePath(notePath);
  await ensureFolderExists(vault, normalizedPath);

  const existing = vault.getAbstractFileByPath(normalizedPath);
  if (!existing) {
    await vault.create(normalizedPath, blockContent);
    return;
  }

  if (!(existing instanceof TFile)) {
    throw new Error(`Path exists and is not a file: ${normalizedPath}`);
  }

  const currentContent = await vault.read(existing);
  const blockRegex = buildBlockRegex(marker, blockEndMarker);

  if (blockRegex.test(currentContent)) {
    const nextContent = currentContent.replace(blockRegex, `${blockContent}\n`);
    await vault.modify(existing, nextContent.trimEnd() + "\n");
    return;
  }

  await vault.modify(existing, appendBlock(currentContent, blockContent));
}

function splitExtension(filePath: string): { base: string; extension: string } {
  const normalized = normalizePath(filePath);
  const dotIndex = normalized.lastIndexOf(".");

  if (dotIndex <= 0) {
    return {
      base: normalized,
      extension: "",
    };
  }

  return {
    base: normalized.slice(0, dotIndex),
    extension: normalized.slice(dotIndex),
  };
}

export async function saveBinaryFile(
  vault: Vault,
  filePath: string,
  data: ArrayBuffer,
): Promise<string> {
  const normalizedPath = normalizePath(filePath);
  await ensureFolderExists(vault, normalizedPath);

  const existing = vault.getAbstractFileByPath(normalizedPath);
  if (!existing) {
    await vault.createBinary(normalizedPath, data);
    return normalizedPath;
  }

  if (existing instanceof TFile) {
    await vault.modifyBinary(existing, data);
    return normalizedPath;
  }

  const { base, extension } = splitExtension(normalizedPath);
  let suffix = 1;

  while (true) {
    const candidate = `${base}-${suffix}${extension}`;
    if (!vault.getAbstractFileByPath(candidate)) {
      await vault.createBinary(candidate, data);
      return candidate;
    }
    suffix += 1;
  }
}
