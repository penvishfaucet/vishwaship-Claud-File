import { redirect } from "next/navigation";

/** The step-by-step Create Order (Addresses → Packages → Courier & Payment) is the one in use; this older link opens it. */
export default function CreateOrderRedirect() {
  redirect("/portal/orders/new/");
}
