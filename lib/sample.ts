// デモ用サンプルdiff（架空の決済サービス。実在のコード・データは含まない）
export const SAMPLE_DIFF = `diff --git a/config/production.env b/config/production.env
index 3f1a2b4..9c8d7e1 100644
--- a/config/production.env
+++ b/config/production.env
@@ -1,6 +1,7 @@
 DB_HOST=db.internal
-DB_POOL_SIZE=10
+DB_POOL_SIZE=50
 PAYMENT_API=https://pay.example.com/v1
+PAYMENT_TIMEOUT_MS=1500
 LOG_LEVEL=warn
diff --git a/src/billing/retry.ts b/src/billing/retry.ts
index a1b2c3d..e4f5a6b 100644
--- a/src/billing/retry.ts
+++ b/src/billing/retry.ts
@@ -12,9 +12,7 @@ export async function chargeWithRetry(order: Order) {
   for (let i = 0; i < MAX_RETRY; i++) {
     try {
       return await paymentClient.charge(order);
-    } catch (e) {
-      if (!isRetryable(e)) throw e;
-      await sleep(backoff(i));
+    } catch {
+      await sleep(backoff(i));
     }
   }
diff --git a/migrations/20260711_add_coupon.sql b/migrations/20260711_add_coupon.sql
new file mode 100644
--- /dev/null
+++ b/migrations/20260711_add_coupon.sql
@@ -0,0 +1,3 @@
+ALTER TABLE orders ADD COLUMN coupon_code TEXT;
+UPDATE orders SET coupon_code = '' WHERE coupon_code IS NULL;
+CREATE INDEX idx_orders_coupon ON orders (coupon_code);
`;
