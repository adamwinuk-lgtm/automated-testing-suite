import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectContext, ProjectType } from '../types.js';

function detectPackageManager(root: string): ProjectContext['packageManager'] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'package.json'))) return 'npm';
  return null;
}

function isReact(root: string): boolean {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return 'react' in deps;
  } catch {
    return false;
  }
}

export function detectProject(rootPath: string): ProjectContext {
  const types: ProjectType[] = [];

  if (existsSync(join(rootPath, 'package.json'))) {
    if (isReact(rootPath)) {
      types.push('react');
    }
    types.push('nodejs');
  }

  if (
    existsSync(join(rootPath, 'pyproject.toml')) ||
    existsSync(join(rootPath, 'setup.py')) ||
    existsSync(join(rootPath, 'requirements.txt'))
  ) {
    types.push('python');
  }

  if (
    existsSync(join(rootPath, 'Dockerfile')) ||
    existsSync(join(rootPath, 'docker-compose.yml')) ||
    existsSync(join(rootPath, 'docker-compose.yaml'))
  ) {
    types.push('docker');
  }

  return {
    rootPath,
    types,
    packageManager: detectPackageManager(rootPath),
  };
}
