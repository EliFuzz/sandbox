import { encodeSandboxedCommand } from '@/core/command/command-utils';
import type { SandboxViolationEvent } from '@/os/macos/sandbox/macos-sandbox-monitor';

export class SandboxViolationStore {
  private violations: SandboxViolationEvent[] = [];
  private totalCount = 0;
  private readonly maxSize = 100;
  private listeners: Set<(violations: SandboxViolationEvent[]) => void> =
    new Set();

  addViolation(violation: SandboxViolationEvent): void {
    this.violations.push(violation);
    this.totalCount++;
    if (this.violations.length > this.maxSize) {
      this.violations = this.violations.slice(-this.maxSize);
    }
    this.notifyListeners();
  }

  getViolations(limit?: number): SandboxViolationEvent[] {
    if (limit === undefined) {
      return [...this.violations];
    }
    return this.violations.slice(-limit);
  }

  getCount(): number {
    return this.violations.length;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  getViolationsForCommand(command: string): SandboxViolationEvent[] {
    const commandBase64 = encodeSandboxedCommand(command);
    return this.violations.filter((v) => v.encodedCommand === commandBase64);
  }

  clear(): void {
    this.violations = [];

    this.notifyListeners();
  }

  subscribe(
    listener: (violations: SandboxViolationEvent[]) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.getViolations());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const violations = this.getViolations();
    this.listeners.forEach((listener) => listener(violations));
  }
}
