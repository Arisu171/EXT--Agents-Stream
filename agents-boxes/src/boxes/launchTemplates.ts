import * as vscode from 'vscode';

const TEMPLATES_KEY = 'agents-boxes.launchTemplates';

export interface LaunchTemplate {
  id: string;
  name: string;
  profileId: string;
  commands: string[];
}

export type LaunchTemplateInput = Omit<LaunchTemplate, 'id'> & { id?: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeCommands(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTemplate(raw: unknown): LaunchTemplate | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (!isNonEmptyString(obj.id) || !isNonEmptyString(obj.name) || !isNonEmptyString(obj.profileId)) {
    return undefined;
  }
  return {
    id: obj.id.trim(),
    name: obj.name.trim(),
    profileId: obj.profileId.trim(),
    commands: sanitizeCommands(obj.commands),
  };
}

export function loadLaunchTemplates(context: vscode.ExtensionContext): LaunchTemplate[] {
  const stored = context.globalState.get<unknown>(TEMPLATES_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.map(normalizeTemplate).filter((t): t is LaunchTemplate => !!t);
}

async function persist(context: vscode.ExtensionContext, templates: LaunchTemplate[]): Promise<void> {
  await context.globalState.update(TEMPLATES_KEY, templates);
}

function newId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function upsertLaunchTemplate(
  context: vscode.ExtensionContext,
  input: LaunchTemplateInput,
): Promise<LaunchTemplate> {
  const templates = loadLaunchTemplates(context);
  const id = isNonEmptyString(input.id) ? input.id.trim() : newId();
  const next: LaunchTemplate = {
    id,
    name: input.name.trim(),
    profileId: input.profileId.trim(),
    commands: sanitizeCommands(input.commands),
  };
  if (!next.name || !next.profileId) {
    throw new Error('Template name and terminal profile are required');
  }
  const idx = templates.findIndex((t) => t.id === id);
  if (idx >= 0) {
    templates[idx] = next;
  } else {
    templates.push(next);
  }
  await persist(context, templates);
  return next;
}

export async function deleteLaunchTemplate(
  context: vscode.ExtensionContext,
  id: string,
): Promise<boolean> {
  const templates = loadLaunchTemplates(context);
  const next = templates.filter((t) => t.id !== id);
  if (next.length === templates.length) {
    return false;
  }
  await persist(context, next);
  return true;
}

export function findLaunchTemplate(
  context: vscode.ExtensionContext,
  id: string | undefined,
): LaunchTemplate | undefined {
  if (!id) {
    return undefined;
  }
  return loadLaunchTemplates(context).find((t) => t.id === id);
}
