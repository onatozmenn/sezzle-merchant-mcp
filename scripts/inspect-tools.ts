import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { createApplication } from '../src/application.js';
import { loadConfig, type PermissionProfile } from '../src/config/env.js';

const profiles: readonly PermissionProfile[] = ['read', 'finance', 'webhooks', 'support', 'admin'];
const categoryLabels: Readonly<Record<string, string>> = {
  audit: 'Audit',
  auth: 'Merchant operations',
  captures: 'Merchant operations',
  diagnostics: 'Integration Doctor',
  orders: 'Merchant operations',
  reconciliation: 'Reconciliation',
  refunds: 'Merchant operations',
  releases: 'Merchant operations',
  reports: 'Settlement and reports',
  sessions: 'Merchant operations',
  support: 'Support',
  webhooks: 'Webhooks',
};

interface RegisteredSurface {
  readonly tools: readonly Tool[];
  readonly resourceCount: number;
  readonly promptCount: number;
}

interface InventoryItem {
  readonly name: string;
  readonly category: string;
  readonly requiredPermission: PermissionProfile;
  readonly classification: 'read' | 'write';
  readonly confirmationRequired: boolean;
  readonly availableInReadOnly: boolean;
  readonly description: string;
}

const inspectSurface = async (
  profile: PermissionProfile,
  readOnly: boolean,
): Promise<RegisteredSurface> => {
  const application = createApplication(
    loadConfig({
      SEZZLE_PERMISSION_PROFILE: profile,
      SEZZLE_READ_ONLY: String(readOnly),
      SEZZLE_REQUIRE_CONFIRMATION: 'true',
    }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await application.server.connect(serverTransport);
  const client = new Client({ name: 'sezzle-ops-inspector', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    const [tools, resources, prompts] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ]);
    return {
      tools: tools.tools,
      resourceCount: resources.resources.length,
      promptCount: prompts.prompts.length,
    };
  } finally {
    await client.close();
    await application.server.close();
    await application.storage.close();
  }
};

const findRegisterFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return findRegisterFiles(path);
      return entry.isFile() && entry.name === 'register.ts' ? [path] : [];
    }),
  );
  return nested.flat().sort();
};

