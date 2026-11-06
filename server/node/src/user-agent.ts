import * as os from 'node:os';
import { VERSION } from './version.js';

const ARCH: Record<string, string> = { x64: 'x64', arm64: 'arm64', ia32: 'x86', arm: 'arm' };
const OS: Record<string, string> = { win32: 'windows' };

/** @internal Versions must match `^[0-9][0-9A-Za-z.+-]{0,39}$` for the backend parser (SPEC section 4). */
export function sanitise(version: string): string {
  return version.replace(/^v/, '').replace(/[^0-9A-Za-z.+-]/g, '-').slice(0, 40);
}

/**
 * @internal `clikgate-node/<v> (node <v>; <os> <arch>)` (SPEC section 4). This is the only telemetry.
 */
export function userAgent(platform: string = os.platform(), arch: string = process.arch, nodeVersion: string = process.versions.node): string {
  const osName = (OS[platform] ?? platform).toLowerCase();
  const archName = ARCH[arch] ?? arch.toLowerCase().replace(/\s+/g, '');
  return `clikgate-node/${sanitise(VERSION)} (node ${sanitise(nodeVersion)}; ${osName} ${archName})`;
}
