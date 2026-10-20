import { Outlet, useLoaderData, useNavigate } from "react-router";
import { signOut } from "../auth";

/** Shell for signed-in pages: the user's email and Sign out above the page. */
export default function Layout() {
  const { email } = useLoaderData() as { email: string };
  const navigate = useNavigate();

  return (
    <>
      <header className="flex items-center justify-end gap-4 px-8 py-3 bg-gray-950 text-sm text-gray-300">
        <span>{email}</span>
        <button
          type="button"
          className="rounded border border-gray-600 px-3 py-1 hover:bg-gray-800"
          onClick={() => {
            signOut();
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </button>
      </header>
      <Outlet />
    </>
  );
}
