import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { reportError } from '../monitoring/monitoring';

/**
 * Thin BullMQ wrapper. When QUEUES_ENABLED=false (tests) jobs run inline via the
 * registered processor, so behaviour is identical without Redis.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  private connection: IORedis | null = null;
  private queues = new Map<string, Queue>();
  private workers: Worker[] = [];
  private inline = new Map<string, Processor>();

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.QUEUES_ENABLED) {
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
      this.connection.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
    }
  }

  /** Shared Redis connection (null when queues are disabled). */
  get redis(): IORedis | null {
    return this.connection;
  }

  get enabled() {
    return this.connection !== null;
  }

  async ping(): Promise<boolean> {
    if (!this.connection) return false;
    try {
      return (await this.connection.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private queue(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection!, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }

  async add<T>(name: string, jobName: string, data: T, opts?: JobsOptions) {
    if (!this.connection) {
      const p = this.inline.get(name);
      if (p) await p({ name: jobName, data, attemptsMade: 0 } as Job);
      return;
    }
    await this.queue(name).add(jobName, data, opts);
  }

  async repeat(name: string, jobName: string, everyMs: number) {
    if (!this.connection) return;
    await this.queue(name).upsertJobScheduler(`${jobName}-scheduler`, { every: everyMs }, { name: jobName, data: {} });
  }

  /** Register a processor. Workers start only where this process should run them. */
  process(name: string, processor: Processor, concurrency = 2) {
    this.inline.set(name, processor);
    if (!this.connection || !this.env.RUN_WORKERS_IN_API && !process.env.VYRA_WORKER) return;
    const w = new Worker(name, processor, { connection: this.connection.duplicate(), concurrency });
    w.on('failed', (job, err) => {
      this.logger.warn(`${name}/${job?.name} failed (attempt ${job?.attemptsMade}): ${err.message}`);
      // Out of retries: the job is now only visible in the failed set, so report it.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) reportError(err, { queue: name, job: job.name, jobId: job.id, attempts: job.attemptsMade });
    });
    this.workers.push(w);
  }

  async counts(name: string) {
    if (!this.connection) return null;
    return this.queue(name).getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection?.quit().catch(() => undefined);
  }
}
