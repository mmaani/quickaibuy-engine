export type {
  CjCreateOrderInput,
  CjCreateOrderResult,
  CjOrderStatusResult,
} from "@/lib/suppliers/cj";

export { createCjOrder as createOrder, getCjOrderDetail as getOrderStatus } from "@/lib/suppliers/cj";
