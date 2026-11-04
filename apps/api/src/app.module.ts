import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ENV, loadEnv } from './config/env';
import { PrismaService } from './common/prisma/prisma.service';
import { AuditService } from './common/audit/audit.service';
import { MailService } from './common/mail/mail.service';
import { StorageService } from './common/storage/storage.service';
import { QueueService } from './common/queue/queue.service';
import { AttemptLimiter } from './common/ratelimit/attempt-limiter.service';
import { AllExceptionsFilter } from './common/http/exception.filter';
import { EnvelopeInterceptor } from './common/http/envelope';
import { CsrfMiddleware, RequestContextMiddleware } from './common/http/request-context';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import { TokenService } from './modules/auth/token.service';
import { AuthController, StaffAuthController } from './modules/auth/auth.controller';
import { AuditLogController, MeController, StaffUsersController } from './modules/users/users.controller';
import { CategoriesService } from './modules/categories/categories.service';
import { AdminCategoriesController, CategoriesController } from './modules/categories/categories.controller';
import { ProductsService } from './modules/products/products.service';
import { ProductImportService } from './modules/products/import.service';
import { AdminReviewsController } from './modules/products/admin-reviews.controller';
import { AdminProductsController, ProductsController, ReviewWriteController } from './modules/products/products.controller';
import { BarcodesService } from './modules/barcodes/barcodes.service';
import { InventoryService } from './modules/inventory/inventory.service';
import { BarcodesController, InventoryController } from './modules/inventory/inventory.controller';
import { MediaService } from './modules/media/media.service';
import { EmbeddingService } from './modules/ai/embedding.service';
import { ImageGenService } from './modules/ai/image-gen.service';
import { PhotoPreviewStore } from './modules/ai/photo-preview.store';
import { CouponsService } from './modules/coupons/coupons.service';
import { CartService } from './modules/carts/cart.service';
import { CartController, PublicCouponsController } from './modules/carts/cart.controller';
import { WishlistController } from './modules/wishlist/wishlist.controller';
import { PaymentsGateway } from './modules/payments/payments.gateway';
import { ShippingService } from './modules/shipping/shipping.service';
import { ShiprocketWebhookService } from './modules/shipping/shiprocket-webhook.service';
import { OrdersService } from './modules/orders/orders.service';
import { InvoiceService } from './modules/orders/invoice.service';
import { AdminOrdersController, CheckoutController, CustomerOrdersController } from './modules/orders/orders.controller';
import { SearchService } from './modules/search/search.service';
import { AdminAiController, SearchController } from './modules/search/search.controller';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { AnalyticsController } from './modules/analytics/analytics.controller';
import { AdminCouponsController, AdminCustomersController } from './modules/admin/admin.controller';
import { HealthController, SystemHealthController } from './modules/admin/health.controller';
import { NewsletterService } from './modules/newsletter/newsletter.service';
import { AdminNewsletterController, NewsletterController } from './modules/newsletter/newsletter.controller';
import { MessagingService } from './common/messaging/messaging.service';
import { OtpService } from './modules/otp/otp.service';
import { CodService } from './modules/cod/cod.service';
import { AdminCodController } from './modules/cod/cod.controller';
import { EventsService } from './modules/events/events.service';
import { EventsController } from './modules/events/events.controller';
import { TryOnService } from './modules/tryon/tryon.service';
import { TryOnController } from './modules/tryon/tryon.controller';
import { CampaignPricingService } from './modules/campaigns/campaign-pricing.service';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { AdminCampaignsController, AdminPromotionsController, CampaignsController } from './modules/campaigns/campaigns.controller';

/**
 * Modular monolith. Domain code lives in src/modules/<domain>; this module only
 * wires providers. Everything is in one Nest module deliberately: the domains
 * share one database transaction boundary, and splitting into Nest sub-modules
 * would add import ceremony without isolation benefits at this scale.
 */
@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }])],
  controllers: [
    HealthController, SystemHealthController, NewsletterController, AdminNewsletterController, AuthController, StaffAuthController, MeController, StaffUsersController, AuditLogController,
    CategoriesController, AdminCategoriesController, ProductsController, ReviewWriteController, AdminProductsController, AdminReviewsController,
    InventoryController, BarcodesController, CartController, PublicCouponsController, WishlistController,
    CheckoutController, CustomerOrdersController, AdminOrdersController, SearchController, AdminAiController,
    AnalyticsController, AdminCouponsController, AdminCustomersController, AdminCodController, EventsController, TryOnController,
    CampaignsController, AdminCampaignsController, AdminPromotionsController,
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    PrismaService, AuditService, MailService, StorageService, QueueService, AttemptLimiter,
    TokenService, AuthService, CategoriesService, ProductsService, ProductImportService, BarcodesService, InventoryService,
    MediaService, EmbeddingService, CouponsService, CartService, PaymentsGateway, ShippingService, ShiprocketWebhookService, NewsletterService, OrdersService, InvoiceService,
    SearchService, AnalyticsService, MessagingService, OtpService, CodService, ImageGenService, PhotoPreviewStore, EventsService, TryOnService,
    CampaignPricingService, CampaignsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [PrismaService, EmbeddingService, QueueService, OrdersService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, CsrfMiddleware).forRoutes('*');
  }
}