const deriveCategories = async (): Promise<ReadonlyMap<string, string>> => {
  const toolsRoot = resolve('src/tools');
  const categories = new Map<string, string>();
  for (const file of await findRegisterFiles(toolsRoot)) {
    const source = await readFile(file, 'utf8');
    const categoryDirectory = relative(toolsRoot, file).split(sep)[0];
    const category = categoryLabels[categoryDirectory ?? ''];
    if (category === undefined) {
      throw new Error(`No inventory category is defined for ${relative(process.cwd(), file)}.`);
    }
    const matcher = /server\.registerTool\(\s*['"]([^'"]+)['"]/gu;
    for (const match of source.matchAll(matcher)) {
      const toolName = match[1];
      if (toolName === undefined) continue;
      if (categories.has(toolName))
        throw new Error(`Tool ${toolName} is registered in multiple files.`);
      categories.set(toolName, category);
    }
  }
  return categories;
};

const hasConfirmationInput = (tool: Tool): boolean =>
  Object.hasOwn(tool.inputSchema.properties ?? {}, 'confirm');

const buildInventory = async () => {
  const readOnlySurfaces = new Map<PermissionProfile, RegisteredSurface>();
  const writeSurfaces = new Map<PermissionProfile, RegisteredSurface>();
  for (const profile of profiles) {
    readOnlySurfaces.set(profile, await inspectSurface(profile, true));
    writeSurfaces.set(profile, await inspectSurface(profile, false));
  }

  const adminSurface = writeSurfaces.get('admin');
  if (adminSurface === undefined) throw new Error('Admin surface was not inspected.');
  const categories = await deriveCategories();
  const toolSets = new Map(
    profiles.map((profile) => [
      profile,
      new Set(writeSurfaces.get(profile)?.tools.map((tool) => tool.name) ?? []),
    ]),
  );

  const inventory: InventoryItem[] = adminSurface.tools.map((tool) => {
    const requiredPermission = profiles.find((profile) => toolSets.get(profile)?.has(tool.name));
    if (requiredPermission === undefined)
      throw new Error(`No permission profile exposes ${tool.name}.`);
    const category = categories.get(tool.name);
    if (category === undefined) {
      throw new Error(`Registered tool ${tool.name} was not found in a source registration file.`);
    }
    if (tool.annotations?.readOnlyHint === undefined) {
      throw new Error(`Registered tool ${tool.name} has no readOnlyHint annotation.`);
    }
    return {
      name: tool.name,
      category,
      requiredPermission,
      classification: tool.annotations.readOnlyHint ? 'read' : 'write',
      confirmationRequired: hasConfirmationInput(tool),
      availableInReadOnly:
        readOnlySurfaces
          .get(requiredPermission)
          ?.tools.some((readOnlyTool) => readOnlyTool.name === tool.name) ?? false,
      description: tool.description ?? '',
    };
  });
  inventory.sort(
    (left, right) =>
      left.category.localeCompare(right.category) || left.name.localeCompare(right.name),
  );

  return {
    generatedFrom: 'runtime MCP tools/list plus src/tools/*/register.ts',
    toolCount: inventory.length,
    resourceCount: adminSurface.resourceCount,
    promptCount: adminSurface.promptCount,
    profileCounts: Object.fromEntries(
      profiles.map((profile) => [
        profile,
        {
          readOnly: readOnlySurfaces.get(profile)?.tools.length ?? 0,
          writeEnabled: writeSurfaces.get(profile)?.tools.length ?? 0,
        },
      ]),
    ),
    tools: inventory,
  };
};

const escapeCell = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ');

const renderMarkdown = (inventory: Awaited<ReturnType<typeof buildInventory>>): string => {
  const profileRows = profiles
    .map((profile) => {
      const counts = inventory.profileCounts[profile];
      return `| \`${profile}\` | ${String(counts?.readOnly ?? 0)} | ${String(counts?.writeEnabled ?? 0)} |`;
    })
    .join('\n');
  const toolRows = inventory.tools
    .map(
      (tool) =>
        `| \`${tool.name}\` | ${tool.category} | \`${tool.requiredPermission}\` | ${tool.classification} | ${tool.confirmationRequired ? 'Yes' : 'No'} | ${tool.availableInReadOnly ? 'Yes' : 'No'} | ${escapeCell(tool.description)} |`,
    )
    .join('\n');
  return `# Tool Inventory

This file is generated by \`npm run inspect-tools:write\`. Do not edit it manually.

Source: ${inventory.generatedFrom}.

## Verified Counts

- Tools in full admin/write mode: **${String(inventory.toolCount)}**
- Resources in full admin/write mode: **${String(inventory.resourceCount)}**
- Prompts in full admin/write mode: **${String(inventory.promptCount)}**

## Profile Counts

| Profile | Read-only mode | Write-enabled mode |
| --- | ---: | ---: |
${profileRows}

## Tools

| Tool | Category | Required permission | Classification | Confirmation required | Available read-only | Description |
| --- | --- | --- | --- | --- | --- | --- |
${toolRows}
`;
};

const main = async (): Promise<void> => {
  const inventory = await buildInventory();
  const writeIndex = process.argv.indexOf('--write');
  const checkIndex = process.argv.indexOf('--check');
  if (writeIndex >= 0 || checkIndex >= 0) {
    const index = writeIndex >= 0 ? writeIndex : checkIndex;
    const path = resolve(process.argv[index + 1] ?? 'docs/TOOL_INVENTORY.md');
    const markdown = renderMarkdown(inventory).replaceAll('\r\n', '\n');
    if (writeIndex >= 0) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, markdown, 'utf8');
      process.stdout.write(
        `Wrote ${relative(process.cwd(), path)} with ${String(inventory.toolCount)} tools.\n`,
      );
      return;
    }
    const current = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    if (current !== markdown) throw new Error(`${relative(process.cwd(), path)} is stale.`);
    process.stdout.write(`${relative(process.cwd(), path)} is current.\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown inspection error.';
  process.stderr.write(`${JSON.stringify({ code: 'INSPECTION_FAILED', message })}\n`);
  process.exitCode = 1;
});
