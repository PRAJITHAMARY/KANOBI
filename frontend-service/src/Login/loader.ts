import { redirect } from "react-router";
import { getSession } from "../auth";

/** A same-site path to go to after signing in; the dashboard otherwise. */
export const safeRedirect = (to: FormDataEntryValue | string | null | undefined) =>
  typeof to === "string" && to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/\\")
    ? to
    : "/project";

export const loginLoader = ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  if (getSession()) throw redirect(safeRedirect(params.get("redirectTo")));
  return {
    expired: params.has("expired"),
    redirectTo: params.get("redirectTo") ?? "",
  };
};
