export const CJ_PRIMARY_RUNTIME_ENDPOINTS = [
  "/setting/get",
  "/shop/getShops",
  "/product/list",
  "/product/listV2",
  "/product/query",
  "/product/variant/query",
  "/product/variant/queryByVid",
  "/product/stock/queryByVid",
  "/logistic/freightCalculate",
  "/logistic/freightCalculateTip",
  "/shopping/order/list",
  "/shopping/order/getOrderDetail",
  "/logistic/trackInfo",
] as const;

export const CJ_DEPRECATED_RUNTIME_ENDPOINTS = ["/logistic/getTrackInfo"] as const;

export const CJ_DOCUMENTED_CREATE_ORDER_ENDPOINTS = [
  "/shopping/order/createOrderV2",
  "/shopping/order/createOrderV3",
] as const;

export const CJ_CANONICAL_CREATE_ORDER_ENDPOINT = "/shopping/order/createOrderV3" as const;

export const CJ_PORTAL_WARNING_POLICY_NOTE =
  "CJ portal warning text is informational only. Canonical runtime truth comes from /setting/get, /shop/getShops, live endpoint success, and observed qps/quota behavior.";
