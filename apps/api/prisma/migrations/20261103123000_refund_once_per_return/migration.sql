-- At most one live (non-failed) refund per return request. Backstop for the
-- row-locked check in OrdersService.refund(); a failed refund frees the slot.
CREATE UNIQUE INDEX "refunds_one_live_per_return" ON "refunds" ("returnRequestId") WHERE "returnRequestId" IS NOT NULL AND "status" <> 'FAILED';
