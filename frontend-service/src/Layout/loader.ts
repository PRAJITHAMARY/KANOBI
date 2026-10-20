import { redirect, type LoaderFunctionArgs } from "react-router";
import { getSession } from "../auth";

/** Guards every signed-in page: no session sends the user to Sign in, then back. */
export const requireAuth = ({ request }: { request: Request }) => {
  const session = getSession();
  if (!session) {
    const url = new URL(request.url);
    throw redirect(`/?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return { email: session.email };
};

/**
 * Wraps a signed-in page's loader so it checks the session first. React Router
 * runs a route's loaders in parallel, so without this a page loader would call
 * the API (and act on the 401) while the layout's guard is still redirecting.
 */
export const withAuth =
  <Result>(loader: (args: LoaderFunctionArgs) => Result) =>
  (args: LoaderFunctionArgs) => {
    requireAuth(args);
    return loader(args);
  };
