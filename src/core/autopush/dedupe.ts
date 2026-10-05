import { MAX_RECENT_MESSAGE_IDS } from './constants.js';

export class RecentIdSet {
  private readonly max: number;
  private readonly queue: string[] = [];
  private readonly set = new Set<string>();

  constructor(max: number = MAX_RECENT_MESSAGE_IDS) {
    this.max = max;
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) {
      return;
    }

    if (this.queue.length >= this.max) {
      const oldest = this.queue.shift();
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }

    this.queue.push(id);
    this.set.add(id);
  }

  get size(): number {
    return this.set.size;
  }
}
