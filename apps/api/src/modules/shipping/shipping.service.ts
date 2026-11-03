import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { ManualShippingProvider, ShiprocketProvider, type Serviceability } from './shipping-providers';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger('Shipping');
  readonly manual = new ManualShippingProvider();
  readonly shiprocket: ShiprocketProvider;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.shiprocket = new ShiprocketProvider(env.SHIPROCKET_EMAIL, env.SHIPROCKET_PASSWORD, env.SHIPROCKET_PICKUP_LOCATION, env.SHIPROCKET_PICKUP_PINCODE);
  }

  /** Uses Shiprocket when configured; any courier API failure degrades to the regional estimate. */
  async serviceability(pincode: string, cod = false): Promise<Serviceability & { pincode: string; source: 'shiprocket' | 'estimate' }> {
    if (this.env.SHIPPING_PROVIDER === 'shiprocket' && this.shiprocket.configured) {
      try {
        return { pincode, source: 'shiprocket', ...(await this.shiprocket.serviceability(pincode, cod)) };
      } catch (e) {
        this.logger.warn(`Shiprocket serviceability failed, using estimate: ${(e as Error).message}`);
      }
    }
    return { pincode, source: 'estimate', ...(await this.manual.serviceability(pincode)) };
  }
}
