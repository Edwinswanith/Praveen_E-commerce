import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { MockPaymentProvider, RazorpayProvider, type PaymentProvider } from './payment-providers';

/** Resolves the configured payment provider once at boot. null = online payments pending configuration. */
@Injectable()
export class PaymentsGateway {
  readonly provider: PaymentProvider | null;
  private readonly logger = new Logger('Payments');

  constructor(@Inject(ENV) env: Env) {
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        this.logger.warn('PAYMENT_PROVIDER=razorpay but RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are missing: online payments disabled');
        this.provider = null;
      } else {
        if (!env.RAZORPAY_WEBHOOK_SECRET) this.logger.warn('RAZORPAY_WEBHOOK_SECRET missing: webhooks will be rejected');
        this.provider = new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET);
      }
    } else if (env.PAYMENT_PROVIDER === 'mock') {
      this.logger.warn('Using MOCK payment provider (development only, no real money)');
      this.provider = new MockPaymentProvider();
    } else {
      this.provider = null;
    }
  }

  get mock(): MockPaymentProvider | null {
    return this.provider instanceof MockPaymentProvider ? this.provider : null;
  }
}
